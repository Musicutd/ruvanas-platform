import { createHash, randomBytes, randomUUID, sign, timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { verifyCorrectionsEdgePlayerGrant } from "../lib/corrections-edge-player-grant.mjs";
import { resolveCorrectionsEdgePlayback } from "./resolver.mjs";
import { edgeAttestationBytes } from "../lib/corrections-edge-attestation.mjs";
import { issueLocalEdgeLease, verifyLocalEdgeLease } from "./local-lease.mjs";

function respond(response, status, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": bytes.length,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers });
  response.end(bytes);
}

function playerGrant(request, cache) {
  if (cache.suspended) return null;
  const auth = request.headers.authorization || "";
  if (auth.startsWith("EdgeSession ")) {
    const lease = verifyLocalEdgeLease(auth.slice(12), cache.key, { type: "access",
      scope: { ...cache.scope, manifestVersion: cache.active?.version,
        manifestValidUntil: cache.active?.payload.validUntil }, now: cache.trustedNow() });
    if (!lease) return null;
    const zone = cache.active?.payload.zones.find((item) => item.id === lease.zoneId &&
      item.playerIds.includes(lease.playerId));
    return zone ? lease : null;
  }
  if (!auth.startsWith("Edge ") || auth.length > 5000) return null;
  let grant;
  try { grant = JSON.parse(Buffer.from(auth.slice(5), "base64url").toString("utf8")); }
  catch { return null; }
  if (!verifyCorrectionsEdgePlayerGrant(grant, cache.publicKeyPem, cache.scope, cache.trustedNow()) ||
      grant.payload.manifestVersion !== cache.active?.version) return null;
  const zone = cache.active?.payload.zones.find((item) => item.id === grant.payload.zoneId &&
    item.playerIds.includes(grant.payload.playerId));
  return zone ? grant.payload : null;
}

function mediaOpaque(cache, grant, contentKey) {
  return createHash("sha256").update([cache.scope.nodeId, grant.playerId, cache.active.version, contentKey].join(":"))
    .digest("hex");
}

async function smallBody(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk.toString("utf8");
    if (text.length > 16_384) throw new Error("Edge player request is too large.");
  }
  return JSON.parse(text);
}

export function createCorrectionsEdgeServer({ cache, proofQueue = null, host = "127.0.0.1", port = 0,
  tlsKeyPem, tlsCertPem, endpointOrigin = null, allowedPlayerOrigin = null }) {
  if (!cache || (host !== "127.0.0.1" && host !== "localhost" && (!tlsKeyPem || !tlsCertPem))) {
    throw new Error("A non-loopback Edge player service requires configured TLS.");
  }
  const unavailable = new Set();
  const sessions = new Map();
  let trustedEndpointOrigin = endpointOrigin;
  let seenCacheRevision = cache.cacheRevision;
  const handler = async (request, response) => {
    try {
      if (seenCacheRevision !== cache.cacheRevision) { unavailable.clear(); seenCacheRevision = cache.cacheRevision; }
      const url = new URL(request.url, "https://edge.invalid");
      const pathname = url.pathname;
      const origin = request.headers.origin;
      if (origin && (!allowedPlayerOrigin || origin !== allowedPlayerOrigin)) {
        return respond(response, 403, { error: "This browser origin is not authorised for the facility Edge." });
      }
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
        response.setHeader("Access-Control-Allow-Private-Network", "true");
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") return respond(response, 204, {});
      if (request.method === "GET" && pathname === "/v1/attest") {
        const nonce = url.searchParams.get("nonce");
        if (!proofQueue?.privateKeyPem || !trustedEndpointOrigin ||
            !/^[0-9a-f-]{36}$/i.test(nonce || "") || new URL(trustedEndpointOrigin).host !== request.headers.host) {
          return respond(response, 403, { error: "This Edge endpoint cannot attest to the requested identity." });
        }
        const payload = { schema: 1, nodeId: cache.scope.nodeId, facilityId: cache.scope.facilityId,
          endpointOrigin: trustedEndpointOrigin, nonce, issuedAt: cache.trustedNow().toISOString() };
        return respond(response, 200, { payload,
          signature: sign(null, edgeAttestationBytes(payload), proofQueue.privateKeyPem).toString("base64url") });
      }
      if (request.method === "POST" && pathname === "/v1/session") {
        const body = await smallBody(request);
        const authorization = `Edge ${Buffer.from(JSON.stringify(body?.grant)).toString("base64url")}`;
        const grant = playerGrant({ headers: { authorization } }, cache);
        if (!grant) return respond(response, 401, { error: "A current cloud-signed player grant is required." });
        const now = cache.trustedNow();
        const scope = { ...cache.scope, zoneId: grant.zoneId, playerId: grant.playerId,
          manifestVersion: cache.active.version };
        const expiry = new Date(Math.min(Date.parse(cache.active.payload.validUntil), now.getTime() + 5 * 60_000));
        return respond(response, 200, { accessToken: issueLocalEdgeLease(scope, cache.key,
          { type: "access", now, validUntil: expiry }), accessValidUntil: expiry.toISOString(),
          refreshToken: issueLocalEdgeLease(scope, cache.key,
            { type: "refresh", now, validUntil: cache.active.payload.validUntil }),
          manifestVersion: cache.active.version });
      }
      if (request.method === "POST" && pathname === "/v1/renew") {
        const body = await smallBody(request);
        const now = cache.trustedNow();
        const refresh = !cache.suspended && verifyLocalEdgeLease(body?.refreshToken, cache.key,
          { type: "refresh", scope: { ...cache.scope, manifestVersion: cache.active?.version,
            manifestValidUntil: cache.active?.payload.validUntil }, now });
        if (!refresh || !cache.active.payload.zones.some((zone) => zone.id === refresh.zoneId &&
            zone.playerIds.includes(refresh.playerId))) {
          return respond(response, 401, { error: "This Edge player lease is no longer authorised." });
        }
        const expiry = new Date(Math.min(Date.parse(cache.active.payload.validUntil), now.getTime() + 5 * 60_000));
        return respond(response, 200, { accessToken: issueLocalEdgeLease({ ...cache.scope,
          zoneId: refresh.zoneId, playerId: refresh.playerId, manifestVersion: cache.active.version }, cache.key,
        { type: "access", now, validUntil: expiry }), accessValidUntil: expiry.toISOString() });
      }
      const mediaRequest = request.method === "GET" && /^\/v1\/media\/[a-f0-9]{64}$/.test(pathname);
      const mediaSession = mediaRequest ? sessions.get(url.searchParams.get("session")) : null;
      const grant = mediaRequest ? (!cache.suspended && mediaSession?.grant) : playerGrant(request, cache);
      if (!grant) return respond(response, 401, { error: "A current, scoped Edge player grant is required." });
      const decision = resolveCorrectionsEdgePlayback(cache.active?.payload, {
        zoneId: grant.zoneId, playerId: grant.playerId, instant: cache.trustedNow(), unavailableContentKeys: unavailable
      });
      if (request.method === "GET" && pathname === "/v1/playback") {
        if (decision.state !== "READY") return respond(response, 200, { state: decision.state, refreshAfterSeconds: 5 });
        try { await cache.readMedia(decision.contentKey); }
        catch {
          unavailable.add(decision.contentKey);
          return respond(response, 200, { state: "CONTENT_UNAVAILABLE", refreshAfterSeconds: 5 });
        }
        let sessionId = [...sessions].find(([, session]) => !session.ended &&
          session.playerId === grant.playerId && session.zoneId === grant.zoneId &&
          session.manifestVersion === cache.active.version &&
          session.decision.contentKey === decision.contentKey && session.decision.source === decision.source)?.[0];
        if (!sessionId) {
          sessionId = randomUUID();
          if (sessions.size >= 5000) for (const [id, session] of sessions) {
            if (cache.trustedNow().getTime() - session.createdAt > 2 * 60 * 60_000 || session.ended) sessions.delete(id);
          }
          if (sessions.size >= 5000) return respond(response, 503, { error: "Edge player session capacity reached." });
          sessions.set(sessionId, { playerId: grant.playerId, zoneId: grant.zoneId, grant, decision,
            ticket: randomBytes(32).toString("base64url"), manifestVersion: cache.active.version,
            createdAt: cache.trustedNow().getTime(), startedAt: null, ended: false });
        }
        const session = sessions.get(sessionId);
        return respond(response, 200, { state: "READY", source: decision.source, sessionId,
          mediaUrl: `/v1/media/${mediaOpaque(cache, grant, decision.contentKey)}?session=${sessionId}&ticket=${session.ticket}`,
          durationSeconds: decision.item.durationSeconds, manifestVersion: cache.active.version,
          refreshAfterSeconds: 5 });
      }
      if (mediaRequest) {
        const session = mediaSession;
        const suppliedTicket = url.searchParams.get("ticket") || "";
        if (!session || !/^[A-Za-z0-9_-]{43}$/.test(suppliedTicket) ||
            !timingSafeEqual(Buffer.from(suppliedTicket), Buffer.from(session.ticket)) ||
            session.playerId !== grant.playerId || session.zoneId !== grant.zoneId ||
            session.manifestVersion !== cache.active?.version || session.decision.contentKey !== decision.contentKey || session.ended) {
          return respond(response, 403, { error: "This player session is not current." });
        }
        if (decision.state !== "READY" || pathname.slice(10) !== mediaOpaque(cache, grant, decision.contentKey)) {
          return respond(response, 404, { error: "Media is not this player's current approved item." });
        }
        let media;
        try { media = await cache.readMedia(decision.contentKey); }
        catch { unavailable.add(decision.contentKey); return respond(response, 503, { error: "Protected Edge content is unavailable." }); }
        const total = media.bytes.length;
        const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
        const start = match ? Number(match[1]) : 0;
        const end = match ? Math.min(match[2] ? Number(match[2]) : total - 1, total - 1) : total - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= total) {
          response.writeHead(416, { "Content-Range": `bytes */${total}` }); return response.end();
        }
        if (proofQueue && !session.startedAt) {
          const now = cache.trustedNow();
          await proofQueue.append({ schema: 1, ...cache.scope, zoneId: grant.zoneId, playerId: grant.playerId,
            eventId: randomUUID(), sessionId: url.searchParams.get("session"), manifestVersion: cache.active.version,
            contentKey: decision.contentKey, programmingSource: decision.source, windowId: decision.windowId || null,
            overrideId: decision.overrideId || null, insertionId: decision.insertionId || null,
            eventType: "STARTED", occurredAt: now.toISOString(), positionSeconds: 0 });
          session.startedAt = now.getTime();
        }
        response.writeHead(match ? 206 : 200, { "Content-Type": media.mimeType,
          "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store",
          "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
          ...(match ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}) });
        return response.end(media.bytes.subarray(start, end + 1));
      }
      if (request.method === "POST" && pathname === "/v1/proof" && proofQueue) {
        const body = await smallBody(request);
        const session = sessions.get(body?.sessionId);
        if (!session || session.playerId !== grant.playerId || session.zoneId !== grant.zoneId ||
            !session.startedAt || session.ended || !["COMPLETED", "FAILED", "INTERRUPTED"].includes(body.eventType)) {
          return respond(response, 400, { error: "No started Edge playback session matches this proof." });
        }
        const now = cache.trustedNow();
        const position = Number(body.positionSeconds);
        const duration = session.decision.item.durationSeconds;
        if (body.eventType === "COMPLETED" && (cache.active?.version !== session.manifestVersion ||
            decision.state !== "READY" || decision.contentKey !== session.decision.contentKey ||
            decision.source !== session.decision.source)) {
          return respond(response, 409, { error: "Current private programming changed; report interruption instead." });
        }
        if (!Number.isSafeInteger(position) || position < 0 || position > Math.ceil(duration) + 5 ||
            (body.eventType === "COMPLETED" && (position < Math.max(1, Math.floor(duration - 5)) ||
              now.getTime() - session.startedAt < Math.max(1, duration - 5) * 1000))) {
          return respond(response, 400, { error: "The claimed playback duration is not possible." });
        }
        await proofQueue.append({ schema: 1, ...cache.scope, zoneId: grant.zoneId, playerId: grant.playerId,
          eventId: randomUUID(), sessionId: body.sessionId, manifestVersion: session.manifestVersion,
          contentKey: session.decision.contentKey, programmingSource: session.decision.source,
          windowId: session.decision.windowId || null, overrideId: session.decision.overrideId || null,
          insertionId: session.decision.insertionId || null,
          eventType: body.eventType, occurredAt: now.toISOString(), positionSeconds: position });
        session.ended = true;
        return respond(response, 200, { queued: true, pendingProofCount: proofQueue.pendingCount });
      }
      return respond(response, 404, { error: "No such Edge player action." });
    } catch { return respond(response, 503, { error: "Edge playback is unavailable." }); }
  };
  const server = tlsKeyPem && tlsCertPem ? https.createServer({ key: tlsKeyPem, cert: tlsCertPem }, handler)
    : http.createServer(handler);
  return { server, listen: () => new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(port, host, () => {
      server.off("error", reject);
      if (!trustedEndpointOrigin && ["127.0.0.1", "localhost"].includes(host)) {
        trustedEndpointOrigin = `http://${host}:${server.address().port}`;
      }
      resolve(server.address());
    });
  }) };
}
