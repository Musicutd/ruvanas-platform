import { createPrivateKey, createPublicKey, randomUUID, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import { checkServerIdentity } from "node:tls";
import { fileURLToPath } from "node:url";
import { verifyCorrectionsEdgeAttestation } from "../lib/corrections-edge-attestation.mjs";
import { isPrivateLanIpv4 } from "./c8-lan-proxy.mjs";

function exactPrivateOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !isPrivateLanIpv4(url.hostname) ||
      url.origin !== value.replace(/\/$/, "") || url.pathname !== "/" ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Lab endpoints must be exact HTTPS RFC1918 IP origins.");
  }
  return url;
}

export function validateLanPreflightConfig(env) {
  if (env.C8_TWO_HOST_LAB !== "true" || env.C8_SYNTHETIC_ONLY !== "true" || env.NODE_ENV === "production") {
    throw new Error("Two-host preflight requires explicit non-production, synthetic-only flags.");
  }
  const cloud = exactPrivateOrigin(env.C8_LAN_CLOUD_ORIGIN);
  const edge = exactPrivateOrigin(env.C8_LAN_EDGE_ORIGIN);
  if (cloud.hostname === edge.hostname) throw new Error("Cloud and Edge must be on different LAN PCs.");
  for (const key of ["C8_LAN_CA_CERT_FILE", "C8_LAN_EDGE_CA_CERT_FILE", "C8_LAN_BOOTSTRAP_FILE"]) {
    if (!env[key]) throw new Error(`${key} is required for the isolated LAN preflight.`);
  }
  return { cloud, edge, cloudCa: env.C8_LAN_CA_CERT_FILE,
    edgeCa: env.C8_LAN_EDGE_CA_CERT_FILE, bundle: env.C8_LAN_BOOTSTRAP_FILE };
}

function getJson(url, caFile, origin) {
  const ca = readFileSync(caFile);
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: "GET", ca, rejectUnauthorized: true,
      checkServerIdentity: (_host, cert) => checkServerIdentity(url.hostname, cert),
      headers: origin ? { Origin: origin } : {}, timeout: 5000 }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 65536) request.destroy(new Error("Lab probe response exceeded 64 KiB."));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* Auth denials may be text. */ }
        resolve({ status: response.statusCode, body,
          allowedOrigin: response.headers["access-control-allow-origin"] });
      });
    });
    request.on("timeout", () => request.destroy(new Error("Lab TLS probe timed out.")));
    request.on("error", reject);
    request.end();
  });
}

export async function runLanPreflight(config) {
  const bundle = JSON.parse(readFileSync(config.bundle, "utf8"));
  if (!bundle.nodeId || !bundle.facilityId || !bundle.proofPrivateKeyPem) {
    throw new Error("Synthetic Edge bootstrap file lacks its scoped test identity.");
  }
  const cloudDenied = await getJson(new URL("/api/corrections/edge/manifest", config.cloud), config.cloudCa);
  if (![401, 403].includes(cloudDenied.status)) {
    throw new Error("The lab cloud machine route did not reject an unauthenticated TLS probe.");
  }
  const nonce = randomUUID();
  const playerOrigin = "http://127.0.0.1:3108";
  const attestation = await getJson(new URL(`/v1/attest?nonce=${nonce}`, config.edge),
    config.edgeCa, playerOrigin);
  if (attestation.status !== 200 || attestation.allowedOrigin !== playerOrigin) {
    throw new Error("The LAN Edge did not attest over trusted TLS for the exact local player origin.");
  }
  const identityPublicKeyPem = createPublicKey(createPrivateKey(bundle.proofPrivateKeyPem))
    .export({ type: "spki", format: "pem" });
  if (!await verifyCorrectionsEdgeAttestation(attestation.body, {
    nodeId: bundle.nodeId, facilityId: bundle.facilityId,
    endpointOrigin: config.edge.origin, nonce, identityPublicKeyPem
  }, new Date(), webcrypto)) {
    throw new Error("The LAN Edge's signed node/facility/endpoint identity did not verify.");
  }
  return { cloudTlsAndAuth: "PASS", edgeTlsCorsAndAttestation: "PASS" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await runLanPreflight(validateLanPreflightConfig(process.env));
    console.info(JSON.stringify(result));
  } catch (error) {
    console.error(`C8 LAN preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
