"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { verifyCorrectionsEdgeAttestation } from "@/lib/corrections-edge-attestation.mjs";

const INSTANCE_KEY = "ruvanas_player_instance_v1";

function instanceHeader() {
  let id = window.sessionStorage.getItem(INSTANCE_KEY);
  if (!id) { id = crypto.randomUUID(); window.sessionStorage.setItem(INSTANCE_KEY, id); }
  return { "X-Ruvanas-Player-Instance": id };
}

export default function CorrectionsEdgePlayer({ connection }) {
  const [status, setStatus] = useState("Verifying this facility's Secure Edge…");
  const [current, setCurrent] = useState(null);
  const audio = useRef(null);
  const lease = useRef(null);
  const active = useRef(null);
  const busy = useRef(false);
  const stopped = useRef(false);

  const edgeRequest = useCallback(async (path, { method = "GET", body = null, token = lease.current?.accessToken } = {}) => {
    const response = await fetch(new URL(path, connection.endpointOrigin), {
      method, cache: "no-store", credentials: "omit",
      headers: { ...(token ? { Authorization: `EdgeSession ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The private Edge player is unavailable.");
    return result;
  }, [connection.endpointOrigin]);

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
    if (!item || item.ended) return;
    item.ended = true;
    try {
      if (Date.parse(lease.current?.accessValidUntil || "") < Date.now() + 10_000) await renew();
      await edgeRequest("/v1/proof", { method: "POST", body: { sessionId: item.sessionId,
        eventType, positionSeconds: eventType === "COMPLETED" ? Math.ceil(item.durationSeconds) :
          Math.max(0, Math.floor(audio.current?.currentTime || 0)) } });
    } catch {
      // The Edge, not the browser, holds the append-only proof journal. A
      // failed terminal report must never be represented as delivered.
      setStatus("The Edge could not confirm this playback result. Operations must review the proof backlog.");
    }
  }, [edgeRequest, renew]);

  const poll = useCallback(async () => {
    if (busy.current || stopped.current) return;
    busy.current = true;
    try {
      if (!lease.current) await establish();
      if (Date.parse(lease.current.accessValidUntil) < Date.now() + 20_000) await renew();
      let result;
      try { result = await edgeRequest("/v1/playback"); }
      catch (error) {
        // A new signed manifest invalidates the prior lease. Obtain a fresh
        // cloud grant only after a new attestation; never guess another URL.
        lease.current = null;
        await establish();
        result = await edgeRequest("/v1/playback");
      }
      if (result.state !== "READY") {
        if (active.current) {
          audio.current?.pause();
          await closePlayback("INTERRUPTED");
          active.current = null; setCurrent(null);
        }
        setStatus(result.state === "EXPIRED_OR_UNAVAILABLE" ?
          "Offline permission expired. Private playback is safely stopped." :
          "No authorised private audio is available for this player right now.");
        return;
      }
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
        audio.current?.pause();
        await closePlayback("INTERRUPTED");
      }
      active.current = { ...result, ended: false };
      setCurrent(result);
      setStatus(`Private ${result.source.replace(/^CORRECTIONS_/, "").toLowerCase()} programme · Secure Edge`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The assigned Secure Edge is unavailable.");
      if (active.current && Date.now() >= Date.parse(connection.validUntil)) {
        audio.current?.pause(); active.current = null; setCurrent(null);
      }
    } finally { busy.current = false; }
  }, [closePlayback, connection.validUntil, edgeRequest, establish, renew]);

  useEffect(() => {
    stopped.current = false;
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => { stopped.current = true; window.clearInterval(timer); audio.current?.pause(); };
  }, [poll]);

  useEffect(() => {
    if (!current || !audio.current) return;
    const source = new URL(current.mediaUrl, connection.endpointOrigin);
    if (source.origin !== connection.endpointOrigin) { setStatus("The Edge returned an untrusted media address."); return; }
    audio.current.src = source.href;
    audio.current.load();
    audio.current.play().catch(() => setStatus("Press Play to start the approved private audio."));
  }, [connection.endpointOrigin, current]);

  return <section aria-label="Private Secure Edge player">
    <h2>Private Ruvanas Inside · Secure Edge</h2>
    <p role="status">{status}</p>
    <p>Facility player: {connection.playerId} · This player cannot browse or download the catalogue.</p>
    {current ? <audio ref={audio} controls controlsList="nodownload noremoteplayback" preload="auto"
      onContextMenu={(event) => event.preventDefault()} style={{ width: "100%" }}
      onEnded={async () => { await closePlayback("COMPLETED"); active.current = null; setCurrent(null); poll(); }}
      onError={async () => { await closePlayback("FAILED"); active.current = null; setCurrent(null); }} /> :
      <button type="button" onClick={poll}>Retry private connection</button>}
  </section>;
}
