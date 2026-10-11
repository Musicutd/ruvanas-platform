import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { privatePreviewOwnerBootstrapPreflight } from "../scripts/private-preview-owner-code.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/private-preview-owner-code.mjs", import.meta.url));
const VALID_ENV = {
  RUVANAS_PRIVATE_PREVIEW_BOOTSTRAP_APPROVED: "1",
  RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
  RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@ruvanas.test",
  RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@ruvanas.test",
  RUVANAS_PUBLIC_URL: "https://preview.ruvanas.test",
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5554/synthetic_preview",
  SESSION_SECRET: "synthetic-preview-session-secret-32-bytes-minimum",
  NODE_ENV: "production"
};

function preflight(overrides = {}) {
  return privatePreviewOwnerBootstrapPreflight({
    args: ["--issue-owner-code"], stdinIsTTY: true, stdoutIsTTY: true, env: VALID_ENV,
    ...overrides
  });
}

test("a redirected or piped invocation refuses before reading any configuration", () => {
  const unreadableEnv = new Proxy({}, {
    get() { throw new Error("Environment was read before the TTY gate"); }
  });
  assert.deepEqual(preflight({ stdinIsTTY: false, env: unreadableEnv }),
    { ok: false, code: "INTERACTIVE_TERMINAL_REQUIRED" });
  assert.deepEqual(preflight({ stdoutIsTTY: false, env: unreadableEnv }),
    { ok: false, code: "INTERACTIVE_TERMINAL_REQUIRED" });

  const child = spawnSync(process.execPath, [SCRIPT, "--issue-owner-code"], {
    input: "", encoding: "utf8", env: {}
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /INTERACTIVE_TERMINAL_REQUIRED/);
  assert.doesNotMatch(child.stdout + child.stderr, /rvp_[a-f0-9]{48}/);
});

test("bootstrap requires exact invocation, a separate operator flag, valid preview, DB URL, and secret", () => {
  assert.deepEqual(preflight({ args: [] }), { ok: false, code: "EXPLICIT_INVOCATION_REQUIRED" });
  assert.deepEqual(preflight({ args: ["--issue-owner-code", "extra"] }),
    { ok: false, code: "EXPLICIT_INVOCATION_REQUIRED" });
  assert.deepEqual(preflight({ env: { ...VALID_ENV, RUVANAS_PRIVATE_PREVIEW_BOOTSTRAP_APPROVED: "0" } }),
    { ok: false, code: "OPERATOR_APPROVAL_REQUIRED" });
  assert.deepEqual(preflight({ env: { ...VALID_ENV, RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" } }),
    { ok: false, code: "PRIVATE_PREVIEW_CONFIG_UNAVAILABLE" });
  assert.deepEqual(preflight({ env: { ...VALID_ENV, RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "other@example.test" } }),
    { ok: false, code: "PRIVATE_PREVIEW_CONFIG_UNAVAILABLE" });
  for (const url of ["", "not-a-url", "https://example.test/db", "postgresql://localhost/"]) {
    assert.deepEqual(preflight({ env: { ...VALID_ENV, DATABASE_URL: url } }),
      { ok: false, code: "DATABASE_CONFIG_UNAVAILABLE" });
  }
  assert.deepEqual(preflight({ env: { ...VALID_ENV, SESSION_SECRET: "short" } }),
    { ok: false, code: "SESSION_CONFIG_UNAVAILABLE" });
  const result = preflight();
  assert.equal(result.ok, true);
  assert.equal(result.policy.adminEmail, "owner@ruvanas.test");
  assert.equal(Object.hasOwn(result, "DATABASE_URL"), false);
  assert.equal(Object.hasOwn(result, "SESSION_SECRET"), false);
});
