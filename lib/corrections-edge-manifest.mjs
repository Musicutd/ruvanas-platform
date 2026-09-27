import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const EDGE_MANIFEST_SCHEMA = 1;
const DOMAIN = Buffer.from("ruvanas-inside-edge-manifest-v1\0", "utf8");

export function canonicalEdgeJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Manifest numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalEdgeJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalEdgeJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Manifest contains an unsupported value.");
}

function manifestBytes(payload) {
  return Buffer.concat([DOMAIN, Buffer.from(canonicalEdgeJson(payload), "utf8")]);
}

export function edgeManifestVersion(payload) {
  return createHash("sha256").update(manifestBytes(payload)).digest("hex");
}

export function signEdgeManifest(payload, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("An Ed25519 manifest signing key is required.");
  return { payload, version: edgeManifestVersion(payload), signature: sign(null, manifestBytes(payload), key).toString("base64url") };
}

export function verifyEdgeManifest(envelope, publicKeyPem, scope, { now = new Date(), lastSequence = 0 } = {}) {
  try {
    const payload = envelope?.payload;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519" || !payload || payload.schema !== EDGE_MANIFEST_SCHEMA ||
        payload.organisationId !== scope.organisationId || payload.facilityId !== scope.facilityId || payload.nodeId !== scope.nodeId ||
        !Number.isSafeInteger(payload.sequence) || payload.sequence <= lastSequence ||
        !Array.isArray(payload.zones) || !Array.isArray(payload.content) ||
        !/^[a-f0-9]{64}$/.test(envelope.version) || envelope.version !== edgeManifestVersion(payload) ||
        typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return false;
    const issued = Date.parse(payload.issuedAt);
    const until = Date.parse(payload.validUntil);
    const clock = new Date(now).getTime();
    if (!Number.isFinite(issued) || !Number.isFinite(until) || issued > clock + 5 * 60_000 ||
        until <= clock || until <= issued || until - issued > 7 * 24 * 60 * 60_000) return false;
    return verify(null, manifestBytes(payload), key, Buffer.from(envelope.signature, "base64url"));
  } catch { return false; }
}
