import { getCurrentUser } from "./auth";

const ADMIN_ROLES = ["SUPER_ADMIN", "SUPPORT"];

/**
 * Returns the current user if they have an admin-level role.
 * Returns null if not logged in or not an admin.
 */
export async function getAdminUser() {
  const user = await getCurrentUser();

  if (!user || !ADMIN_ROLES.includes(user.role)) {
    return null;
  }

  return user;
}

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}
