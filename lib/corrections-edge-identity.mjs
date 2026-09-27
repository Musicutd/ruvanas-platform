import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const NODE_ID = /^[a-z0-9]{20,40}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function createEdgeCredential(nodeId, kind = "machine") {
  if (!NODE_ID.test(String(nodeId))) throw new TypeError("A valid Edge node ID is required.");
  const prefix = kind === "enrolment" ? "rvee" : kind === "machine" ? "rve" : null;
  if (!prefix) throw new TypeError("Unknown Edge credential type.");
  return `${prefix}.${nodeId}.${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function parseEdgeCredential(value, kind = "machine") {
  const prefix = kind === "enrolment" ? "rvee" : kind === "machine" ? "rve" : null;
  const parts = typeof value === "string" ? value.split(".") : [];
  if (!prefix || parts.length !== 3 || parts[0] !== prefix || !NODE_ID.test(parts[1]) || !SECRET.test(parts[2])) return null;
  return { nodeId: parts[1] };
}

export function hashEdgeCredential(value, secret) {
  if (typeof value !== "string" || typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("A credential and a strong server secret are required.");
  }
  return createHmac("sha256", secret).update("ruvanas-edge-credential-v1\0").update(value).digest("hex");
}

export function edgeCredentialMatches(value, expectedHash, secret) {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = hashEdgeCredential(value, secret);
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expectedHash, "hex"));
}

export function edgeNodeIsUsable(node, now = new Date()) {
  return Boolean(node && node.status === "ACTIVE" && node.enrolledAt && node.credentialHash &&
    !node.revokedAt && node.facility?.organisationId === node.organisationId &&
    node.facility?.status === "ACTIVE" && node.facility?.correctionsFacility &&
    new Date(now).getTime() >= new Date(node.enrolledAt).getTime());
}
