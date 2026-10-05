import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RECOVERY_MANIFEST_VERSION } from "./fixtures/corrections-c9-recovery-fixture.mjs";
import {
  assertOwnedRecoveryContainer, assertOwnedRecoveryNetwork, assertRecoveryDatabaseUrl, assertRecoveryRehearsalEnvironment,
  RECOVERY_DATABASES, RECOVERY_LABEL, recoveryContainerAddress, runRecoveryCleanup, verifyRecoveryBytes
} from "../lib/corrections-recovery-rehearsal-safety.mjs";

const environment = { GITHUB_ACTIONS: "true", CI: "true", C9_RECOVERY_REHEARSAL: "true",
  RUNNER_ENVIRONMENT: "github-hosted", GITHUB_REPOSITORY: "Musicutd/ruvanas-platform", GITHUB_EVENT_NAME: "pull_request" };
const ownership = { id: "a".repeat(64), nonce: "b".repeat(32), name: `ruvanas-c9-recovery-${"b".repeat(32)}` };
const networkName = `${ownership.name}-network`;
const networkId = "c".repeat(64);
const host = "172.30.0.2";
const networkOwnership = { id: networkId, name: networkName, nonce: ownership.nonce };

test("fictional proof manifest uses the existing database's 24-hex version contract", async () => {
  assert.match(RECOVERY_MANIFEST_VERSION, /^[0-9a-f]{24}$/);
  assert.equal(RECOVERY_MANIFEST_VERSION, createHash("sha256").update("fictional-recovery-manifest-1").digest("hex").slice(0, 24));
  const migration = await readFile(new URL("../prisma/migrations/20260827110000_proof_of_play/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /"ProofOfPlayEvent_manifest_version_check" CHECK \("manifestVersion" ~ '\^\[0-9a-f\]\{24\}\$'\)/);
});
function network() {
  return { Id: networkId, Name: networkName, Internal: true, Driver: "bridge", Scope: "local",
    Labels: { [RECOVERY_LABEL]: ownership.nonce }, IPAM: { Config: [{ Subnet: "172.30.0.0/16", Gateway: "172.30.0.1" }] },
    Containers: { [ownership.id]: { Name: ownership.name, IPv4Address: `${host}/16`, IPv6Address: "" } } };
}
function container() {
  return { Id: ownership.id, Name: `/${ownership.name}`, Config: { Image: "postgres:16", Labels: { [RECOVERY_LABEL]: ownership.nonce } },
    State: { Running: true }, NetworkSettings: { Networks: { [networkName]: {
      NetworkID: networkId, IPAddress: host, IPPrefixLen: 16, Gateway: "172.30.0.1", GlobalIPv6Address: ""
    } }, Ports: { "5432/tcp": null } },
    HostConfig: { NetworkMode: networkName, PortBindings: {}, Tmpfs: { "/var/lib/postgresql/data": "rw,noexec,nosuid" } }, Mounts: [] };
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

test("network identity requires the exact current-run id, name, label and internal local bridge", () => {
  assert.doesNotThrow(() => assertOwnedRecoveryNetwork(network(), networkOwnership));
  for (const change of [
    (row) => { row.Id = "d".repeat(64); }, (row) => { row.Name = "existing-network"; },
    (row) => { row.Labels[RECOVERY_LABEL] = "d".repeat(32); }, (row) => { row.Internal = false; },
    (row) => { row.Driver = "overlay"; }, (row) => { row.Scope = "swarm"; },
    (row) => { row.IPAM.Config[0].Subnet = "203.0.113.0/24"; },
    (row) => { row.IPAM.Config[0].Subnet = "172.30.0.0/32"; },
    (row) => { row.IPAM.Config.push({ Subnet: "172.31.0.0/16", Gateway: "172.31.0.1" }); }
  ]) {
    const row = network(); change(row);
    assert.throws(() => assertOwnedRecoveryNetwork(row, networkOwnership), /NETWORK_BOUNDARY_DENIED/);
  }
});

test("database boundary requires one owned network, no published ports and no persistent data mounts", () => {
  assert.equal(recoveryContainerAddress(container(), ownership, network()), host);
  for (const change of [
    (row) => { row.State.Running = false; }, (row) => { row.NetworkSettings.Networks.other = {}; },
    (row) => { row.HostConfig.NetworkMode = "bridge"; },
    (row) => { row.NetworkSettings.Networks[networkName].NetworkID = "d".repeat(64); },
    (row) => { row.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "15432" }]; },
    (row) => { row.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "0.0.0.0", HostPort: "15432" }]; },
    (row) => { row.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "::", HostPort: "15432" }]; },
    (row) => { row.HostConfig.PortBindings = { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15432" }] }; },
    (row) => { row.NetworkSettings.Ports["8080/tcp"] = null; },
    (row) => { row.HostConfig.Tmpfs = {}; },
    (row) => { row.Mounts = [{ Type: "volume" }]; }, (row) => { row.Mounts = [{ Type: "bind" }]; }
  ]) {
    const row = container(); change(row);
    assert.throws(() => recoveryContainerAddress(row, ownership, network()), /CONTAINER_BOUNDARY_DENIED/);
  }
});

test("private database address must identify this container in the owned network subnet", () => {
  for (const address of ["203.0.113.2", "127.0.0.1", "10.20.0.2", "172.31.0.2", "172.30.0.0", "172.30.255.255", "172.30.0.1", "172.30.0.02", ""]) {
    const row = container(), subnet = network();
    row.NetworkSettings.Networks[networkName].IPAddress = address;
    subnet.Containers[ownership.id].IPv4Address = `${address}/16`;
    assert.throws(() => recoveryContainerAddress(row, ownership, subnet), /CONTAINER_BOUNDARY_DENIED/,
      "Public, unrelated, gateway, network, broadcast and malformed addresses must be denied.");
  }
  for (const change of [
    (row, subnet) => { row.NetworkSettings.Networks[networkName].IPPrefixLen = 24; },
    (row, subnet) => { subnet.IPAM.Config[0].Subnet = "172.31.0.0/16"; },
    (row, subnet) => { subnet.Containers[ownership.id].IPv4Address = "172.30.0.3/16"; },
    (row, subnet) => { subnet.Containers[ownership.id].Name = "existing-service"; },
    (row, subnet) => { subnet.Containers["d".repeat(64)] = subnet.Containers[ownership.id]; delete subnet.Containers[ownership.id]; },
    (row, subnet) => { subnet.Containers["d".repeat(64)] = { Name: "other-container", IPv4Address: "172.30.0.3/16" }; }
  ]) {
    const row = container(), subnet = network(); change(row, subnet);
    assert.throws(() => recoveryContainerAddress(row, ownership, subnet), /CONTAINER_BOUNDARY_DENIED/);
  }
});

test("only generated source/target URLs with exact current container connection are allowed", () => {
  for (const database of Object.values(RECOVERY_DATABASES)) {
    const value = `postgresql://postgres:synthetic@${host}:5432/${database}`;
    const expected = { host, port: 5432, password: "synthetic", database };
    assert.doesNotThrow(() => assertRecoveryDatabaseUrl(value, expected));
    for (const wrong of [value.replace(host, "example.invalid"), value.replace(host, "172.30.0.3"),
      value.replace(host, "127.0.0.1"), value.replace(host, "203.0.113.2"), value.replace("5432", "15432"),
      value.replace("synthetic", "wrong"), value.replace("postgres:", "other:"), `${value}?schema=public`, `${value}#other`,
      value.replace(database, "ruvanas_production")]) {
      assert.throws(() => assertRecoveryDatabaseUrl(wrong, expected), /DATABASE_BOUNDARY_DENIED/);
    }
    assert.throws(() => assertRecoveryDatabaseUrl(value, { ...expected, host: "172.30.0.3" }), /DATABASE_BOUNDARY_DENIED/);
    assert.throws(() => assertRecoveryDatabaseUrl(value, { ...expected, port: 15432 }), /DATABASE_BOUNDARY_DENIED/);
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

test("fixture dependency diagnostics expose only fixed phase/model and Prisma code", () => {
  const secret = "private-connection-metadata-do-not-log";
  const script = `import { seedCorrectionsRecoveryFixture } from "./tests/fixtures/corrections-c9-recovery-fixture.mjs";
    let input = ""; for await (const chunk of process.stdin) input += chunk;
    const options = JSON.parse(input);
    const db = { $queryRaw: async () => [{ name: "ruvanas_c9_recovery_source" }],
      plan: { count: async () => { throw Object.assign(new Error("${secret}"), { code: "P2003", meta: { connection: "${secret}" } }); } } };
    try { await seedCorrectionsRecoveryFixture(db, options); process.exitCode = 2; }
    catch (error) { process.stdout.write(error.message); }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    input: JSON.stringify({ sourceDatabaseUrl: `postgresql://postgres:synthetic@${host}:5432/${RECOVERY_DATABASES.source}`,
      container: container(), ownership, network: network(), password: "synthetic" }),
    env: { PATH: process.env.PATH || "", GITHUB_ACTIONS: "true", C9_RECOVERY_REHEARSAL: "true" },
    encoding: "utf8", timeout: 10_000
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "RECOVERY_REHEARSAL_FIXTURE_BASELINE_COUNT_PLAN_FOREIGN_KEY");
  assert.deepEqual(JSON.parse(result.stderr), { event: "RECOVERY_FIXTURE_FAILURE", operation: "BASELINE_COUNT", model: "plan", prismaCode: "P2003" });
  assert.equal((result.stdout + result.stderr).includes(secret), false);
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
