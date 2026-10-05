import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  assertRecoveryDatabaseUrl, assertRecoveryRehearsalEnvironment, assertOwnedRecoveryContainer, assertOwnedRecoveryNetwork,
  RECOVERY_DATABASES, RECOVERY_LABEL, recoveryContainerAddress, runRecoveryCleanup, verifyRecoveryBytes
} from "../lib/corrections-recovery-rehearsal-safety.mjs";

// No supplied database, archive, target, object-store or Docker connection is
// accepted. This command creates its own synthetic isolated CI resources.
async function main() {
  assertRecoveryRehearsalEnvironment(process.env, process.platform, process.argv.slice(2));
  for (const directory of [process.cwd(), join(process.cwd(), "prisma")]) {
    const names = await readdir(directory);
    if (names.some((name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example")) {
      throw new Error("RECOVERY_REHEARSAL_ENV_FILE_DENIED");
    }
  }
  const startedAt = Date.now();
  const nonce = randomBytes(16).toString("hex");
  const name = `ruvanas-c9-recovery-${nonce}`;
  const networkName = `${name}-network`;
  const password = randomBytes(24).toString("hex");
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, "ruvanas-c9-recovery-"));
  const childEnvironment = Object.fromEntries(["PATH", "LANG", "TMPDIR"].filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]));
  const command = (binary, args, { input, environment = {}, timeout = 120_000 } = {}) => {
    const result = spawnSync(binary, args, { env: { ...childEnvironment, ...environment }, input,
      stdio: ["pipe", "pipe", "pipe"], timeout, maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.signal || result.status !== 0) {
      // Classify only fixed diagnostics. Raw output can contain a connection
      // string or generated password and must never become an error message.
      const output = (result.stderr || Buffer.alloc(0)).toString("utf8");
      const category = [
        ["HOME_UNAVAILABLE", /HOME.*not set/i], ["DAEMON_UNAVAILABLE", /Cannot connect to the Docker daemon/i],
        ["IMAGE_UNAVAILABLE", /pull access denied|manifest unknown|TLS handshake timeout/i],
        ["PERMISSION_DENIED", /permission denied|Operation not permitted/i],
        ["READ_ONLY_FILESYSTEM", /read-only file system/i],
        ["PORT_UNAVAILABLE", /port is already allocated|address already in use/i]
      ].find(([, pattern]) => pattern.test(output))?.[0] || "FAILED";
      throw new Error(`RECOVERY_REHEARSAL_SUBPROCESS_${category}`);
    }
    return result;
  };
  const docker = (args, options) => command("docker", ["--host", "unix:///var/run/docker.sock", "--config", join(directory, "docker"), ...args], options);
  const json = (result) => JSON.parse(result.stdout.toString("utf8"));
  let containerId;
  let networkId;
  let source;
  let target;
  let result;
  let failureReason;
  let failureCause;
  let resourceSummary;
  let cleanupFailures = [];
  let stage = "CREATE_ISOLATED_RESOURCES";
  const ownership = () => ({ id: containerId, name, nonce });
  const inspect = () => json(docker(["inspect", containerId]))[0];
  const verifyNetwork = () => {
    const network = json(docker(["network", "inspect", networkId]))[0];
    assertOwnedRecoveryNetwork(network, { id: networkId, name: networkName, nonce });
    return network;
  };
  try {
    await mkdir(join(directory, "docker"), { mode: 0o700 });
    stage = "CREATE_ISOLATED_NETWORK";
    networkId = docker(["network", "create", "--internal", "--label", `${RECOVERY_LABEL}=${nonce}`, networkName]).stdout.toString("utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(networkId)) throw new Error("RECOVERY_REHEARSAL_NETWORK_BOUNDARY_DENIED");
    verifyNetwork();
    stage = "CREATE_DATABASE_CONTAINER";
    containerId = docker(["create", "--name", name, "--label", `${RECOVERY_LABEL}=${nonce}`,
      "--network", networkName, "--user", "postgres", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "768m",
      "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m,uid=999,gid=999,mode=0700",
      "--tmpfs", "/var/run/postgresql:rw,noexec,nosuid,size=16m,uid=999,gid=999,mode=0755",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
      "--env", `POSTGRES_PASSWORD=${password}`, "--env", `POSTGRES_DB=${RECOVERY_DATABASES.source}`, "postgres:16"]).stdout.toString("utf8").trim();
    stage = "VERIFY_CONTAINER_IDENTITY";
    assertOwnedRecoveryContainer(inspect(), ownership());
    stage = "START_DATABASE_CONTAINER";
    docker(["start", containerId]);
    stage = "VERIFY_CONTAINER_BOUNDARY";
    const startedContainer = inspect();
    const bindings = startedContainer.NetworkSettings?.Ports?.["5432/tcp"];
    resourceSummary = { running: startedContainer.State?.Running === true,
      networkCount: Object.keys(startedContainer.NetworkSettings?.Networks || {}).length,
      publishedBindings: Array.isArray(bindings) ? bindings.length : 0,
      tmpfsData: Boolean(startedContainer.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"]),
      persistentMount: Boolean(startedContainer.Mounts?.some((mount) => mount.Type === "bind" || mount.Type === "volume")) };
    const host = recoveryContainerAddress(startedContainer, ownership(), verifyNetwork());
    const port = 5432;
    const verifyBoundary = () => {
      if (recoveryContainerAddress(inspect(), ownership(), verifyNetwork()) !== host) {
        throw new Error("RECOVERY_REHEARSAL_CONTAINER_BOUNDARY_DENIED");
      }
    };
    const sourceUrl = `postgresql://postgres:${password}@${host}:${port}/${RECOVERY_DATABASES.source}`;
    const targetUrl = `postgresql://postgres:${password}@${host}:${port}/${RECOVERY_DATABASES.target}`;
    assertRecoveryDatabaseUrl(sourceUrl, { host, port, password, database: RECOVERY_DATABASES.source });
    assertRecoveryDatabaseUrl(targetUrl, { host, port, password, database: RECOVERY_DATABASES.target });
    stage = "WAIT_FOR_DATABASE";
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      verifyBoundary();
      try { docker(["exec", "--user", "postgres", containerId, "pg_isready", "--host=127.0.0.1", "--username=postgres", `--dbname=${RECOVERY_DATABASES.source}`], { timeout: 5000 }); ready = true; break; }
      catch { await new Promise((done) => setTimeout(done, 500)); }
    }
    if (!ready) throw new Error("RECOVERY_REHEARSAL_DATABASE_START_FAILED");
    stage = "MIGRATE_SYNTHETIC_SOURCE";
    verifyBoundary();
    command(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { environment: { DATABASE_URL: sourceUrl } });
    const [{ PrismaClient }, fixture] = await Promise.all([
      import("@prisma/client"), import("../tests/fixtures/corrections-c9-recovery-fixture.mjs")
    ]);
    source = new PrismaClient({ datasources: { db: { url: sourceUrl } }, log: [] });
    const migrations = await source.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
    if (!migrations.length || migrations.some((migration) => !migration.finished_at || migration.rolled_back_at)) {
      throw new Error("RECOVERY_REHEARSAL_MIGRATION_HISTORY_FAILED");
    }
    stage = "SEED_FICTIONAL_RECORDS";
    verifyBoundary();
    const expected = await fixture.seedCorrectionsRecoveryFixture(source, { sourceDatabaseUrl: sourceUrl,
      container: inspect(), ownership: ownership(), network: verifyNetwork(), password });
    const bytesDirectory = join(directory, "synthetic-media");
    await mkdir(bytesDirectory, { mode: 0o700 });
    for (const entry of expected.media) {
      const bytes = Buffer.from(entry.bytesBase64, "base64");
      verifyRecoveryBytes(bytes, entry);
      const file = createHash("sha256").update(entry.storageKey).digest("hex");
      await writeFile(join(bytesDirectory, `${file}.source`), bytes, { flag: "wx", mode: 0o600 });
      await copyFile(join(bytesDirectory, `${file}.source`), join(bytesDirectory, `${file}.backup`), 1);
    }
    stage = "DUMP_SYNTHETIC_DATABASE";
    verifyBoundary();
    const dump = docker(["exec", "--user", "postgres", containerId, "pg_dump", "--username=postgres",
      `--dbname=${RECOVERY_DATABASES.source}`, "--format=custom", "--no-owner", "--no-acl"]);
    if (dump.stderr.length || dump.stdout.length < 5 || dump.stdout.subarray(0, 5).toString() !== "PGDMP") {
      throw new Error("RECOVERY_REHEARSAL_DUMP_FAILED");
    }
    const archive = join(directory, "current-run.dump");
    await writeFile(archive, dump.stdout, { flag: "wx", mode: 0o600 });
    const archiveChecksum = createHash("sha256").update(dump.stdout).digest("hex");
    await source.$disconnect();
    source = null;
    stage = "RESTORE_INTO_FRESH_TARGET";
    verifyBoundary();
    // createdb must fail if this exact current-run target already exists.
    // No --clean, --create, reused archive or production connection is allowed.
    docker(["exec", "--user", "postgres", containerId, "createdb", "--username=postgres", "--template=template0", RECOVERY_DATABASES.target]);
    const archiveBytes = await readFile(archive);
    if (createHash("sha256").update(archiveBytes).digest("hex") !== archiveChecksum) {
      throw new Error("RECOVERY_REHEARSAL_ARCHIVE_INTEGRITY_FAILED");
    }
    docker(["exec", "--interactive", "--user", "postgres", containerId, "pg_restore", "--username=postgres",
      `--dbname=${RECOVERY_DATABASES.target}`, "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl"], { input: archiveBytes });
    stage = "VERIFY_RESTORED_EVIDENCE";
    verifyBoundary();
    target = new PrismaClient({ datasources: { db: { url: targetUrl } }, log: [] });
    const restoredMigrations = await target.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
    if (JSON.stringify(migrations) !== JSON.stringify(restoredMigrations)) throw new Error("RECOVERY_REHEARSAL_MIGRATION_HISTORY_FAILED");
    const checks = await fixture.assertCorrectionsRecoveryFixture(target, expected);
    let restoredBytes = 0;
    for (const entry of expected.media) {
      const file = createHash("sha256").update(entry.storageKey).digest("hex");
      await copyFile(join(bytesDirectory, `${file}.backup`), join(bytesDirectory, `${file}.restored`), 1);
      const bytes = await readFile(join(bytesDirectory, `${file}.restored`));
      verifyRecoveryBytes(bytes, entry);
      restoredBytes += bytes.length;
    }
    result = { event: "c9_recovery_rehearsal_passed", scope: "DISPOSABLE_DATABASE_AND_LOCAL_SYNTHETIC_BYTES_ONLY",
      migrationsVerified: migrations.length, checks, mediaObjectsVerified: expected.media.length, restoredBytes,
      durationMs: Date.now() - startedAt, productionRecoveryVerified: false, physicalC8Verified: false };
  } catch (error) {
    failureReason = `RECOVERY_REHEARSAL_FAILED_${stage}`;
    failureCause = /^RECOVERY_REHEARSAL_[A-Z_]+$/.test(error?.message || "") ? error.message : "RECOVERY_REHEARSAL_ASSERTION_OR_DEPENDENCY_FAILED";
  } finally {
    // Exact current-run ownership, never a name glob, Docker prune or broad
    // database/filesystem deletion. Cleanup failure prevents a PASSED report.
    cleanupFailures = await runRecoveryCleanup({
      disconnectSource: async () => { await source?.$disconnect(); },
      disconnectTarget: async () => { await target?.$disconnect(); },
      removeContainer: async () => {
        if (containerId) { assertOwnedRecoveryContainer(inspect(), ownership()); docker(["rm", "--force", containerId]); }
      },
      removeNetwork: async () => { if (networkId) { verifyNetwork(); docker(["network", "rm", networkId]); } },
      removeTemporaryDirectory: async () => {
        if (dirname(resolve(directory)) !== temporaryRoot || !/^ruvanas-c9-recovery-[a-zA-Z0-9]+$/.test(basename(directory))) {
          throw new Error("RECOVERY_REHEARSAL_TEMP_BOUNDARY_DENIED");
        }
        await rm(directory, { recursive: true, force: false });
      }
    });
  }
  if (failureReason || cleanupFailures.length) {
    throw Object.assign(new Error(failureReason || "RECOVERY_REHEARSAL_CLEANUP_FAILED"), { cleanupFailures, failureCause, resourceSummary });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const reason = /^RECOVERY_REHEARSAL_[A-Z_]+$/.test(error?.message || "") ? error.message : "RECOVERY_REHEARSAL_DEPENDENCY_FAILED";
  const cleanupFailures = (error?.cleanupFailures || []).filter((value) =>
    ["SOURCE_DISCONNECT", "TARGET_DISCONNECT", "CONTAINER", "NETWORK", "TEMPORARY_DIRECTORY"].includes(value));
  const cause = /^RECOVERY_REHEARSAL_[A-Z_]+$/.test(error?.failureCause || "") ? error.failureCause : undefined;
  process.stderr.write(`${JSON.stringify({ event: "c9_recovery_rehearsal_failed", reason, cause,
    resources: error?.resourceSummary, cleanupFailures, productionRecoveryVerified: false })}\n`);
  process.exitCode = 1;
});
