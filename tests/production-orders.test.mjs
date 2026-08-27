import assert from "node:assert/strict";
import test from "node:test";
import {
  normaliseProductionOrderPayload,
  productionPermissions,
  transitionProductionOrder
} from "../lib/production-orders.mjs";

function validBrief(overrides = {}) {
  return {
    title: "Autumn promotion",
    promotionDetails: "Promote the autumn collection across participating stores.",
    languageCodes: ["EN", "mt", "en"],
    targetDurationSeconds: 30,
    campaignStartsOn: "2026-09-01",
    campaignEndsOn: "2026-09-30",
    contactName: "Retail Manager",
    contactEmail: "MANAGER@example.com",
    fundingType: "PLAN_INCLUDED",
    priority: "STANDARD",
    submitNow: true,
    ...overrides
  };
}

test("production briefs normalise tenant-safe structured fields", () => {
  const brief = normaliseProductionOrderPayload(validBrief());
  assert.deepEqual(brief.languageCodes, ["en", "mt"]);
  assert.equal(brief.contactEmail, "manager@example.com");
  assert.equal(brief.targetDurationSeconds, 30);
  assert.equal(brief.campaignStartsOn.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("production briefs reject invalid languages, duration, dates, and contacts", () => {
  assert.throws(() => normaliseProductionOrderPayload(validBrief({ languageCodes: ["not valid"] })), /language codes/);
  assert.throws(() => normaliseProductionOrderPayload(validBrief({ targetDurationSeconds: 601 })), /between 5 and 600/);
  assert.throws(() => normaliseProductionOrderPayload(validBrief({ campaignEndsOn: "2026-08-01" })), /on or after/);
  assert.throws(() => normaliseProductionOrderPayload(validBrief({ contactEmail: "not-an-email" })), /valid contact email/);
});

test("organisation content staff can submit a draft but cannot run production actions", () => {
  const permissions = productionPermissions({ platformRole: "CONTENT_EDITOR", membershipRole: "CONTENT_EDITOR" });
  assert.equal(transitionProductionOrder({ currentStatus: "DRAFT", action: "SUBMIT", permissions }).status, "SUBMITTED");
  assert.throws(() => transitionProductionOrder({ currentStatus: "SUBMITTED", action: "START_PRODUCTION", permissions }), /permission/);
});

test("platform production staff follow the controlled production sequence", () => {
  const permissions = productionPermissions({ platformRole: "SUPER_ADMIN", membershipRole: "OWNER" });
  assert.equal(transitionProductionOrder({ currentStatus: "SUBMITTED", action: "START_PRODUCTION", permissions }).status, "IN_PRODUCTION");
  assert.equal(transitionProductionOrder({ currentStatus: "IN_PRODUCTION", action: "REQUEST_APPROVAL", permissions }).status, "AWAITING_CUSTOMER_APPROVAL");
  assert.equal(transitionProductionOrder({ currentStatus: "APPROVED", action: "DELIVER", permissions }).status, "DELIVERED");
});

test("customer approval and revision requests require manager authority", () => {
  const manager = productionPermissions({ platformRole: "OWNER", membershipRole: "MANAGER" });
  const editor = productionPermissions({ platformRole: "CONTENT_EDITOR", membershipRole: "CONTENT_EDITOR" });
  assert.equal(transitionProductionOrder({ currentStatus: "AWAITING_CUSTOMER_APPROVAL", action: "APPROVE", permissions: manager }).status, "APPROVED");
  assert.throws(() => transitionProductionOrder({ currentStatus: "AWAITING_CUSTOMER_APPROVAL", action: "APPROVE", permissions: editor }), /permission/);
  assert.throws(() => transitionProductionOrder({ currentStatus: "AWAITING_CUSTOMER_APPROVAL", action: "REQUEST_CHANGES", permissions: manager }), /reason is required/);
  assert.equal(transitionProductionOrder({ currentStatus: "AWAITING_CUSTOMER_APPROVAL", action: "REQUEST_CHANGES", note: "Correct the dates.", permissions: manager }).status, "CHANGES_REQUESTED");
});

test("final production-order states cannot be reopened by an invalid transition", () => {
  const permissions = productionPermissions({ platformRole: "SUPER_ADMIN", membershipRole: "OWNER" });
  assert.throws(() => transitionProductionOrder({ currentStatus: "DELIVERED", action: "SUBMIT", permissions }), /cannot be changed/);
  assert.throws(() => transitionProductionOrder({ currentStatus: "CANCELLED", action: "START_PRODUCTION", permissions }), /cannot be changed/);
});


