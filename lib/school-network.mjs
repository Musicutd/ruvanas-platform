export const SCHOOL_NETWORK_ROLES = Object.freeze(["OWNER", "ADMIN", "VIEWER"]);
export const SCHOOL_NETWORK_MANAGER_ROLES = Object.freeze(["OWNER", "ADMIN"]);
export const SCHOOL_NETWORK_ORGANISATION_ROLES = Object.freeze(["MANAGER", "CONTENT_EDITOR", "VIEWER"]);

export function canViewSchoolNetwork({ platformRole, networkRole }) {
  return platformRole === "SUPER_ADMIN" || SCHOOL_NETWORK_ROLES.includes(networkRole);
}

export function canManageSchoolNetwork({ platformRole, networkRole }) {
  return platformRole === "SUPER_ADMIN" || SCHOOL_NETWORK_MANAGER_ROLES.includes(networkRole);
}

export function canChangeSchoolNetworkOwners({ platformRole, networkRole }) {
  return platformRole === "SUPER_ADMIN" || networkRole === "OWNER";
}

export function validateSchoolAccessGrant({ organisationRole }) {
  if (!SCHOOL_NETWORK_ORGANISATION_ROLES.includes(organisationRole)) {
    throw new Error("Academy access can grant manager, content editor, or viewer permissions only.");
  }
  return organisationRole;
}

export function schoolNetworkSummary(school, { canOpen = false } = {}) {
  const organisation = school?.organisation || {};
  const counts = organisation._count || {};
  return {
    id: school.id,
    organisationId: organisation.id,
    name: organisation.name,
    slug: organisation.slug,
    active: Boolean(school.active),
    joinedAt: school.joinedAt,
    canOpen: Boolean(canOpen),
    metrics: {
      locations: Number(counts.locations || 0),
      classes: Number(counts.studentGroups || 0),
      programmes: Number(counts.schoolProgrammes || 0),
      episodes: Number(counts.schoolEpisodes || 0),
      assignments: Number(counts.assignments || 0)
    }
  };
}

export function redactedNetworkMember(member, { includeIdentity = false } = {}) {
  return {
    id: member.id,
    role: member.role,
    ...(includeIdentity
      ? { user: { id: member.user.id, name: member.user.name, email: member.user.email } }
      : {})
  };
}

