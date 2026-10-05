import { createHash } from "node:crypto";

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

export function recoveryContainerPort(container, ownership, networkName) {
  assertOwnedRecoveryContainer(container, ownership);
  const networks = Object.keys(container.NetworkSettings?.Networks || {});
  const ports = container.NetworkSettings?.Ports;
  const bindings = ports?.["5432/tcp"];
  const port = bindings?.[0]?.HostPort;
  if (!container.State?.Running || networks.length !== 1 || networks[0] !== networkName ||
      !Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== "127.0.0.1" ||
      Object.keys(ports || {}).length !== 1 || !/^\d{1,5}$/.test(port || "") || Number(port) < 1024 || Number(port) > 65535 ||
      !container.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"] ||
      container.Mounts?.some((mount) => mount.Type === "bind" || mount.Type === "volume")) {
    throw new Error("RECOVERY_REHEARSAL_CONTAINER_BOUNDARY_DENIED");
  }
  return Number(port);
}

export function assertRecoveryDatabaseUrl(value, { port, password, database }) {
  let url;
  try { url = new URL(value); } catch { throw new Error("RECOVERY_REHEARSAL_DATABASE_BOUNDARY_DENIED"); }
  if (!Object.values(RECOVERY_DATABASES).includes(database) || url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" || url.port !== String(port) || url.username !== "postgres" ||
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
