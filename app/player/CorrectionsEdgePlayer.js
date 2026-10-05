"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { verifyCorrectionsEdgeAttestation } from "@/lib/corrections-edge-attestation.mjs";
import { clearCorrectionsEdgePending, correctionsEdgePendingKey, detachCorrectionsEdgeAudio,
  finishPendingCorrectionsTerminal, pinCorrectionsEdgeTerminal, pollCorrectionsEdgePlayback,
  readCorrectionsEdgePending, writeCorrectionsEdgePending,
  unloadCorrectionsEdgeAudio } from "@/lib/corrections-edge-player-safety.mjs";

const INSTANCE_KEY = "ruvanas_player_instance_v1";
const EDGE_REQUEST_TIMEOUT_MS = 4000;

class EdgeRequestError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function instanceHeader() {
  let id = window.sessionStorage.getItem(INSTANCE_KEY);
  if (!id) { id = crypto.randomUUID(); window.sessionStorage.setItem(INSTANCE_KEY, id); }
  return { "X-Ruvanas-Player-Instance": id };
}

export default function CorrectionsEdgePlayer({ connection }) {
  const terminalKey = correctionsEdgePendingKey(connection);
  const [status, setStatus] = useState("Verifying this facility's Secure Edge…");
  const [current, setCurrent] = useState(null);
  const audio = useRef(null);
  const lease = useRef(null);
  const active = useRef(null);
  const blockedSessionId = useRef(null);
  const pendingTerminal = useRef(null);
  const busy = useRef(false);
  const stopped = useRef(false);

  const edgeRequest = useCallback(async (path, { method = "GET", body = null, token = lease.current?.accessToken } = {}) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), EDGE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(new URL(path, connection.endpointOrigin), {
        method, cache: "no-store", credentials: "omit", signal: controller.signal,
        headers: { ...(token ? { Authorization: `EdgeSession ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const result = await response.json();
      if (!response.ok) throw new EdgeRequestError(result.error || "The private Edge player is unavailable.", response.status);
      return result;
    } finally { window.clearTimeout(timeout); }
  }, [connection.endpointOrigin]);

  const rememberPending = useCallback((item) => {
    writeCorrectionsEdgePending(window.sessionStorage, terminalKey, item);
  }, [terminalKey]);

  const forgetPending = useCallback((item) => {
    clearCorrectionsEdgePending(window.sessionStorage, terminalKey, item);
  }, [terminalKey]);

  const establish = useCallback(async () => {
    const nonce = crypto.randomUUID();
    const attestation = await edgeRequest(`/v1/attest?nonce=${encodeURIComponent(nonce)}`, { token: null });
    if (!await verifyCorrectionsEdgeAttestation(attestation, { ...connection, nonce })) {
      throw new Error("This local Edge did not prove its assigned facility identity. No player grant was sent.");
    }
    const response = await fetch(`/api/player/edge-grant/${encodeURIComponent(connection.nodeId)}`, {
      method: "POST", cache: "no-store", headers: instanceHeader()
    });
    const grant = await response.json();
    if (!response.ok) throw new Error(grant.error || "The cloud did not authorise this private player.");
    if (grant.payload?.nodeId !== connection.nodeId ||
        grant.payload?.facilityId !== connection.facilityId ||
        grant.payload?.playerId !== connection.playerId || grant.payload?.zoneId !== connection.zoneId) {
      throw new Error("The cloud Edge grant does not match this player and signed manifest.");
    }
    lease.current = await edgeRequest("/v1/session", { method: "POST", body: { grant }, token: null });
    setStatus("Secure Edge connected. Private facility audio is available.");
  }, [connection, edgeRequest]);

  const renew = useCallback(async () => {
    if (!lease.current?.refreshToken) throw new Error("No authorised Edge lease is available.");
    const result = await edgeRequest("/v1/renew", { method: "POST",
      body: { refreshToken: lease.current.refreshToken }, token: null });
    lease.current = { ...lease.current, ...result };
  }, [edgeRequest]);

  const closePlayback = useCallback(async (eventType, item = active.current) => {
    if (!item) return false;
    if (item.ended) return true;
    if (item.reportPromise) return item.reportPromise;
    // A lost response must be retried as the same terminal event and position.
    // Switching from a possibly accepted COMPLETED to INTERRUPTED could create
    // conflicting evidence, while changing the position breaks idempotency.
    const positionSeconds = eventType === "COMPLETED" ?
      Math.ceil(item.durationSeconds) :
      (item.stoppedAtSeconds ?? Math.max(0, Math.floor(audio.current?.currentTime || 0)));
    const terminal = pinCorrectionsEdgeTerminal(item, eventType, positionSeconds);
    rememberPending(item);
    const report = (async () => {
      try {
        if (Date.parse(lease.current?.accessValidUntil || "") < Date.now() + 10_000) await renew();
        await edgeRequest("/v1/proof", { method: "POST", body: { sessionId: item.sessionId, ...terminal } });
        item.ended = true;
        forgetPending(item);
        return true;
      } catch {
        // A failed terminal report remains pending. Neither a lost completion
        // response nor a failed interruption may reuse the old media ticket.
        setStatus("The Edge could not confirm this playback result. Operations must review the proof backlog.");
        return false;
      }
    })();
    item.reportPromise = report;
    try { return await report; }
    finally { if (item.reportPromise === report) item.reportPromise = null; }
  }, [edgeRequest, forgetPending, rememberPending, renew]);

  const bindAudio = useCallback((element) => {
    if (!element && audio.current) {
      // React clears DOM refs before passive unmount cleanup. Stop the old
      // element here so detached, buffered media cannot keep playing.
      const item = active.current;
      detachCorrectionsEdgeAudio(audio.current, item, (detached) => {
        pinCorrectionsEdgeTerminal(detached, "INTERRUPTED", detached.stoppedAtSeconds);
        blockedSessionId.current = detached.sessionId;
        pendingTerminal.current = detached;
        active.current = null;
        rememberPending(detached);
        void closePlayback("INTERRUPTED", detached);
      });
    }
    audio.current = element;
  }, [closePlayback, rememberPending]);

  const haltPlayback = useCallback(() => {
    const item = active.current;
    const positionSeconds = unloadCorrectionsEdgeAudio(audio.current);
    if (item) {
      item.stoppedAtSeconds = positionSeconds;
      pinCorrectionsEdgeTerminal(item, "INTERRUPTED", positionSeconds);
      blockedSessionId.current = item.sessionId;
      pendingTerminal.current = item;
      rememberPending(item);
    }
    active.current = null;
    setCurrent(null);
    return item;
  }, [rememberPending]);

  const poll = useCallback(async () => {
    if (busy.current || stopped.current) return;
    busy.current = true;
    try {
      pendingTerminal.current ??= readCorrectionsEdgePending(window.sessionStorage, terminalKey);
      if (pendingTerminal.current) blockedSessionId.current = pendingTerminal.current.sessionId;
      if (!lease.current) await establish();
      let result = await pollCorrectionsEdgePlayback({
        needsRenewal: Date.parse(lease.current.accessValidUntil) < Date.now() + 20_000,
        renew, playback: () => edgeRequest("/v1/playback"),
        halt: haltPlayback, interrupt: (item) => closePlayback("INTERRUPTED", item),
        clearLease: () => { lease.current = null; }, establish
      });
      if (stopped.current) return;
      if (pendingTerminal.current && !pendingTerminal.current.ended) {
        const recovery = await finishPendingCorrectionsTerminal(pendingTerminal.current, {
          report: (item) => closePlayback("INTERRUPTED", item),
          playback: () => edgeRequest("/v1/playback")
        });
        if (stopped.current) return;
        if (!recovery.confirmed) {
          setStatus("The prior playback result is unconfirmed. Playback stays stopped for operations review.");
          return;
        }
        result = recovery.result;
      }
      if (result.state !== "READY") {
        const interrupted = haltPlayback();
        if (interrupted && !await closePlayback("INTERRUPTED", interrupted)) {
          setStatus("The prior playback result is unconfirmed. Playback stays stopped for operations review.");
          return;
        }
        if (result.state === "UNRESOLVED_SESSION" && interrupted) {
          result = await edgeRequest("/v1/playback");
        }
        if (result.state !== "READY") {
          setStatus(result.state === "EXPIRED_OR_UNAVAILABLE" ?
            "Offline permission expired. Private playback is safely stopped." :
            result.state === "UNRESOLVED_SESSION" ?
              "An earlier Edge session has no confirmed ending. Playback stays stopped for operations review." :
              "No authorised private audio is available for this player right now.");
          return;
        }
      }
      if (result.sessionId === blockedSessionId.current) {
        setStatus("The Edge reused an interrupted session. Private playback remains stopped until a fresh session is authorised.");
        return;
      }
      blockedSessionId.current = null;
      pendingTerminal.current = null;
      if (active.current?.sessionId === result.sessionId) {
        // A browser can pause a replaced audio source during an override
        // transition even though the Edge session remains valid. Do not let
        // the player display READY indefinitely while its audio is stalled.
        if (audio.current?.paused && !audio.current.ended) {
          try { await audio.current.play(); }
          catch { setStatus("Press Play to resume the approved private audio."); }
        }
        return;
      }
      if (active.current) {
        const interrupted = haltPlayback();
        if (!await closePlayback("INTERRUPTED", interrupted)) {
          setStatus("The prior playback result is unconfirmed. Playback stays stopped for operations review.");
          return;
        }
      }
      active.current = { ...result, ended: false };
      setCurrent(result);
      setStatus(`Private ${result.source.replace(/^CORRECTIONS_/, "").toLowerCase()} programme · Secure Edge`);
    } catch (error) {
      if (stopped.current) return;
      haltPlayback();
      setStatus(`${error instanceof Error ? error.message : "The assigned Secure Edge is unavailable."} Private playback is stopped; delivery is not confirmed.`);
    } finally { busy.current = false; }
  }, [closePlayback, edgeRequest, establish, haltPlayback, renew, terminalKey]);

  useEffect(() => {
    stopped.current = false;
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => { stopped.current = true; window.clearInterval(timer); audio.current?.pause(); };
  }, [poll]);

  useEffect(() => {
    if (!current || !audio.current || active.current?.sessionId !== current.sessionId) return;
    let source;
    try { source = new URL(current.mediaUrl, connection.endpointOrigin); }
    catch { haltPlayback(); setStatus("The Edge returned an invalid media address. Playback stopped."); return; }
    if (source.origin !== connection.endpointOrigin) {
      haltPlayback(); setStatus("The Edge returned an untrusted media address. Playback stopped."); return;
    }
    audio.current.src = source.href;
    audio.current.load();
    audio.current.play().catch(() => {
      if (active.current?.sessionId === current.sessionId) {
        setStatus("Press Play to start the approved private audio.");
      }
    });
  }, [connection.endpointOrigin, current, haltPlayback]);

  return <section aria-label="Private Secure Edge player">
    <h2>Private Ruvanas Inside · Secure Edge</h2>
    <p role="status">{status}</p>
    <p>Facility player: {connection.playerId} · This player cannot browse or download the catalogue.</p>
    {current ? <audio ref={bindAudio} controls controlsList="nodownload noremoteplayback" preload="auto"
      onContextMenu={(event) => event.preventDefault()} style={{ width: "100%" }}
      onEnded={async () => { const item = active.current; if (!item) return;
        pinCorrectionsEdgeTerminal(item, "COMPLETED", Math.ceil(item.durationSeconds));
        haltPlayback();
        const confirmed = await closePlayback("COMPLETED", item);
        if (confirmed) poll(); }}
      onError={async () => { const item = active.current; if (!item) return;
        pinCorrectionsEdgeTerminal(item, "FAILED", Math.max(0, Math.floor(audio.current?.currentTime || 0)));
        haltPlayback();
        await closePlayback("FAILED", item); }} /> :
      <button type="button" onClick={poll}>Retry private connection</button>}
  </section>;
}
