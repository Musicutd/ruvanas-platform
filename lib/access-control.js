import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isPlatformAdminRole,
  ORGANISATION_MEMBER_ROLES
} from "@/lib/permissions.mjs";
import {
  canAccessOrganisation,
  canOverrideTenantMembership,
  findOrganisationMembership
} from "@/lib/tenant-access.mjs";

export {
  isOrganisationRoleAllowed,
  isPlatformAdminRole,
  ORGANISATION_CONTENT_ROLES,
  ORGANISATION_MANAGER_ROLES,
  ORGANISATION_MEMBER_ROLES,
  PLATFORM_ADMIN_ROLES,
  PLATFORM_TENANT_OVERRIDE_ROLES
} from "@/lib/permissions.mjs";

export async function requirePlatformAdmin() {
  const user = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "Your session has expired. Please sign in again."
    };
  }

  if (!isPlatformAdminRole(user.role)) {
    return {
      ok: false,
      status: 403,
      error: "You are not authorised to perform this action."
    };
  }

  return { ok: true, user };
}

export async function requireOrganisationAccess(
  organisationId,
  allowedRoles = ORGANISATION_MEMBER_ROLES
) {
  const user = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "Your session has expired. Please sign in again."
    };
  }

  if (canOverrideTenantMembership(user.role)) {
    return { ok: true, user, membership: null };
  }

  const membership = await findOrganisationMembership(prisma, {
    userId: user.id,
    organisationId
  });

  if (!canAccessOrganisation({
    platformRole: user.role,
    membershipRole: membership?.role,
    allowedRoles
  })) {
    return {
      ok: false,
      status: 403,
      error: "You do not have permission to access this organisation."
    };
  }

  return { ok: true, user, membership };
}

