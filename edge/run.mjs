import { createCorrectionsEdgeServer } from "./server.mjs";
import { CorrectionsEdgeSyncClient } from "./sync-client.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be provisioned before the Edge starts.`);
  return value.replace(/\\n/g, "\n");
};
const host = process.env.EDGE_LISTEN_HOST || "127.0.0.1";
const port = Number(process.env.EDGE_LISTEN_PORT || 8443);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Choose a valid Edge listen port.");
const scope = { nodeId: required("EDGE_NODE_ID"), organisationId: required("EDGE_ORGANISATION_ID"),
  facilityId: required("EDGE_FACILITY_ID") };
const client = new CorrectionsEdgeSyncClient({ cloudUrl: required("EDGE_CLOUD_URL"),
  machineCredential: required("EDGE_MACHINE_CREDENTIAL"), root: required("EDGE_CACHE_DIR"),
  cacheKey: required("EDGE_CACHE_KEY"), publicKeyPem: required("EDGE_CLOUD_PUBLIC_KEY"),
  proofPrivateKeyPem: required("EDGE_PROOF_PRIVATE_KEY"), scope });
try { await client.initialise(); }
catch (error) {
  if (!/active Edge manifest is invalid or expired/.test(error.message)) throw error;
  // An expired manifest is unavailable; a signed online sync may replace it.
  // A damaged proof journal, trusted clock or key fails startup instead.
}
try { await client.sync({ softwareVersion: process.env.EDGE_SOFTWARE_VERSION || "c8-development" }); }
catch { console.warn("Secure Edge cloud sync unavailable; only a still-valid signed local state can play."); }
const tlsKeyPem = process.env.EDGE_LOCAL_TLS_KEY?.replace(/\\n/g, "\n");
const tlsCertPem = process.env.EDGE_LOCAL_TLS_CERT?.replace(/\\n/g, "\n");
const local = createCorrectionsEdgeServer({ cache: client.cache, proofQueue: client.proofQueue,
  host, port, tlsKeyPem, tlsCertPem, endpointOrigin: process.env.EDGE_PLAYER_ORIGIN || null,
  allowedPlayerOrigin: process.env.EDGE_CLOUD_PLAYER_ORIGIN || null });
await local.listen();
console.info("Secure Edge private player service started.");

let syncing = false;
const interval = setInterval(async () => {
  if (syncing) return;
  syncing = true;
  try { await client.sync({ softwareVersion: process.env.EDGE_SOFTWARE_VERSION || "c8-development" }); }
  catch { console.warn("Secure Edge sync deferred; signed offline validity remains authoritative."); }
  finally { syncing = false; }
}, 30_000);
interval.unref();

for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  clearInterval(interval);
  local.server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
