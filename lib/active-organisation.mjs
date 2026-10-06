import { enterpriseSessionIsUsable } from "./enterprise-security.mjs";

export function selectActiveMembership(memberships, activeOrganisationId) {
  if (!Array.isArray(memberships) || memberships.length === 0) {
    return null;
  }

  return (
    memberships.find(
      (membership) => membership.organisationId === activeOrganisationId
    ) || memberships[0]
  );
}

// A fallback membership must not inherit the session policy of an organisation
// that the user can no longer access. Apply the selected organisation's policy
// before exposing its context or switching to it.
export function activeMembershipAllowedForSession(membership, session, now = new Date()) {
  return Boolean(
    membership?.organisation &&
    enterpriseSessionIsUsable(session, membership.organisation.enterpriseSecurityPolicy, now)
  );
}

export async function findSessionFallbackMembership(database, session) {
  if (session.activeOrganisationId) {
    const selected = await database.organisationMember.findUnique({
      where: { userId_organisationId: { userId: session.userId, organisationId: session.activeOrganisationId } },
      select: { id: true }
    });
    if (selected) return null;
  }
  return database.organisationMember.findFirst({
    where: { userId: session.userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { organisation: { include: { enterpriseSecurityPolicy: true } } }
  });
}

