export const PLATFORM_ADMIN_ROLES = Object.freeze([
  "SUPER_ADMIN",
  "SUPPORT"
]);

export const PLATFORM_TENANT_OVERRIDE_ROLES = Object.freeze([
  "SUPER_ADMIN"
]);

export const ORGANISATION_MEMBER_ROLES = Object.freeze([
  "OWNER",
  "MANAGER",
  "CONTENT_EDITOR",
  "VIEWER"
]);

export const ORGANISATION_MANAGER_ROLES = Object.freeze([
  "OWNER",
  "MANAGER"
]);

export const ORGANISATION_CONTENT_ROLES = Object.freeze([
  "OWNER",
  "MANAGER",
  "CONTENT_EDITOR"
]);

export function isPlatformAdminRole(role) {
  return PLATFORM_ADMIN_ROLES.includes(role);
}

export function isOrganisationRoleAllowed(role, allowedRoles) {
  return allowedRoles.includes(role);
}

