import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalEdgeJson } from "../lib/corrections-edge-manifest.mjs";

const DOMAIN = "ruvanas-inside-edge-local-lease-v1\0";
const mac = (payload, key) => createHmac("sha256", key).update(DOMAIN + canonicalEdgeJson(payload)).digest("base64url");

export function issueLocalEdgeLease(scope, key, { type, now, validUntil }) {
  const payload = { schema: 1, type, ...scope, issuedAt: new Date(now).toISOString(),
    validUntil: new Date(validUntil).toISOString() };
  return Buffer.from(JSON.stringify({ payload, signature: mac(payload, key) })).toString("base64url");
}

export function verifyLocalEdgeLease(token, key, { type, scope, now }) {
  try {
    if (typeof token !== "string" || token.length > 3000) return null;
    const { payload, signature } = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (payload?.schema !== 1 || payload.type !== type || !/^[A-Za-z0-9_-]{43}$/.test(signature || "") ||
        payload.nodeId !== scope.nodeId || payload.organisationId !== scope.organisationId ||
        payload.facilityId !== scope.facilityId || payload.manifestVersion !== scope.manifestVersion ||
        !payload.zoneId || !payload.playerId || Date.parse(payload.issuedAt) > new Date(now).getTime() + 60_000 ||
        new Date(now).getTime() >= Date.parse(payload.validUntil) ||
        Date.parse(payload.validUntil) > Date.parse(scope.manifestValidUntil)) return null;
    const expected = mac(payload, key);
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? payload : null;
  } catch { return null; }
}
