import { isPlatformAdminRole } from "./permissions.mjs";
import { SUBSCRIBER_PRODUCT_LIST } from "./product-access.mjs";

const DEFAULT_PUBLIC_URL = "https://www.ruvanas.com/";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function allowedEmail(value) {
  if (typeof value !== "string" || value.length < 3 || value.length > 254) return false;
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value)) return false;
  const [local, domain] = value.split("@");
  return local.length <= 64 && domain.split(".").every((label) =>
    /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label));
}

function publicUrlFromEnvironment(value, environment) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(environment.NODE_ENV !== "production" &&
      url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function previewOriginFromEnvironment(value, environment) {
  if (typeof value !== "string" || !value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    // Require a configured origin, not an origin inferred from request headers.
    // Comparing the original value also rejects empty query/hash and userinfo
    // delimiters that URL normalisation would otherwise erase.
    if (url.pathname !== "/" || (value !== url.origin && value !== `${url.origin}/`)) return null;
    const localFixture = environment.RUVANAS_ENVIRONMENT === "LOCAL_SYNTHETIC_PRIVATE_PREVIEW";
    const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) &&
      (environment.NODE_ENV !== "production" || localFixture);
    if (url.protocol !== "https:" && !loopbackHttp) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function readPrivatePreviewPolicy(env = process.env) {
  const mode = env.RUVANAS_PRIVATE_PREVIEW_ENABLED;
  const enabled = mode !== undefined && mode !== "0";
  const validMode = mode === undefined || mode === "0" || mode === "1";
  const allowedEmails = new Set();
  let validEmails = true;

  if (enabled) {
    const raw = env.RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS;
    if (typeof raw !== "string" || !raw.trim()) {
      validEmails = false;
    } else {
      for (const item of raw.split(",")) {
        const email = item.trim().toLowerCase();
        if (!allowedEmail(email) || allowedEmails.has(email)) {
          validEmails = false;
          break;
        }
        allowedEmails.add(email);
      }
    }
  }

  const configuredUrl = env.RUVANAS_PUBLIC_COMING_SOON_URL ?? DEFAULT_PUBLIC_URL;
  const publicUrl = publicUrlFromEnvironment(configuredUrl, env);
  const previewOrigin = enabled ? previewOriginFromEnvironment(env.RUVANAS_PUBLIC_URL, env) : null;
  const distinctOrigins = Boolean(publicUrl && previewOrigin &&
    previewOrigin !== new URL(publicUrl).origin);
  const configuredAdmin = env.RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL;
  const adminEmail = typeof configuredAdmin === "string" ? configuredAdmin.trim().toLowerCase() : null;
  const validAdmin = Boolean(adminEmail && allowedEmail(adminEmail) && allowedEmails.has(adminEmail));
  return {
    enabled,
    valid: validMode && (!enabled || (validEmails && validAdmin && distinctOrigins)),
    allowedEmails,
    adminEmail,
    publicUrl,
    previewOrigin
  };
}

export function isPrivatePreviewTester(user, policy, now = new Date()) {
  const access = user?.privatePreviewAccess;
  return Boolean(policy?.enabled && policy.valid && user?.role === "OWNER" &&
    user.email?.trim().toLowerCase() !== policy.adminEmail && access?.enabled === true &&
    access.userId === user.id && typeof user.id === "string" && user.id.length > 0 &&
    typeof access.organisationId === "string" && access.organisationId.length > 0 &&
    access.expiresAt instanceof Date && access.expiresAt > now &&
    Array.isArray(access.pillars) && access.pillars.length >= 1 && access.pillars.length <= 7 &&
    new Set(access.pillars).size === access.pillars.length && access.pillars.every((key) =>
      SUBSCRIBER_PRODUCT_LIST.some((product) => product.key === key)));
}

export function isPrivatePreviewUserAllowed(user, policy) {
  if (!policy) return false;
  if (!policy.enabled) return true;
  if (!policy.valid) return false;
  const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
  return allowedEmail(email) && ((email === policy.adminEmail && user?.role === "SUPER_ADMIN" &&
    policy.allowedEmails.has(email)) || isPrivatePreviewTester(user, policy));
}

export function isPrivatePreviewAdmin(user, policy) {
  return Boolean(policy?.enabled && policy.valid && user?.role === "SUPER_ADMIN" &&
    typeof user.email === "string" && user.email.trim().toLowerCase() === policy.adminEmail &&
    isPrivatePreviewUserAllowed(user, policy));
}

export function isPrivatePreviewOwnerBootstrapSession(session, policy) {
  return Boolean(session?.authMethod === "PREVIEW_CODE" && isPrivatePreviewAdmin(session.user, policy) &&
    (!session.user.privatePreviewAccess || (session.user.privatePreviewAccess.enabled === true &&
      session.user.privatePreviewAccess.userId === session.user.id &&
      session.user.privatePreviewAccess.organisationId === null && session.user.privatePreviewAccess.expiresAt === null &&
      Array.isArray(session.user.privatePreviewAccess.pillars) && session.user.privatePreviewAccess.pillars.length === 0 &&
      !session.user.privatePreviewAccess.passwordEnabled)));
}

export function isPrivatePreviewAdminSession(session, policy) {
  const access = session?.user?.privatePreviewAccess;
  return Boolean(session?.authMethod === "PREVIEW_PASSWORD" && isPrivatePreviewAdmin(session.user, policy) &&
    access?.userId === session.user.id && access.enabled === true && access.passwordEnabled === true &&
    access.organisationId === null && access.expiresAt === null && Array.isArray(access.pillars) && access.pillars.length === 0);
}

// Fixed destinations only. Ordinary PASSWORD/SSO sessions never enter preview.
export function privatePreviewDashboardRoute(user, policy) {
  if (!policy?.enabled || !policy.valid || !isPrivatePreviewUserAllowed(user, policy)) return null;
  if (isPrivatePreviewAdmin(user, policy)) return "/admin";
  if (isPlatformAdminRole(user?.role)) return null;
  return isPrivatePreviewTester(user, policy) ? "/preview-dashboard" : null;
}

export function privatePreviewSessionLanding(session, policy) {
  if (isPrivatePreviewOwnerBootstrapSession(session, policy)) return "/admin/private-preview";
  if (isPrivatePreviewAdminSession(session, policy)) return "/admin";
  if (!["PREVIEW_CODE", "PREVIEW_PASSWORD"].includes(session?.authMethod) ||
      !isPrivatePreviewTester(session.user, policy) ||
      session.activeOrganisationId !== session.user.privatePreviewAccess.organisationId ||
      (session.authMethod === "PREVIEW_PASSWORD" && !session.user.privatePreviewAccess.passwordEnabled)) return null;
  return "/preview-dashboard";
}

// Preview accounts are provisioned by the owner, never self-created through
// registration or an alternative invitation/redemption journey.
export function isPrivatePreviewRegistrationPath(path) {
  return ["/register", "/api/auth/register", "/api/complimentary-access/redeem",
    "/team-invitation/accept", "/api/organisation/team/accept",
    "/school-student/accept", "/api/school-student/accept"].some((base) =>
    path === base || path.startsWith(`${base}/`));
}
