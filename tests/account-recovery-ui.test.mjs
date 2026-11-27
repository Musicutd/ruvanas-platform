import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RECOVERY_REQUEST_ACCEPTED, recoveryPasswordError, recoveryRequestMessage,
  recoveryResetDestination } from "../lib/account-recovery-ui.mjs";

test("recovery accepts only the two fixed sign-in destinations after confirmed reset", () => {
  for (const destination of ["/login?password-reset=1", "/rewards/pilot-sign-in?password-reset=1"]) {
    assert.equal(recoveryResetDestination({ ok: true, destination }), destination);
    assert.equal(recoveryResetDestination({ ok: false, destination }), null);
    assert.equal(recoveryResetDestination({ ok: "true", destination }), null);
  }
  for (const destination of [null, undefined, "", "//outside.invalid", "https://outside.invalid/", "javascript:alert(1)",
    "/rewards/pilot-sign-in?password-reset=1&token=private", "/login?password-reset=1#private", "/register",
    "/rewards/pilot-sign-in", "/admin", "/login?password-reset=2", 1, {}, ["/login?password-reset=1"]]) {
    assert.equal(recoveryResetDestination({ ok: true, destination }), null);
  }
  for (const result of [null, undefined, [], true]) assert.equal(recoveryResetDestination(result), null);
});

test("recovery confirmation distinguishes request acceptance from delivery and hides arbitrary server details", () => {
  assert.deepEqual(recoveryRequestMessage({ ok: true, status: 200 }, { ok: true, message: "secret provider details" }),
    { message: RECOVERY_REQUEST_ACCEPTED, error: "" });
  assert.match(RECOVERY_REQUEST_ACCEPTED, /does not confirm that an email was delivered/);
  const unavailable = recoveryRequestMessage({ ok: false, status: 503 }, { ok: true, error: "user@example.invalid exists" });
  assert.equal(unavailable.message, "");
  assert.match(unavailable.error, /unavailable/);
  assert.doesNotMatch(unavailable.error, /user@|exists/);
  for (const result of [null, {}, { ok: false }, { ok: "true" }]) {
    assert.equal(recoveryRequestMessage({ ok: true, status: 200 }, result).message, "");
  }
  assert.match(recoveryRequestMessage({ ok: false, status: 429 }, {}).error, /wait/);
  assert.match(recoveryRequestMessage({ ok: false, status: 400 }, {}).error, /valid email/);
});

test("replacement password checks prevent creating a credential pilot login cannot accept", () => {
  const values = ["a".repeat(71) + "1", "é".repeat(35) + "a1", "🙂".repeat(17) + "ab12"];
  for (const password of values) {
    assert.equal(new TextEncoder().encode(password).byteLength, 72);
    assert.equal(recoveryPasswordError(password, password), "");
    assert.match(recoveryPasswordError(password + "x", password + "x"), /too long/);
  }
  for (const password of ["short1", "abcdefghijkl", "123456789012", "Password1\0abc", "Password1\ud800abc"]) {
    assert.notEqual(recoveryPasswordError(password, password), "");
  }
  assert.match(recoveryPasswordError("ValidPassword123", "OtherPassword123"), /does not match/);
  assert.equal(recoveryPasswordError("ValidPassword123", "ValidPassword123"), "");
});

test("reset UI stays at completion when private sign-in is closed and clears credentials from memory", async () => {
  const [reset, request, pilot, pilotPage] = await Promise.all([
    readFile(new URL("../app/reset-password/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/forgot-password/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/rewards/pilot-sign-in/PilotSignInClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/rewards/pilot-sign-in/page.js", import.meta.url), "utf8")
  ]);
  assert.match(reset, /recoveryPasswordError\(password, confirmation\)/);
  assert.match(reset, /recoveryResetDestination\(body\)/);
  assert.match(reset, /if \(destination\) router\.replace\(destination\)/);
  assert.doesNotMatch(reset, /router\.replace\(body\.destination/);
  assert.match(reset, /setToken\(""\); setPassword\(""\); setConfirmation\(""\); setComplete\(true\)/);
  assert.match(reset, /complete \? \(/);
  assert.match(reset, /does not enable Rewards or change your access/);
  assert.match(reset, /window\.location\.hash/);
  assert.match(reset, /window\.history\.replaceState\(null, "", window\.location\.pathname\)/);
  assert.doesNotMatch(reset, /localStorage|sessionStorage|console\.|document\.cookie/);
  assert.match(request, /recoveryRequestMessage\(response, body\)/);
  assert.match(pilot, /href="\/forgot-password">Forgot password\?/);
  assert.match(pilot, /recoveryEnabled = false/);
  assert.match(pilot, /Contact the Super Admin to arrange account recovery/);
  assert.match(pilotPage, /recoveryEnabled=\{readPrivatePreviewRecoveryPolicy\(process\.env\)\.enabled\}/);
});
