import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACCOUNT_RECOVERY_MESSAGE,
  ACCOUNT_RECOVERY_TTL_MINUTES,
  accountAllowsPasswordRecovery,
  buildAccountRecoveryEmail,
  createAccountRecoveryToken,
  hashAccountRecoveryToken,
  normalizeRecoveryEmail,
  passwordRecoveryOrganisationId,
  resolveRecoveryOrigin,
  validateRecoveryPassword
} from "../lib/account-recovery.mjs";

test("recovery tokens are random, short-lived and represented only by a fingerprint", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const first = createAccountRecoveryToken(now);
  const second = createAccountRecoveryToken(now);
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.token, first.tokenHash);
  assert.equal(hashAccountRecoveryToken(first.token), first.tokenHash);
  assert.equal(first.expiresAt.toISOString(), "2026-09-03T12:30:00.000Z");
  assert.equal(ACCOUNT_RECOVERY_TTL_MINUTES, 30);
  assert.throws(() => hashAccountRecoveryToken("short"), /incomplete or invalid/);
});

test("recovery input and replacement passwords are safely validated", () => {
  assert.equal(normalizeRecoveryEmail("  USER@Example.com "), "user@example.com");
  assert.throws(() => normalizeRecoveryEmail("not-an-email"), /valid email/);
  assert.equal(validateRecoveryPassword({ password: "short1", confirmation: "short1" }).ok, false);
  assert.equal(validateRecoveryPassword({ password: "letterswithoutnumber", confirmation: "letterswithoutnumber" }).ok, false);
  assert.equal(validateRecoveryPassword({ password: "SecurePassword42", confirmation: "different" }).ok, false);
  assert.deepEqual(validateRecoveryPassword({ password: "SecurePassword42", confirmation: "SecurePassword42" }), { ok: true, password: "SecurePassword42" });
});

test("company-managed and supervised identities cannot bypass their sign-in policy", () => {
  assert.equal(accountAllowsPasswordRecovery(null), false);
  assert.equal(accountAllowsPasswordRecovery({ role: "STUDENT", memberships: [] }), false);
  assert.equal(accountAllowsPasswordRecovery({ role: "SUPER_ADMIN", memberships: [] }), true);
  assert.equal(accountAllowsPasswordRecovery({ role: "OWNER", memberships: [{ organisation: { enterpriseSecurityPolicy: { ssoRequired: true, passwordFallback: false } } }] }), false);
  assert.equal(accountAllowsPasswordRecovery({ role: "OWNER", memberships: [{ organisation: { enterpriseSecurityPolicy: { ssoRequired: true, passwordFallback: true } } }] }), true);
  const mixed = { memberships: [
    { organisationId: "sso-only", organisation: { enterpriseSecurityPolicy: { ssoRequired: true, passwordFallback: false } } },
    { organisationId: "password-enabled", organisation: { enterpriseSecurityPolicy: null } }
  ] };
  assert.equal(passwordRecoveryOrganisationId(mixed), "password-enabled");
});

test("recovery links use an approved origin and email content carries no password", () => {
  assert.equal(resolveRecoveryOrigin("https://ignored.example/path", { RUVANAS_PUBLIC_URL: "https://ruvanas.example/app" }), "https://ruvanas.example");
  assert.equal(resolveRecoveryOrigin("http://localhost:3000/api/auth", {}), "http://localhost:3000");
  assert.throws(() => resolveRecoveryOrigin("http://public.example/api", {}), /public HTTPS origin/);
  assert.throws(() => buildAccountRecoveryEmail({ recipientEmail: "user@example.com", from: "security@example.com", resetUrl: "ftp://localhost/reset#token=x", tokenId: "x", expiresAt: new Date() }), /use HTTPS/);
  const message = buildAccountRecoveryEmail({
    recipientEmail: "user@example.com",
    from: "security@example.com",
    resetUrl: "https://ruvanas.example/reset-password#token=private-token",
    tokenId: "reset-1",
    expiresAt: new Date("2026-09-03T12:30:00.000Z")
  });
  assert.equal(message.to, "user@example.com");
  assert.match(message.text, /works once/);
  assert.match(message.text, /#token=private-token/);
  assert.doesNotMatch(message.text, /current password/i);
  assert.equal(message.idempotencyKey.length, 64);
});

test("request and reset APIs preserve privacy, atomic use and session revocation", async () => {
  const [requestRoute, resetRoute, schema] = await Promise.all([
    readFile(new URL("../app/api/auth/password-recovery/request/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password-recovery/reset/route.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
  ]);
  assert.match(requestRoute, /ACCOUNT_RECOVERY_MESSAGE/);
  assert.match(requestRoute, /accountAllowsPasswordRecovery/);
  assert.match(requestRoute, /account-recovery-request/);
  assert.doesNotMatch(requestRoute, /token:\s*generated\.token/);
  assert.match(resetRoute, /account-recovery-reset/);
  assert.match(resetRoute, /expiresAt: \{ gt: now \}/);
  assert.match(resetRoute, /session\.updateMany/);
  assert.match(resetRoute, /bcrypt\.hash\(validation\.password, 12\)/);
  assert.match(schema, /model PasswordResetToken/);
  assert.match(ACCOUNT_RECOVERY_MESSAGE, /If an eligible Ruvanas account/);
});

test("recovery interface is accessible, fragment-based and discoverable from sign-in", async () => {
  const [forgot, reset, login, styles] = await Promise.all([
    readFile(new URL("../app/forgot-password/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/reset-password/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/auth-recovery.module.css", import.meta.url), "utf8")
  ]);
  assert.match(forgot, /id="main-content"/);
  assert.match(forgot, /role="status"/);
  assert.match(reset, /window\.location\.hash/);
  assert.match(reset, /history\.replaceState/);
  assert.match(reset, /autoComplete="new-password"/);
  assert.match(login, /href="\/forgot-password"/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 520px\)/);
});
