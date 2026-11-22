import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { walletCiDatabaseTarget, verifyWalletCiDatabaseIdentity, WALLET_CI_URL } from "./fixtures/rewards-wallet-ci-target.mjs";
import { openSavedWalletDatabase } from "./fixtures/shopper-saved-wallet-database.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: WALLET_CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: WALLET_CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-wallet-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });
const identity = { directory: "/var/lib/postgresql/data", database: "ruvanas_rewards_ci", role: "rewards_ci", host: "172.17.0.2", port: 5432, version: 160016 };

test("wallet CI target permits only the exact existing GitHub-hosted PostgreSQL16 job", async () => {
  assert.equal(walletCiDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  assert.doesNotThrow(() => verifyWalletCiDatabaseIdentity(identity));
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_SAVED_WALLET_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_SAVINGS_LOCAL_TEST: "1" },
    { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/unknown" }, { GITHUB_JOB: "validate" }, { GITHUB_JOB: "rewards-checkout-database" },
    { GITHUB_ACTIONS: undefined }, { CI: "false" }, { GITHUB_WORKFLOW: "Other workflow" },
    { RUNNER_ENVIRONMENT: "self-hosted" }, { RUNNER_OS: "Windows" }, { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ATTEMPT: "0" },
    { GITHUB_REPOSITORY: "invalid" }, { DATABASE_URL: WALLET_CI_URL.replace("127.0.0.1", "production.invalid") },
    { DATABASE_URL: undefined }, { RUVANAS_REWARDS_DATABASE_URL: WALLET_CI_URL + "?schema=public" },
    { DATABASE_URL: WALLET_CI_URL.replace("rewards_ci:rewards_ci", "postgres:password") }]) {
    let clients = 0;
    await assert.rejects(openSavedWalletDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0, "Reject before constructing any database client");
  }
  assert.throws(() => walletCiDatabaseTarget(ciEnv(), { platform: "win32" }));
});

test("wallet CI verifies the connected database identity and disconnects on mismatch", async () => {
  let constructed = 0, disconnected = 0;
  const valid = await openSavedWalletDatabase(ciEnv(), { platform: "linux", createClient: url => {
    constructed++; assert.equal(url, WALLET_CI_URL);
    return { $queryRawUnsafe: async () => [identity], $disconnect: async () => { disconnected++; } };
  } });
  assert.equal(valid.target.mode, "CI"); assert.equal(constructed, 1); await valid.db.$disconnect();
  for (const patch of [{ directory: "/production" }, { database: "production" }, { role: "postgres" }, { port: 6543 }, { version: 150000 }, { version: 170000 }, { host: "" }]) {
    const before = disconnected;
    await assert.rejects(openSavedWalletDatabase(ciEnv(), { platform: "linux", createClient: () => ({
      $queryRawUnsafe: async () => [{ ...identity, ...patch }], $disconnect: async () => { disconnected++; }
    }) }));
    assert.equal(disconnected, before + 1);
  }
});

test("CI selects both actual PostgreSQL suites and fails closed before connection when ownership is absent", async () => {
  const env = {};
  for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "PATH", "Path", "PATHEXT"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  Object.assign(env, { RUVANAS_REWARDS_CI_TEST: "1", RUN_DATABASE_TESTS: "0", NO_COLOR: "1" });
  let run;
  try { await promisify(execFile)(process.execPath, ["--test", "--test-name-pattern", "^PostgreSQL16", "tests/retail-rewards-saved-wallet-database.test.mjs", "tests/retail-rewards-savings-database.test.mjs"], { cwd: repo, env, windowsHide: true, timeout: 30000 }); }
  catch (error) { run = error; }
  assert.equal(run?.code, 1, "Both actual DB cases must be selected, not silently skipped");
  assert.match(run.stdout, /not ok \d+ - PostgreSQL16 saved wallet/);
  assert.match(run.stdout, /not ok \d+ - PostgreSQL16 shopper savings/);
  assert.match(run.stdout, /# fail 2/);
  assert.doesNotMatch(run.stdout, /# SKIP Requires the owned/);
});

test("existing wallet CI job runs saved favourites then savings without another PostgreSQL service", () => {
  const yaml = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = yaml.split("  rewards-wallet-database:")[1]?.split(/\r?\n  [A-Za-z0-9_-]+:\r?\n/)[0];
  assert.ok(job);
  const files = [...job.matchAll(/run: node --test --test-concurrency=1 (tests\/[^\s]+)/g)].map(match => match[1]);
  assert.deepEqual(files, ["tests/retail-rewards-wallet-usage-database.test.mjs", "tests/retail-rewards-saved-wallet-database.test.mjs", "tests/retail-rewards-savings-database.test.mjs"]);
  assert.equal((job.match(/image: postgres:16/g) || []).length, 1);
  assert.match(job, /RUVANAS_RETAIL_REWARDS_ENABLED: "false"/);
});
