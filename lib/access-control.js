import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { subscriberProductAccess } from "@/lib/product-access.mjs";
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

export async function requireOrganisationProductAccess(
  organisationId,
  product,
  allowedRoles = ORGANISATION_MEMBER_ROLES
) {
  const access = await requireOrganisationAccess(organisationId, allowedRoles);
  if (!access.ok || !access.membership) return access;

  const subscription = await prisma.subscription.findUnique({
    where: { organisationId },
    include: { plan: true, billingContract: true }
  });
  const entitlements = resolveEntitlements(subscription);
  const decision = subscriberProductAccess(entitlements, product);
  if (!decision.allowed) {
    return {
      ok: false,
      status: 403,
      error: `${decision.product?.label || "This product"} is not included for this organisation.`
    };
  }

  return { ...access, entitlements };
}

