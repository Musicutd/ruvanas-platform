import assert from "node:assert/strict";

// Reuse only the existing disposable GitHub-hosted wallet PostgreSQL service.
// This is not permission to connect to an arbitrary DATABASE_URL or local DB.
export const WALLET_CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
export function walletCiDatabaseTarget(env, { platform = process.platform } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
  for (const key of ["RUVANAS_REWARDS_SAVED_WALLET_LOCAL_TEST", "RUVANAS_REWARDS_SAVINGS_LOCAL_TEST", "RUVANAS_REWARDS_CLUSTER_DIR"]) assert.equal(env[key], undefined);
  assert.equal(platform, "linux");
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
    GITHUB_JOB: "rewards-wallet-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
  assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
  assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
  assert.equal(env.DATABASE_URL, WALLET_CI_URL); assert.equal(env.RUVANAS_REWARDS_DATABASE_URL, WALLET_CI_URL);
  return { mode: "CI", url: new URL(WALLET_CI_URL) };
}

export function verifyWalletCiDatabaseIdentity(identity) {
  assert.equal(identity.database, "ruvanas_rewards_ci"); assert.equal(identity.port, 5432);
  assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
  assert.ok(identity.version >= 160000 && identity.version < 170000);
  // Service-container address is the container interface, not loopback. The
  // connection target above is still the runner's exact forwarded localhost.
  assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
}
