import {
  isOrganisationRoleAllowed,
  PLATFORM_TENANT_OVERRIDE_ROLES
} from "./permissions.mjs";

export function canOverrideTenantMembership(platformRole) {
  return PLATFORM_TENANT_OVERRIDE_ROLES.includes(platformRole);
}

export async function findOrganisationMembership(
  database,
  { userId, organisationId }
) {
  return database.organisationMember.findUnique({
    where: {
      userId_organisationId: {
        userId,
        organisationId
      }
    }
  });
}

export function canAccessOrganisation({
  platformRole,
  membershipRole,
  allowedRoles
}) {
  return Boolean(
    canOverrideTenantMembership(platformRole) ||
    (membershipRole &&
      isOrganisationRoleAllowed(membershipRole, allowedRoles))
  );
}

