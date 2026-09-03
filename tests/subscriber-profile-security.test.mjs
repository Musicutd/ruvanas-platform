import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canRevokeSubscriberSession,
  normalizeSubscriberProfileName,
  subscriberPasswordChangeAllowed,
  subscriberSessionSummary,
  validateSubscriberPasswordChange
} from "../lib/subscriber-profile-security.mjs";
import { buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";

test("profile names are normalised and bounded", () => {
  assert.equal(normalizeSubscriberProfileName("  Manuel   Camilleri "), "Manuel Camilleri");
  assert.throws(() => normalizeSubscriberProfileName("M"), /between 2 and 80/);
  assert.throws(() => normalizeSubscriberProfileName("x".repeat(81)), /between 2 and 80/);
});

test("password changes require the current password and a stronger replacement", () => {
  assert.equal(validateSubscriberPasswordChange({}).ok, false);
  assert.equal(validateSubscriberPasswordChange({ currentPassword: "old", newPassword: "short1", confirmation: "short1" }).ok, false);
  assert.equal(validateSubscriberPasswordChange({ currentPassword: "old", newPassword: "letterswithoutnumber", confirmation: "letterswithoutnumber" }).ok, false);
  assert.equal(validateSubscriberPasswordChange({ currentPassword: "old", newPassword: "SecurePassword42", confirmation: "different" }).ok, false);
  assert.equal(validateSubscriberPasswordChange({ currentPassword: "SecurePassword42", newPassword: "SecurePassword42", confirmation: "SecurePassword42" }).ok, false);
  assert.deepEqual(
    validateSubscriberPasswordChange({ currentPassword: "old-password", newPassword: "SecurePassword42", confirmation: "SecurePassword42" }),
    { ok: true, currentPassword: "old-password", newPassword: "SecurePassword42" }
  );
});

test("company sign-in policy can prevent local password changes", () => {
  assert.equal(subscriberPasswordChangeAllowed(null), true);
  assert.equal(subscriberPasswordChangeAllowed({ ssoRequired: false, passwordFallback: false }), true);
  assert.equal(subscriberPasswordChangeAllowed({ ssoRequired: true, passwordFallback: true }), true);
  assert.equal(subscriberPasswordChangeAllowed({ ssoRequired: true, passwordFallback: false }), false);
});

test("session summaries disclose only safe, usable fields", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const summary = subscriberSessionSummary({
    id: "session-current",
    authMethod: "PASSWORD",
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    lastSeenAt: new Date("2026-09-03T11:58:00.000Z"),
    expiresAt: new Date("2026-10-01T12:00:00.000Z"),
    revokedAt: null,
    activeOrganisation: { name: "Ruvanas Retail" },
    tokenHash: "must-not-leak",
    externalProviderId: "must-not-leak"
  }, "session-current", now);

  assert.deepEqual(Object.keys(summary).sort(), ["active", "authentication", "createdAt", "current", "expiresAt", "id", "lastSeenAt", "organisationName"].sort());
  assert.equal(summary.current, true);
  assert.equal(summary.active, true);
  assert.equal(summary.authentication, "Password");
  assert.equal(canRevokeSubscriberSession(summary), false);
  assert.equal(canRevokeSubscriberSession({ ...summary, current: false }), true);
});

test("profile API is scoped to the signed-in user and protects the current session", async () => {
  const source = await readFile(new URL("../app/api/me/security/route.js", import.meta.url), "utf8");
  assert.match(source, /getActiveOrganisationContext/);
  assert.match(source, /userId: context\.user\.id/);
  assert.match(source, /id: \{ not: context\.session\.id \}/);
  assert.match(source, /sessionId === context\.session\.id/);
  assert.match(source, /bcrypt\.compare/);
  assert.match(source, /bcrypt\.hash\(validation\.newPassword, 12\)/);
  assert.match(source, /subscriber-session-revoke/);
  assert.match(source, /Cache-Control.*private, no-store/);
  assert.doesNotMatch(source, /select:\s*\{[^}]*tokenHash:\s*true/s);
  assert.doesNotMatch(source, /ipAddress|clientAddress|externalProviderId/);
});

test("profile and security workspace is accessible, responsive and discoverable", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/profile/ProfileSecurityClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/profile/profile-security.module.css", import.meta.url), "utf8")
  ]);
  assert.match(client, /id="main-content"/);
  assert.match(client, /autoComplete="current-password"/);
  assert.match(client, /autoComplete="new-password"/);
  assert.match(client, /role="status"/);
  assert.match(client, /role="alert"/);
  assert.match(client, /window\.confirm/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 620px\)/);

  const navigation = buildSubscriberNavigation({ entitlements: {}, firstStationId: null });
  const item = navigation.flatMap((section) => section.items).find((entry) => entry.id === "profile");
  assert.equal(item.href, "/dashboard/profile");
});
