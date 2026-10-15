import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivatePreviewAdmin, isPrivatePreviewAdminSession, isPrivatePreviewOwnerBootstrapSession, isPrivatePreviewTester, isPrivatePreviewUserAllowed, isPrivatePreviewRegistrationPath, privatePreviewDashboardRoute, privatePreviewSessionLanding, readPrivatePreviewPolicy } from "../lib/private-preview-policy.mjs";

const PREVIEW_ORIGIN = "https://preview.ruvanas.test";
const FUTURE = new Date("2099-10-16T12:00:00.000Z");

function tester() {
  return {
    id: "tester-user", email: "tester@example.test", role: "OWNER",
    privatePreviewAccess: {
      userId: "tester-user", organisationId: "tester-sandbox", enabled: true,
      passwordEnabled: true, expiresAt: new Date(FUTURE), pillars: ["RETAIL", "CORRECTIONS"]
    }
  };
}

test("private preview is off by default and only exact 1 enables it", () => {
  const off = readPrivatePreviewPolicy({});
  assert.equal(off.enabled, false);
  assert.equal(off.valid, true);
  assert.equal(off.publicUrl, "https://www.ruvanas.com/");
  assert.equal(off.previewOrigin, null);
  assert.equal(isPrivatePreviewUserAllowed({ email: "any@example.com" }, off), true);
  assert.equal(readPrivatePreviewPolicy({ RUVANAS_PRIVATE_PREVIEW_ENABLED: "0" }).enabled, false);
  for (const mode of ["", "true", "yes", "01", "false"]) {
    const policy = readPrivatePreviewPolicy({ RUVANAS_PRIVATE_PREVIEW_ENABLED: mode });
    assert.equal(policy.enabled, true);
    assert.equal(policy.valid, false);
    assert.equal(isPrivatePreviewUserAllowed({ email: "owner@example.com" }, policy), false);
  }
});

test("enabled preview requires a strict individual-email allowlist", () => {
  const enabled = readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: " Owner@Example.com , invited@example.org ",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "Owner@Example.com",
    RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
  });
  assert.equal(enabled.valid, true);
  assert.equal(enabled.previewOrigin, PREVIEW_ORIGIN);
  assert.deepEqual([...enabled.allowedEmails], ["owner@example.com", "invited@example.org"]);
  assert.equal(isPrivatePreviewUserAllowed({ email: "OWNER@example.com", role: "SUPER_ADMIN" }, enabled), true);
  assert.equal(isPrivatePreviewUserAllowed({ email: "OWNER@example.com", role: "OWNER" }, enabled), false);
  assert.equal(isPrivatePreviewUserAllowed({ email: "invited@example.org", role: "OWNER" }, enabled), false);
  assert.equal(isPrivatePreviewUserAllowed({ email: "invited@example.org", role: "SUPPORT" }, enabled), false);
  assert.equal(isPrivatePreviewUserAllowed({ email: "other@example.com" }, enabled), false);
  assert.equal(isPrivatePreviewUserAllowed(null, enabled), false);

  for (const csv of [undefined, "", "owner@example.com,", ",owner@example.com",
    "owner@example.com,,other@example.com", "owner@example.com,OWNER@example.com",
    "bad-address", "owner@bad/.com"]) {
    assert.equal(readPrivatePreviewPolicy({
      RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
      RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: csv,
      RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.com",
      RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
    }).valid, false);
  }
});

test("the public cover URL is fixed configuration, not request-supplied input", () => {
  const base = {
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.com",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.com",
    RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
  };
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/"
  }).valid, true);
  for (const url of ["http://www.ruvanas.com/", "https://user:pass@www.ruvanas.com/",
    "https://www.ruvanas.com/?next=evil", "https://www.ruvanas.com/#next",
    "javascript:alert(1)", " https://www.ruvanas.com/"]) {
    assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PUBLIC_COMING_SOON_URL: url }).valid, false);
  }
  assert.equal(readPrivatePreviewPolicy({ ...base, NODE_ENV: "development",
    RUVANAS_PUBLIC_COMING_SOON_URL: "http://127.0.0.1:3000/"
  }).valid, true);
  assert.equal(readPrivatePreviewPolicy({ ...base, NODE_ENV: "production",
    RUVANAS_PUBLIC_COMING_SOON_URL: "http://127.0.0.1:3000/"
  }).valid, false);

  // Disabled mode must preserve ordinary sign-in even if an unused preview URL is malformed.
  assert.equal(readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "0",
    RUVANAS_PUBLIC_COMING_SOON_URL: "invalid"
  }).valid, true);
  assert.equal(readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "0",
    RUVANAS_PUBLIC_URL: "https://www.ruvanas.com/"
  }).valid, true);
});

test("preview redirects require a configured absolute origin independent of request headers", () => {
  const base = {
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.com",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.com",
    NODE_ENV: "production"
  };
  assert.equal(readPrivatePreviewPolicy(base).valid, false);
  assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN }).previewOrigin,
    PREVIEW_ORIGIN);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_PUBLIC_URL: "https://www.ruvanas.com/"
  }).valid, false);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_PUBLIC_URL: "https://www.ruvanas.com",
    RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/coming-soon"
  }).valid, false);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_PUBLIC_URL: `${PREVIEW_ORIGIN}/`
  }).previewOrigin, PREVIEW_ORIGIN);
  for (const origin of ["", "http://preview.ruvanas.test", "https://user:pass@preview.ruvanas.test",
    "https://@preview.ruvanas.test", "https://preview.ruvanas.test/private",
    "https://preview.ruvanas.test/a/..", "https://preview.ruvanas.test/?next=evil",
    "https://preview.ruvanas.test/?", "https://preview.ruvanas.test/#",
    " https://preview.ruvanas.test", "javascript:alert(1)"]) {
    assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PUBLIC_URL: origin }).valid, false,
      `Unsafe preview origin accepted: ${origin}`);
  }
  const loopback = "http://127.0.0.1:3124";
  assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PUBLIC_URL: loopback }).valid, false);
  assert.equal(readPrivatePreviewPolicy({ ...base, NODE_ENV: "development",
    RUVANAS_PUBLIC_URL: loopback }).previewOrigin, loopback);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_ENVIRONMENT: "LOCAL_SYNTHETIC_PRIVATE_PREVIEW",
    RUVANAS_PUBLIC_URL: loopback }).previewOrigin, loopback);
  assert.equal(readPrivatePreviewPolicy({ ...base,
    RUVANAS_ENVIRONMENT: "LOCAL_SYNTHETIC_PRIVATE_PREVIEW",
    RUVANAS_PUBLIC_URL: "http://preview.ruvanas.test" }).valid, false);
});

test("only the configured, approved admin may issue private preview access", () => {
  const base = {
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.com,other@example.com",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "OWNER@example.com",
    RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
  };
  const policy = readPrivatePreviewPolicy(base);
  assert.equal(policy.valid, true);
  assert.equal(policy.adminEmail, "owner@example.com");
  assert.equal(isPrivatePreviewAdmin({ email: "owner@example.com", role: "SUPER_ADMIN" }, policy), true);
  assert.equal(isPrivatePreviewAdmin({ email: "other@example.com", role: "SUPER_ADMIN" }, policy), false);
  assert.equal(isPrivatePreviewAdmin({ email: "owner@example.com", role: "SUPPORT" }, policy), false);
  assert.equal(isPrivatePreviewAdmin({ email: "owner@example.com", role: "SUPER_ADMIN" }, readPrivatePreviewPolicy({})), false);
  for (const admin of [undefined, "", "bad-address", "outsider@example.com", "owner@example.com,other@example.com"]) {
    assert.equal(readPrivatePreviewPolicy({ ...base, RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: admin }).valid, false);
  }
});

test("configured owner has password admin access and only a narrow legacy-code bootstrap until password setup", () => {
  const policy = readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.com,support@example.com,student@example.com,viewer@example.com",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.com",
    RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
  });
  const owner = { id: "owner-user", email: "owner@example.com", role: "SUPER_ADMIN" };
  const bootstrap = { user: owner, authMethod: "PREVIEW_CODE", activeOrganisationId: null };
  assert.equal(privatePreviewDashboardRoute(owner, policy), "/admin");
  assert.equal(isPrivatePreviewOwnerBootstrapSession(bootstrap, policy), true);
  assert.equal(isPrivatePreviewAdminSession(bootstrap, policy), false);
  assert.equal(privatePreviewSessionLanding(bootstrap, policy), "/admin/private-preview");
  const ready = { ...owner, privatePreviewAccess: {
    userId: owner.id, enabled: true, passwordEnabled: true, organisationId: null, expiresAt: null, pillars: []
  } };
  const signedIn = { user: ready, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: null };
  assert.equal(isPrivatePreviewAdminSession(signedIn, policy), true);
  assert.equal(privatePreviewSessionLanding(signedIn, policy), "/admin");
  assert.equal(isPrivatePreviewOwnerBootstrapSession({ ...signedIn, authMethod: "PREVIEW_CODE" }, policy), false);
  assert.equal(privatePreviewSessionLanding({ ...signedIn, authMethod: "PREVIEW_CODE" }, policy), null);
  for (const authMethod of ["PASSWORD", "SSO", "PREVIEW_LOGIN_CODE", null]) {
    assert.equal(privatePreviewSessionLanding({ ...signedIn, authMethod }, policy), null);
  }
  for (const change of [{ enabled: false }, { organisationId: "tester-sandbox" }, { expiresAt: FUTURE }]) {
    assert.equal(privatePreviewSessionLanding({ ...signedIn,
      user: { ...ready, privatePreviewAccess: { ...ready.privatePreviewAccess, ...change } }
    }, policy), null);
  }
  for (const user of [
    { email: "support@example.com", role: "SUPPORT" },
    { email: "student@example.com", role: "STUDENT" },
    { email: "viewer@example.com", role: "VIEWER" },
    { email: "removed@example.com", role: "SUPER_ADMIN" }
  ]) {
    assert.equal(privatePreviewDashboardRoute(user, policy), null);
    assert.equal(privatePreviewSessionLanding({ user, authMethod: "PREVIEW_CODE" }, policy), null);
  }
  assert.equal(privatePreviewSessionLanding(null, policy), null);
  assert.equal(privatePreviewDashboardRoute(owner, readPrivatePreviewPolicy({})), null);
});

test("explicit enrolled testers use only their sandbox landing without environment email allowlisting", () => {
  const policy = readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.com",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.com",
    RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
  });
  const user = tester();
  assert.equal(policy.allowedEmails.has(user.email), false);
  assert.equal(isPrivatePreviewTester(user, policy), true);
  assert.equal(isPrivatePreviewUserAllowed(user, policy), true);
  assert.equal(isPrivatePreviewAdmin(user, policy), false);
  assert.equal(privatePreviewDashboardRoute(user, policy), "/preview-dashboard");
  for (const authMethod of ["PREVIEW_CODE", "PREVIEW_PASSWORD"]) {
    assert.equal(privatePreviewSessionLanding({ user, authMethod, activeOrganisationId: "tester-sandbox" }, policy), "/preview-dashboard");
    assert.equal(privatePreviewSessionLanding({ user, authMethod, activeOrganisationId: "different-sandbox" }, policy), null);
    assert.equal(privatePreviewSessionLanding({ user, authMethod, activeOrganisationId: null }, policy), null);
  }
  const codeOnly = tester(); codeOnly.privatePreviewAccess.passwordEnabled = false;
  assert.equal(privatePreviewSessionLanding({ user: codeOnly, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: "tester-sandbox" }, policy), null);
  assert.equal(privatePreviewSessionLanding({ user: codeOnly, authMethod: "PREVIEW_CODE", activeOrganisationId: "tester-sandbox" }, policy), "/preview-dashboard");
  for (const authMethod of ["PASSWORD", "SSO", "PREVIEW_LOGIN_CODE", null]) {
    assert.equal(privatePreviewSessionLanding({ user, authMethod, activeOrganisationId: "tester-sandbox" }, policy), null);
  }
});

test("tester enrollment must be enabled, user-bound, sandbox-bound, unexpired and have unique valid pillars", () => {
  const policy = readPrivatePreviewPolicy({
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.com",
    RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.com", RUVANAS_PUBLIC_URL: PREVIEW_ORIGIN
  });
  for (const change of [
    (user) => { user.role = "SUPER_ADMIN"; }, (user) => { user.role = "SUPPORT"; },
    (user) => { user.role = "VIEWER"; }, (user) => { user.email = "owner@example.com"; },
    (user) => { delete user.privatePreviewAccess; },
    (user) => { user.privatePreviewAccess.enabled = false; },
    (user) => { user.privatePreviewAccess.userId = "different-user"; },
    (user) => { user.privatePreviewAccess.organisationId = null; },
    (user) => { user.privatePreviewAccess.organisationId = ""; },
    (user) => { user.privatePreviewAccess.expiresAt = null; },
    (user) => { user.privatePreviewAccess.expiresAt = new Date("invalid"); },
    (user) => { user.privatePreviewAccess.expiresAt = FUTURE.toISOString(); },
    (user) => { user.privatePreviewAccess.expiresAt = new Date("2020-01-01T00:00:00Z"); },
    (user) => { user.privatePreviewAccess.pillars = []; },
    (user) => { user.privatePreviewAccess.pillars = ["SCHOOLS"]; },
    (user) => { user.privatePreviewAccess.pillars = ["RETAIL", "RETAIL"]; }
  ]) {
    const user = tester(); change(user);
    assert.equal(isPrivatePreviewTester(user, policy), false, change.toString());
    assert.equal(privatePreviewDashboardRoute(user, policy), null, change.toString());
  }
});

test("all self-registration and account-creating invitation paths are closed in preview", () => {
  for (const path of ["/register", "/register/free-access", "/api/auth/register",
    "/api/complimentary-access/redeem", "/team-invitation/accept", "/api/organisation/team/accept",
    "/school-student/accept", "/api/school-student/accept"]) {
    assert.equal(isPrivatePreviewRegistrationPath(path), true);
    assert.equal(isPrivatePreviewRegistrationPath(`${path}/`), true);
  }
  for (const path of ["/preview-login", "/api/auth/preview-code", "/dashboard", "/admin/private-preview"]) {
    assert.equal(isPrivatePreviewRegistrationPath(path), false);
  }
});
