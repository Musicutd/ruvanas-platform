import { canonicalEdgeJson } from "./corrections-edge-canonical.mjs";

const PREFIX = "ruvanas-inside-edge-endpoint-v1\0";
const bytes = (payload) => new TextEncoder().encode(PREFIX + canonicalEdgeJson(payload));

export async function verifyCorrectionsEdgeAttestation(attestation, expected, now = new Date(), cryptoApi = globalThis.crypto) {
  try {
    const payload = attestation?.payload;
    if (payload?.schema !== 1 || payload.nodeId !== expected.nodeId ||
        payload.facilityId !== expected.facilityId || payload.endpointOrigin !== expected.endpointOrigin ||
        payload.nonce !== expected.nonce || !/^[0-9a-f-]{36}$/i.test(payload.nonce) ||
        Math.abs(new Date(now).getTime() - Date.parse(payload.issuedAt)) > 2 * 60_000 ||
        typeof attestation.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(attestation.signature)) return false;
    const pem = expected.identityPublicKeyPem;
    if (typeof pem !== "string" || !pem.includes("BEGIN PUBLIC KEY")) return false;
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")), (letter) => letter.charCodeAt(0));
    const signature = Uint8Array.from(atob(attestation.signature.replace(/-/g, "+").replace(/_/g, "/")),
      (letter) => letter.charCodeAt(0));
    const key = await cryptoApi.subtle.importKey("spki", der, "Ed25519", false, ["verify"]);
    return cryptoApi.subtle.verify("Ed25519", key, signature, bytes(payload));
  } catch { return false; }
}

export function edgeAttestationBytes(payload) { return bytes(payload); }
