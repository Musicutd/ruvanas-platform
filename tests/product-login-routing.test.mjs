import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loginLandingRoute } from "../lib/login-routing.mjs";

const active = {
  serviceEnabled: true,
  retailRadioEnabled: false,
  schoolRadioEnabled: false,
  onlineRadioEnabled: false
};

test("single-product subscribers land directly in their owned product", () => {
  assert.equal(loginLandingRoute({ role: "OWNER", hasMembership: true, entitlements: { ...active, retailRadioEnabled: true } }), "/dashboard/retail");
  assert.equal(loginLandingRoute({ role: "MANAGER", hasMembership: true, entitlements: { ...active, schoolRadioEnabled: true } }), "/dashboard/school");
  assert.equal(loginLandingRoute({ role: "VIEWER", hasMembership: true, entitlements: { ...active, onlineRadioEnabled: true } }), "/dashboard/radio");
});

test("multi-product subscribers retain the shared product chooser", () => {
  assert.equal(loginLandingRoute({
    role: "OWNER",
    hasMembership: true,
    entitlements: { ...active, retailRadioEnabled: true, onlineRadioEnabled: true }
  }), "/dashboard");
  assert.equal(loginLandingRoute({
    role: "OWNER",
    hasMembership: true,
    entitlements: { ...active, retailRadioEnabled: true, schoolRadioEnabled: true, onlineRadioEnabled: true }
  }), "/dashboard");
});

test("inactive or product-unassigned subscribers receive a service activation explanation", () => {
  assert.equal(loginLandingRoute({ role: "OWNER", hasMembership: true, entitlements: active }), "/dashboard/account?reason=service-activation");
  assert.equal(loginLandingRoute({
    role: "OWNER",
    hasMembership: true,
    entitlements: { ...active, serviceEnabled: false, retailRadioEnabled: true }
  }), "/dashboard/account?reason=service-activation");
});

test("student, platform-admin and membership routing remains explicit", () => {
  assert.equal(loginLandingRoute({ role: "STUDENT", hasMembership: true, entitlements: active }), "/school-student");
  assert.equal(loginLandingRoute({ role: "SUPER_ADMIN", hasMembership: false }), "/admin/stations");
  assert.equal(loginLandingRoute({ role: "SUPPORT", hasMembership: false }), "/admin/stations");
  assert.equal(loginLandingRoute({ role: "OWNER", hasMembership: false }), "/register");
});

test("login UI follows the server-authoritative destination and the account page explains no-product access", async () => {
  const [api, page, account] = await Promise.all([
    readFile(new URL("../app/api/auth/login/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/account/page.js", import.meta.url), "utf8")
  ]);
  assert.match(api, /loginLandingRoute/);
  assert.match(api, /recommendedDashboardRoute/);
  assert.match(api, /resolveEntitlements/);
  assert.match(page, /data\.recommendedDashboardRoute/);
  assert.doesNotMatch(page, /role === "SUPER_ADMIN"/);
  assert.match(account, /service-activation/);
  assert.match(account, /No Ruvanas product is active/);
});
