import { PREVIEW_TESTER_PLAN, PREVIEW_ONLINE_DRAFT_PLAN, PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN,
  previewTesterOverrides } from "../../lib/private-preview-account-policy.mjs";

export const SUBSCRIBER_TESTING_NOW = new Date("2026-11-01T08:00:00Z");
export const testCuid = number => `c${String(number).padStart(24, "0")}`;

export function subscriberTestingContext({ enabled = true, pillars, mode = "READ_ONLY", now = SUBSCRIBER_TESTING_NOW,
  organisationId = testCuid(10), userId = testCuid(20), email = "subscriber@example.test" } = {}) {
  const selected = pillars || (mode === "READ_ONLY" ? ["RETAIL"] : ["ONLINE"]);
  const expiresAt = new Date(now.getTime() + 30 * 86_400_000);
  const plans = { READ_ONLY: PREVIEW_TESTER_PLAN, ONLINE_DRAFT: PREVIEW_ONLINE_DRAFT_PLAN,
    ONLINE_DRAFT_CATALOGUE: PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN };
  const subscription = { organisationId, plan: structuredClone(plans[mode]), status: "TRIAL",
    billingContract: null, currentPeriodEnd: expiresAt, complimentaryAccessActive: false,
    schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false,
    ...previewTesterOverrides(selected) };
  const organisation = { id: organisationId, name: "Synthetic subscriber test", subscription, enterpriseSecurityPolicy: null };
  const membership = { organisationId, userId, role: "OWNER", organisation };
  const user = { id: userId, email, role: "OWNER", memberships: [membership], privatePreviewAccess: {
    userId, organisationId, enabled: true, passwordEnabled: true, subscriberTestingEnabled: enabled,
    pillars: selected, expiresAt } };
  const session = { id: testCuid(30), userId, user, authMethod: "PREVIEW_PASSWORD",
    activeOrganisationId: organisationId, expiresAt, revokedAt: null };
  return { session, user, membership, memberships: [membership] };
}
