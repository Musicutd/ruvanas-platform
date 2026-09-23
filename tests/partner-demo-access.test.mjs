import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createPartnerDemoSchema,
  hashPartnerDemoToken,
  newPartnerDemoCode,
  newPartnerDemoSessionToken,
  partnerDemoSessionValid,
  partnerDemoStatus,
  redeemPartnerDemoSchema
} from "../lib/partner-demo-access.mjs";
import { ruvanasProductGuides } from "../lib/how-ruvanas-works.mjs";
import { buildAdminNavigation } from "../lib/user-experience-navigation.mjs";

test("partner invitation codes are random, one-use-shaped, and stored only as digests", () => {
  const first = newPartnerDemoCode();
  const second = newPartnerDemoCode();
  assert.notEqual(first, second);
  assert.equal(redeemPartnerDemoSchema.safeParse({ code: first, email: "PARTNER@EXAMPLE.COM" }).success, true);
  assert.equal(redeemPartnerDemoSchema.parse({ code: first, email: "PARTNER@EXAMPLE.COM" }).email, "partner@example.com");
  assert.notEqual(hashPartnerDemoToken(first), first);
  assert.equal(hashPartnerDemoToken(first), hashPartnerDemoToken(first));
  assert.notEqual(newPartnerDemoSessionToken(), newPartnerDemoSessionToken());
  assert.equal(createPartnerDemoSchema.safeParse({ partnerName: "Company", recipientEmail: "contact@example.com" }).success, true);
});

test("partner session ends at expiry or revocation", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const invitation = {
    codeExpiresAt: new Date("2026-09-18T12:00:00Z"),
    redeemedAt: null, revokedAt: null, sessionHash: null, sessionExpiresAt: null
  };
  assert.equal(partnerDemoStatus(invitation, now), "INVITED");
  assert.equal(partnerDemoSessionValid(invitation, now), false);
  invitation.redeemedAt = now;
  invitation.sessionHash = "digest";
  invitation.sessionExpiresAt = new Date("2026-09-24T12:00:00Z");
  assert.equal(partnerDemoStatus(invitation, now), "ACTIVE");
  assert.equal(partnerDemoSessionValid(invitation, now), true);
  assert.equal(partnerDemoSessionValid(invitation, invitation.sessionExpiresAt), false);
  invitation.revokedAt = now;
  assert.equal(partnerDemoStatus(invitation, now), "REVOKED");
  assert.equal(partnerDemoSessionValid(invitation, now), false);
});

test("only Super Admin sees partner invitation controls", () => {
  const links = (role) => buildAdminNavigation(role).flatMap((section) => section.items.map((item) => item.href));
  assert.ok(links("SUPER_ADMIN").includes("/admin/partner-demos"));
  assert.ok(!links("SUPPORT").includes("/admin/partner-demos"));
});

test("partner tour uses six shared guides and has no live subscriber or admin data calls", async () => {
  assert.deepEqual(ruvanasProductGuides.map((guide) => guide.id), ["retail", "school", "radio", "health", "faith", "organisations"]);
  const [page, tour, access, admin, revoke, redeem, adminPage] = await Promise.all([
    readFile(new URL("../app/partner-demo/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/partner-demo/PartnerDemoTour.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/partner-demo-session.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/partner-demos/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/partner-demos/[invitationId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/partner-demo/redeem/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/partner-demos/page.js", import.meta.url), "utf8")
  ]);
  assert.match(page, /getPartnerDemoAccess/);
  assert.match(tour, /Read-only sample experience/);
  assert.doesNotMatch(tour, /fetch\(|\/api\/admin\//);
  assert.match(access, /partnerDemoSessionValid/);
  assert.match(admin, /user\.role !== "SUPER_ADMIN"/);
  assert.match(revoke, /user\.role !== "SUPER_ADMIN"/);
  assert.match(adminPage, /user\.role !== "SUPER_ADMIN"/);
  assert.match(redeem, /redeemedAt: null/);
  assert.match(redeem, /codeHash: null/);
  assert.doesNotMatch(redeem, /createSession|ruvanas_session/);
});

test("every product dashboard offers task-first choices", async () => {
  const paths = ["retail", "school", "radio", "health", "faith", "organisations"];
  for (const path of paths) {
    const page = await readFile(new URL(`../app/dashboard/${path}/page.js`, import.meta.url), "utf8");
    assert.match(page, path === "retail" ? /<RetailControlCentre\b/ : /quickTasks=/, `${path} needs daily task shortcuts`);
  }
});
