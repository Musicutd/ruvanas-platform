import { assertPreviewTesterState } from "./private-preview-account-policy.mjs";
import { isRetailSubscriberSession } from "./retail-subscriber-access.mjs";

const AUTH_METHODS = new Set(["PREVIEW_PASSWORD", "PREVIEW_CODE"]);
const PHYSICAL_PILLARS = ["RETAIL", "SCHOOL", "HEALTH", "FAITH", "ORGANISATIONS"];
const AUDIO_PILLARS = [...PHYSICAL_PILLARS, "ONLINE"];
// Dynamic records below are created with Prisma cuid(). Do not let a future
// static route (for example /notifications/preferences) match an id slot.
const ID = "c[a-z0-9]{24}";
const physicalOperations = [
  ["POST", /^\/api\/locations$/],
  ["PATCH", new RegExp(`^/api/locations/${ID}$`)],
  ["POST", new RegExp(`^/api/locations/${ID}/zones$`)],
  ["PATCH", new RegExp(`^/api/locations/${ID}/zones/${ID}$`)],
  ["POST", /^\/api\/player-setup$/],
  ["POST", new RegExp(`^/api/player-setup/${ID}/replace$`)]
];
const audioOperations = [
  ["POST", new RegExp(`^/api/player-sessions/${ID}/revoke$`)],
  ["GET", new RegExp(`^/api/programming/advanced-scheduler/${ID}/preview$`)],
  ["HEAD", new RegExp(`^/api/programming/advanced-scheduler/${ID}/preview$`)]
];
const personalOperations = [
  ["GET", /^\/dashboard\/account$/],
  ["HEAD", /^\/dashboard\/account$/],
  ["PATCH", /^\/api\/notifications$/],
  ["PATCH", new RegExp(`^/api/notifications/${ID}$`)],
  ["DELETE", /^\/api\/me\/security$/]
];

function canonicalPath(pathname) {
  return typeof pathname === "string" && pathname.length > 0 && pathname.length <= 2048 &&
    /^\/[A-Za-z0-9/_-]*$/.test(pathname) && !pathname.includes("//") &&
    (pathname === "/" || !pathname.endsWith("/"));
}

function subscriberTestingState(session, now) {
  const user = session?.user, grant = user?.privatePreviewAccess;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      !session?.id || !AUTH_METHODS.has(session.authMethod) || session.revokedAt ||
      !(session.expiresAt instanceof Date) || !Number.isFinite(session.expiresAt.getTime()) || session.expiresAt <= now ||
      !user?.id || session.userId !== user.id || grant?.subscriberTestingEnabled !== true ||
      session.activeOrganisationId !== grant.organisationId) return null;
  try {
    // This additive grant does not replace the old plan/mode, change a limit,
    // extend an expiry or grant output. Running workers keep their old checks.
    return assertPreviewTesterState(user, { now, requirePassword: session.authMethod === "PREVIEW_PASSWORD" });
  } catch { return null; }
}

export function isPrivatePreviewSubscriberTestingSession(session, now = new Date()) {
  return Boolean(subscriberTestingState(session, now));
}

/** This is only an extra preview boundary. Every reviewed handler must still
 * authenticate, enforce the assigned plan and role, and resolve resource ids
 * inside the active organisation. A matching path does not authorize an object.
 *
 * The flag is read only from the database-loaded PrivatePreviewAccess grant.
 * There is no request-body, query, role, email or public-plan shortcut. */
export function privatePreviewSubscriberTestingRequestAllowed({ session, pathname, method, now = new Date() } = {}) {
  if (!canonicalPath(pathname)) return false;
  const state = subscriberTestingState(session, now);
  if (!state) return false;
  // This reviewed selector stores a free feature-test snapshot for the exact
  // Retail pilot. It cannot change billing, the original plan or live output.
  if (pathname === "/api/account/test-tier") {
    return isRetailSubscriberSession(session, now) && (method === "GET" || method === "POST");
  }
  const matches = operations => operations.some(([verb, pattern]) => verb === method && pattern.test(pathname));
  const hasAny = pillars => pillars.some(pillar => state.pillars.includes(pillar));
  if (matches(personalOperations)) return true;
  if (hasAny(PHYSICAL_PILLARS) && matches(physicalOperations)) return true;
  if (hasAny(AUDIO_PILLARS) && matches(audioOperations)) return true;
  // Existing exact Retail/Radio draft and commercial routes remain in the
  // tester policy. Generic playlist writes can alter active sources, so they
  // are not substitutes for those reviewed draft handlers. Profile PATCH also
  // changes credentials; notification preferences can enable external email.
  // Billing, provisioning, public publishing, music upload/download, studio
  // jobs, team membership, digital signage and all output controls stay absent.
  return false;
}

/** Shared by subscriber APIs and their canManage UI flags. Apply only after
 * normal authentication; this guard never replaces role/quota/resource checks.
 * Ordinary accounts and the existing platform-owner flow retain their rules. */
export function subscriberWorkflowRequestAllowed(context, options = {}) {
  const session = context?.session, user = context?.user, membership = context?.membership;
  if (!session || !user?.id || session.userId !== user.id || !membership?.organisationId) return false;
  const grant = user.privatePreviewAccess || session.user?.privatePreviewAccess;
  const previewTester = Boolean(grant?.organisationId) ||
    (typeof session.authMethod === "string" && session.authMethod.startsWith("PREVIEW_") && user.role !== "SUPER_ADMIN");
  // Ordinary accounts use getActiveOrganisationContext's selected-membership
  // fallback when no active id is saved. Do not redefine that existing policy.
  if (!previewTester) return true;
  if (membership.organisationId !== session.activeOrganisationId ||
      !Array.isArray(context.memberships) || context.memberships.length !== 1 ||
      context.memberships[0].organisationId !== membership.organisationId ||
      context.memberships[0].role !== membership.role || membership.role !== "OWNER" ||
      session.user?.id !== user.id || grant !== user.privatePreviewAccess) return false;
  // Session lookup already loads and validates the full plan. Some handlers
  // request a smaller current organisation shape; merge fresh fields without
  // discarding the validated subscription when that relation was not selected.
  const previous = user.memberships?.[0];
  const selected = { ...previous, ...membership,
    organisation: { ...previous?.organisation, ...membership.organisation } };
  return privatePreviewSubscriberTestingRequestAllowed({ ...options,
    session: { ...session, user: { ...user, memberships: [selected] } } });
}
