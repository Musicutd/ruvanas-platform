import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { verifyCorrectionsEdgePlayerGrant } from "../lib/corrections-edge-player-grant.mjs";
import { resolveCorrectionsEdgePlayback } from "./resolver.mjs";

function respond(response, status, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": bytes.length,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers });
  response.end(bytes);
}

function playerGrant(request, cache) {
  const auth = request.headers.authorization || "";
  if (!auth.startsWith("Edge ") || auth.length > 5000) return null;
  let grant;
  try { grant = JSON.parse(Buffer.from(auth.slice(5), "base64url").toString("utf8")); }
  catch { return null; }
  if (!verifyCorrectionsEdgePlayerGrant(grant, cache.publicKeyPem, cache.scope, cache.trustedNow())) return null;
  const zone = cache.active?.payload.zones.find((item) => item.id === grant.payload.zoneId &&
    item.playerIds.includes(grant.payload.playerId));
  return zone ? grant.payload : null;
}

function mediaOpaque(cache, grant, contentKey) {
  return createHash("sha256").update([cache.scope.nodeId, grant.playerId, cache.active.version, contentKey].join(":"))
    .digest("hex");
}

export function createCorrectionsEdgeServer({ cache, host = "127.0.0.1", port = 0, tlsKeyPem, tlsCertPem }) {
  if (!cache || (host !== "127.0.0.1" && host !== "localhost" && (!tlsKeyPem || !tlsCertPem))) {
    throw new Error("A non-loopback Edge player service requires configured TLS.");
  }
  const unavailable = new Set();
  let seenCacheRevision = cache.cacheRevision;
  const handler = async (request, response) => {
    try {
      if (seenCacheRevision !== cache.cacheRevision) { unavailable.clear(); seenCacheRevision = cache.cacheRevision; }
      const pathname = new URL(request.url, "https://edge.invalid").pathname;
      const grant = playerGrant(request, cache);
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
        return respond(response, 200, { state: "READY", source: decision.source,
          mediaUrl: `/v1/media/${mediaOpaque(cache, grant, decision.contentKey)}`,
          durationSeconds: decision.item.durationSeconds, manifestVersion: cache.active.version,
          refreshAfterSeconds: 5 });
      }
      if (request.method === "GET" && /^\/v1\/media\/[a-f0-9]{64}$/.test(pathname)) {
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
        response.writeHead(match ? 206 : 200, { "Content-Type": media.mimeType,
          "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store",
          "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff",
          ...(match ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}) });
        return response.end(media.bytes.subarray(start, end + 1));
      }
      return respond(response, 404, { error: "No such Edge player action." });
    } catch { return respond(response, 503, { error: "Edge playback is unavailable." }); }
  };
  const server = tlsKeyPem && tlsCertPem ? https.createServer({ key: tlsKeyPem, cert: tlsCertPem }, handler)
    : http.createServer(handler);
  return { server, listen: () => new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(server.address()); });
  }) };
}
