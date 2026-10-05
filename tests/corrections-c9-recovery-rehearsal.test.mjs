import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertOwnedRecoveryContainer, assertRecoveryDatabaseUrl, assertRecoveryRehearsalEnvironment,
  RECOVERY_DATABASES, RECOVERY_LABEL, recoveryContainerPort, runRecoveryCleanup, verifyRecoveryBytes
} from "../lib/corrections-recovery-rehearsal-safety.mjs";

const environment = { GITHUB_ACTIONS: "true", CI: "true", C9_RECOVERY_REHEARSAL: "true",
  RUNNER_ENVIRONMENT: "github-hosted", GITHUB_REPOSITORY: "Musicutd/ruvanas-platform", GITHUB_EVENT_NAME: "pull_request" };
const ownership = { id: "a".repeat(64), nonce: "b".repeat(32), name: `ruvanas-c9-recovery-${"b".repeat(32)}` };
const networkName = `${ownership.name}-network`;
function container() {
  return { Id: ownership.id, Name: `/${ownership.name}`, Config: { Image: "postgres:16", Labels: { [RECOVERY_LABEL]: ownership.nonce } },
    State: { Running: true }, NetworkSettings: { Networks: { [networkName]: {} }, Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15432" }] } },
    HostConfig: { Tmpfs: { "/var/lib/postgresql/data": "rw,noexec,nosuid" } }, Mounts: [] };
}

test("recovery rehearsal accepts only the opted-in standard repository CI context", () => {
  assert.doesNotThrow(() => assertRecoveryRehearsalEnvironment(environment, "linux", []));
  for (const key of Object.keys(environment)) {
    assert.throws(() => assertRecoveryRehearsalEnvironment({ ...environment, [key]: "wrong" }, "linux"), /ENVIRONMENT_DENIED/);
  }
  assert.throws(() => assertRecoveryRehearsalEnvironment(environment, "win32"), /ENVIRONMENT_DENIED/);
  assert.throws(() => assertRecoveryRehearsalEnvironment(environment, "linux", ["restore"]), /ENVIRONMENT_DENIED/);
});

test("recovery rehearsal denies inherited customer/database/storage configuration", () => {
  for (const key of ["DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
    "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "R2_BUCKET_NAME", "AWS_ACCESS_KEY_ID", "RENDER_API_KEY", "SESSION_SECRET", "SECRET_ENCRYPTION_KEY"]) {
    assert.throws(() => assertRecoveryRehearsalEnvironment({ ...environment, [key]: "private-value-not-for-output" }, "linux"),
      (error) => error.message === "RECOVERY_REHEARSAL_EXTERNAL_CONFIGURATION_DENIED");
  }
});

test("container operations require this exact generated id, name, image and ownership label", () => {
  assert.doesNotThrow(() => assertOwnedRecoveryContainer(container(), ownership));
  for (const change of [
    (row) => { row.Id = "c".repeat(64); }, (row) => { row.Name = "/existing-service"; },
    (row) => { row.Config.Image = "postgres:15"; }, (row) => { row.Config.Labels[RECOVERY_LABEL] = "c".repeat(32); }
  ]) {
    const row = container(); change(row);
    assert.throws(() => assertOwnedRecoveryContainer(row, ownership), /CONTAINER_IDENTITY_DENIED/);
  }
  assert.throws(() => assertOwnedRecoveryContainer(container(), { ...ownership, id: "--all" }), /IDENTITY_DENIED/);
});

test("database boundary requires one loopback port, one isolated network and no host/volume data mounts", () => {
  assert.equal(recoveryContainerPort(container(), ownership, networkName), 15432);
  for (const change of [
    (row) => { row.State.Running = false; }, (row) => { row.NetworkSettings.Networks.other = {}; },
    (row) => { row.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0"; },
    (row) => { row.NetworkSettings.Ports["5432/tcp"].push({ HostIp: "::", HostPort: "15432" }); },
    (row) => { row.NetworkSettings.Ports["5432/tcp"][0].HostPort = "1"; },
    (row) => { row.NetworkSettings.Ports = null; }, (row) => { row.HostConfig.Tmpfs = {}; },
    (row) => { row.Mounts = [{ Type: "volume" }]; }, (row) => { row.Mounts = [{ Type: "bind" }]; }
  ]) {
    const row = container(); change(row);
    assert.throws(() => recoveryContainerPort(row, ownership, networkName), /CONTAINER_BOUNDARY_DENIED/);
  }
});

test("only generated source/target URLs with exact current container connection are allowed", () => {
  for (const database of Object.values(RECOVERY_DATABASES)) {
    const value = `postgresql://postgres:synthetic@127.0.0.1:15432/${database}`;
    const expected = { port: 15432, password: "synthetic", database };
    assert.doesNotThrow(() => assertRecoveryDatabaseUrl(value, expected));
    for (const wrong of [value.replace("127.0.0.1", "example.invalid"), value.replace("15432", "5432"),
      value.replace("synthetic", "wrong"), value.replace("postgres:", "other:"), `${value}?schema=public`, `${value}#other`,
      value.replace(database, "ruvanas_production")]) {
      assert.throws(() => assertRecoveryDatabaseUrl(wrong, expected), /DATABASE_BOUNDARY_DENIED/);
    }
  }
});

test("restored bytes must match both source checksum and exact byte length", () => {
  const bytes = Buffer.from("fictional audio bytes only"), expected = { sizeBytes: bytes.length,
    checksumSha256: createHash("sha256").update(bytes).digest("hex") };
  assert.doesNotThrow(() => verifyRecoveryBytes(bytes, expected));
  const tampered = Buffer.from(bytes); tampered[0] ^= 1;
  for (const [value, evidence] of [[tampered, expected], [bytes.subarray(1), expected], [bytes, { ...expected, checksumSha256: "a".repeat(64) }]]) {
    assert.throws(() => verifyRecoveryBytes(value, evidence), /MEDIA_INTEGRITY_FAILED/);
  }
});

test("operator command fails before resources or dependencies without CI and never prints supplied secrets", () => {
  const secret = "private-do-not-log-configuration";
  const result = spawnSync(process.execPath, ["scripts/ci-c9-recovery-rehearsal.mjs"], {
    env: { PATH: process.env.PATH || "", DATABASE_URL: secret }, encoding: "utf8", timeout: 10_000
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).reason, "RECOVERY_REHEARSAL_ENVIRONMENT_DENIED");
  assert.equal(result.stderr.includes(secret), false);
});

test("CI restores only its current generated archive and does not upload backup artifacts", async () => {
  const script = await readFile(new URL("../scripts/ci-c9-recovery-rehearsal.mjs", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = workflow.split("  c9-recovery-rehearsal:")[1].split(/^  [a-z][a-z-]+:/m)[0];
  assert.match(script, /"--host", "unix:\/\/\/var\/run\/docker\.sock"/);
  assert.match(script, /"--template=template0", RECOVERY_DATABASES.target/);
  assert.match(script, /"--exit-on-error", "--single-transaction"/);
  assert.match(script, /archiveChecksum/);
  assert.doesNotMatch(script, /\["(?:system|volume|container)", "prune"\]|"--clean"|"--create"|"dropdb"/);
  assert.match(job, /runs-on: ubuntu-latest/); assert.match(job, /persist-credentials: false/);
  assert.doesNotMatch(job, /DATABASE_URL|secrets\.|upload-artifact|render deploy/i);
});

test("cleanup failures are redacted and do not prevent independent owned cleanup", async () => {
  const seen = [];
  const keys = ["disconnectSource", "disconnectTarget", "removeContainer", "removeNetwork", "removeTemporaryDirectory"];
  const actions = Object.fromEntries(keys.map((key) => [key, async () => {
    seen.push(key); if (["disconnectSource", "removeContainer"].includes(key)) throw new Error("private connection/archive detail");
  }]));
  assert.deepEqual(await runRecoveryCleanup(actions), ["SOURCE_DISCONNECT", "CONTAINER"]);
  assert.deepEqual(seen, keys);
  assert.deepEqual(await runRecoveryCleanup(Object.fromEntries(keys.map((key) => [key, async () => {}]))), []);
});
