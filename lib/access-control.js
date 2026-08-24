import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isOrganisationRoleAllowed,
  isPlatformAdminRole,
  ORGANISATION_MEMBER_ROLES,
  PLATFORM_TENANT_OVERRIDE_ROLES
} from "@/lib/permissions.mjs";

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

  if (PLATFORM_TENANT_OVERRIDE_ROLES.includes(user.role)) {
    return { ok: true, user, membership: null };
  }

  const membership = await prisma.organisationMember.findUnique({
    where: {
      userId_organisationId: {
        userId: user.id,
        organisationId
      }
    }
  });

  if (!membership || !isOrganisationRoleAllowed(membership.role, allowedRoles)) {
    return {
      ok: false,
      status: 403,
      error: "You do not have permission to access this organisation."
    };
  }

  return { ok: true, user, membership };
}

