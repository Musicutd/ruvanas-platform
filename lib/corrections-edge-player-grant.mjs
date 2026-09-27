import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { canonicalEdgeJson } from "./corrections-edge-manifest.mjs";

const DOMAIN = Buffer.from("ruvanas-inside-edge-player-grant-v1\0", "utf8");
const MAX_GRANT_MS = 24 * 60 * 60_000;
const bytes = (payload) => Buffer.concat([DOMAIN, Buffer.from(canonicalEdgeJson(payload), "utf8")]);

export function issueCorrectionsEdgePlayerGrant(scope, privateKeyPem, { now = new Date(), validUntil } = {}) {
  const issued = new Date(now);
  const until = new Date(validUntil);
  if (!scope?.nodeId || !scope.organisationId || !scope.facilityId || !scope.zoneId || !scope.playerId ||
      !Number.isFinite(issued.getTime()) || !Number.isFinite(until.getTime()) || until <= issued ||
      until.getTime() - issued.getTime() > MAX_GRANT_MS) throw new Error("Invalid bounded Edge player grant scope.");
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("An Ed25519 cloud signing key is required.");
  const payload = { schema: 1, ...scope, grantId: randomUUID(), issuedAt: issued.toISOString(), validUntil: until.toISOString() };
  return { payload, signature: sign(null, bytes(payload), key).toString("base64url") };
}

export function verifyCorrectionsEdgePlayerGrant(grant, publicKeyPem, scope, now = new Date()) {
  try {
    const payload = grant?.payload;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519" || payload?.schema !== 1 ||
        payload.nodeId !== scope.nodeId || payload.organisationId !== scope.organisationId ||
        payload.facilityId !== scope.facilityId || !payload.zoneId || !payload.playerId ||
        !/^[0-9a-f-]{36}$/i.test(payload.grantId || "") ||
        typeof grant.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(grant.signature)) return false;
    const issued = Date.parse(payload.issuedAt);
    const until = Date.parse(payload.validUntil);
    const clock = new Date(now).getTime();
    if (!Number.isFinite(issued) || !Number.isFinite(until) || until <= clock || issued > clock + 5 * 60_000 ||
        until <= issued || until - issued > MAX_GRANT_MS) return false;
    return verify(null, bytes(payload), key, Buffer.from(grant.signature, "base64url"));
  } catch { return false; }
}
