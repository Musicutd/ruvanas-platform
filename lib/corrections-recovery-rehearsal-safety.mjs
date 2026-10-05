import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const RECOVERY_DATABASES = Object.freeze({ source: "ruvanas_c9_recovery_source", target: "ruvanas_c9_recovery_target" });
const SAFE_RUN = /^ruvanas-c9-recovery-[0-9a-f]{32}$/;
const SAFE_CONTAINER = /^[0-9a-f]{64}$/;
export const RECOVERY_LABEL = "com.ruvanas.c9-recovery-run";

export function assertRecoveryRehearsalEnvironment(environment, platform = process.platform, argv = []) {
  if (platform !== "linux" || environment.GITHUB_ACTIONS !== "true" || environment.CI !== "true" ||
      environment.C9_RECOVERY_REHEARSAL !== "true" || environment.RUNNER_ENVIRONMENT !== "github-hosted" ||
      environment.GITHUB_REPOSITORY !== "Musicutd/ruvanas-platform" || environment.GITHUB_EVENT_NAME !== "pull_request" || argv.length) {
    throw new Error("RECOVERY_REHEARSAL_ENVIRONMENT_DENIED");
  }
  if (Object.entries(environment).some(([key, value]) => value &&
      /^(DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGSERVICEFILE|PGPASSFILE|SESSION_SECRET|SECRET_ENCRYPTION_KEY|R2_.+|AWS_.+|RENDER_.+)$/.test(key))) {
    throw new Error("RECOVERY_REHEARSAL_EXTERNAL_CONFIGURATION_DENIED");
  }
}

export function assertOwnedRecoveryContainer(container, { id, name, nonce }) {
  if (!SAFE_CONTAINER.test(id || "") || !SAFE_RUN.test(name || "") || !/^[0-9a-f]{32}$/.test(nonce || "") ||
      name !== `ruvanas-c9-recovery-${nonce}` || container?.Id !== id || container?.Name !== `/${name}` ||
      container?.Config?.Image !== "postgres:16" || container.Config.Labels?.[RECOVERY_LABEL] !== nonce) {
    throw new Error("RECOVERY_REHEARSAL_CONTAINER_IDENTITY_DENIED");
  }
}

function privateIPv4(value) {
  if (typeof value !== "string" || isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
const ipv4Number = (value) => value.split(".").reduce((result, octet) => result * 256 + Number(octet), 0);

export function assertOwnedRecoveryNetwork(network, { id, name, nonce }) {
  const configurations = network?.IPAM?.Config || [];
  const subnet = configurations[0]?.Subnet || "";
  const [base, prefix] = subnet.split("/");
  if (!SAFE_CONTAINER.test(id || "") || !/^[0-9a-f]{32}$/.test(nonce || "") || name !== `ruvanas-c9-recovery-${nonce}-network` ||
      network?.Id !== id || network.Name !== name || network.Internal !== true || network.Driver !== "bridge" ||
      network.Scope !== "local" || network.Labels?.[RECOVERY_LABEL] !== nonce || configurations.length !== 1 ||
      !privateIPv4(base) || !/^\d{1,2}$/.test(prefix || "") || Number(prefix) < 8 || Number(prefix) > 30) {
    throw new Error("RECOVERY_REHEARSAL_NETWORK_BOUNDARY_DENIED");
  }
}

export function recoveryContainerAddress(container, ownership, network) {
  assertOwnedRecoveryContainer(container, ownership);
  assertOwnedRecoveryNetwork(network, { id: network?.Id, name: `${ownership.name}-network`, nonce: ownership.nonce });
  const networks = Object.keys(container.NetworkSettings?.Networks || {});
  const endpoint = container.NetworkSettings?.Networks?.[network.Name];
  const ports = container.NetworkSettings?.Ports || {};
  const [base, prefixText] = network.IPAM.Config[0].Subnet.split("/");
  const prefix = Number(prefixText), mask = (0xffffffff << (32 - prefix)) >>> 0;
  const address = endpoint?.IPAddress, addressNumber = privateIPv4(address) ? ipv4Number(address) : 0;
  const subnetNumber = ipv4Number(base), networkNumber = (subnetNumber & mask) >>> 0;
  const currentEndpoint = network.Containers?.[ownership.id];
  if (!container.State?.Running || networks.length !== 1 || networks[0] !== network.Name ||
      container.HostConfig?.NetworkMode !== network.Name || endpoint?.NetworkID !== network.Id || !privateIPv4(address) ||
      endpoint.IPPrefixLen !== prefix || ((addressNumber & mask) >>> 0) !== networkNumber ||
      addressNumber === networkNumber || addressNumber === networkNumber + (2 ** (32 - prefix)) - 1 ||
      address === network.IPAM.Config[0].Gateway || Object.keys(network.Containers || {}).length !== 1 ||
      currentEndpoint?.Name !== ownership.name || currentEndpoint?.IPv4Address !== `${address}/${prefix}` ||
      Object.keys(ports).some((key) => key !== "5432/tcp") || Object.values(ports).some((bindings) => bindings !== null && (!Array.isArray(bindings) || bindings.length)) ||
      Object.keys(container.HostConfig?.PortBindings || {}).length ||
      !container.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"] ||
      container.Mounts?.some((mount) => mount.Type === "bind" || mount.Type === "volume")) {
    throw new Error("RECOVERY_REHEARSAL_CONTAINER_BOUNDARY_DENIED");
  }
  return address;
}

export function assertRecoveryDatabaseUrl(value, { host, port, password, database }) {
  let url;
  try { url = new URL(value); } catch { throw new Error("RECOVERY_REHEARSAL_DATABASE_BOUNDARY_DENIED"); }
  if (!privateIPv4(host) || port !== 5432 || !Object.values(RECOVERY_DATABASES).includes(database) || url.protocol !== "postgresql:" ||
      url.hostname !== host || url.port !== String(port) || url.username !== "postgres" ||
      url.password !== password || url.pathname !== `/${database}` || url.search || url.hash) {
    throw new Error("RECOVERY_REHEARSAL_DATABASE_BOUNDARY_DENIED");
  }
}

export function verifyRecoveryBytes(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(expected?.sizeBytes) || bytes.length !== expected.sizeBytes ||
      !/^[0-9a-f]{64}$/.test(expected.checksumSha256 || "") ||
      createHash("sha256").update(bytes).digest("hex") !== expected.checksumSha256) {
    throw new Error("RECOVERY_REHEARSAL_MEDIA_INTEGRITY_FAILED");
  }
}

// Independent owned resources must still be cleaned up if another fails.
// Never return dependency errors or permit an incomplete cleanup to mean PASS.
export async function runRecoveryCleanup(actions) {
  const failures = [];
  for (const [key, code] of [["disconnectSource", "SOURCE_DISCONNECT"], ["disconnectTarget", "TARGET_DISCONNECT"],
    ["removeContainer", "CONTAINER"], ["removeNetwork", "NETWORK"], ["removeTemporaryDirectory", "TEMPORARY_DIRECTORY"]]) {
    try { await actions[key](); } catch { failures.push(code); }
  }
  return failures;
}
