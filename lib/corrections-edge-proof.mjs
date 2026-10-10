import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalEdgeJson } from "./corrections-edge-manifest.mjs";

const DOMAIN = Buffer.from("ruvanas-inside-edge-proof-v1\0", "utf8");
const HEX = /^[a-f0-9]{64}$/;

export function edgeProofHash(sequence, previousHash, payload) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 ||
      (previousHash !== null && !HEX.test(previousHash))) throw new Error("Invalid Edge proof chain position.");
  return createHash("sha256").update(DOMAIN).update(canonicalEdgeJson({ sequence, previousHash, payload })).digest("hex");
}

export function signCorrectionsEdgeProof(sequence, previousHash, payload, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("An Ed25519 Edge proof key is required.");
  const eventHash = edgeProofHash(sequence, previousHash, payload);
  return { sequence, previousHash, payload, eventHash,
    signature: sign(null, Buffer.from(eventHash, "hex"), key).toString("base64url") };
}

export function verifyCorrectionsEdgeProof(record, publicKeyPem, { sequence, previousHash } = {}) {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519" || record?.sequence !== sequence ||
        record.previousHash !== previousHash || !HEX.test(record.eventHash || "") ||
        !/^[A-Za-z0-9_-]{86}$/.test(record.signature || "") ||
        record.eventHash !== edgeProofHash(sequence, previousHash, record.payload)) return false;
    return verify(null, Buffer.from(record.eventHash, "hex"), key, Buffer.from(record.signature, "base64url"));
  } catch { return false; }
}

export function validCorrectionsEdgeProofPayload(payload, scope) {
  if (!payload || payload.schema !== 1 || payload.nodeId !== scope.nodeId ||
      payload.organisationId !== scope.organisationId || payload.facilityId !== scope.facilityId ||
      !/^[0-9a-f-]{36}$/i.test(payload.eventId || "") ||
      !/^[0-9a-f-]{36}$/i.test(payload.sessionId || "") ||
      !payload.zoneId || !payload.playerId || !HEX.test(payload.manifestVersion || "") ||
      !/^[a-zA-Z0-9_:-]{30,300}$/.test(payload.contentKey || "") ||
      !["STARTED", "COMPLETED", "FAILED", "INTERRUPTED"].includes(payload.eventType) ||
      !/^CORRECTIONS_[A-Z_]+$/.test(payload.programmingSource || "") ||
      !Number.isSafeInteger(payload.positionSeconds) || payload.positionSeconds < 0 || payload.positionSeconds > 86400 ||
      typeof payload.occurredAt !== "string" || !Number.isFinite(Date.parse(payload.occurredAt)) ||
      (payload.windowId !== null && typeof payload.windowId !== "string") ||
      (payload.overrideId !== null && typeof payload.overrideId !== "string") ||
      (payload.insertionId !== undefined && payload.insertionId !== null && typeof payload.insertionId !== "string")) return false;
  return true;
}
