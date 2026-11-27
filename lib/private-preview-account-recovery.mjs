import { readPrivatePreviewPolicy } from "./private-preview-policy.mjs";
import { z } from "zod";

const PREFIX = "RUVANAS_PRIVATE_PREVIEW_ACCOUNT_RECOVERY";
const DAY_MS = 24 * 60 * 60 * 1_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/;
const ROLES = new Set(["OWNER", "MANAGER"]);
const READS = new Set(["GET", "HEAD"]);
const PAGES = new Set(["/forgot-password", "/reset-password"]);
const APIS = new Set(["/api/auth/password-recovery/request", "/api/auth/password-recovery/reset"]);
const EMPTY = Object.freeze([]);
const OFF = Object.freeze({ enabled: false, valid: true, accounts: EMPTY, expiresAt: null });
const INVALID = Object.freeze({ enabled: false, valid: false, accounts: EMPTY, expiresAt: null });
const validId = value => typeof value === "string" && ID.test(value);
const emailSchema = z.string().max(254).email().regex(/^[\x21-\x7e]+$/);
const canonicalEmail = value => typeof value === "string" && value === value.trim().toLowerCase() && emailSchema.safeParse(value).success;

function deadline(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  return parsed.toISOString() === canonical ? parsed : null;
}

// Recovery is independent of product activation. It grants no sign-in session,
// membership or Rewards access and has its own exact, expiring identity scope.
export function readPrivatePreviewRecoveryPolicy(env = {}, now = new Date()) {
  try {
    const flag = env[`${PREFIX}_ENABLED`];
    if (![undefined, "false", "true"].includes(flag)) return INVALID;
    const preview = readPrivatePreviewPolicy(env);
    if (!preview.valid) return INVALID;
    if (flag !== "true" || !preview.enabled) return OFF;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return INVALID;
    const expiresAt = deadline(env[`${PREFIX}_EXPIRES_AT`]);
    if (!expiresAt || expiresAt <= now || expiresAt.getTime() - now.getTime() > DAY_MS) return INVALID;
    const raw = env[`${PREFIX}_ACCOUNTS`];
    if (typeof raw !== "string" || raw.length > 16_384) return INVALID;
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 10) return INVALID;
    const seen = new Set(), accounts = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
          Object.keys(entry).length !== 3 || !Object.hasOwn(entry, "userId") || !Object.hasOwn(entry, "organisationId") ||
          !Object.hasOwn(entry, "email") || !validId(entry.userId) || !validId(entry.organisationId) || !canonicalEmail(entry.email)) return INVALID;
      const key = `${entry.userId}:${entry.organisationId}`;
      if (seen.has(key)) return INVALID;
      seen.add(key);
      accounts.push(Object.freeze({ userId: entry.userId, organisationId: entry.organisationId, email: entry.email }));
    }
    return Object.freeze({ enabled: true, valid: true, accounts: Object.freeze(accounts), expiresAt });
  } catch { return INVALID; }
}

// A route match is bootstrap admission only. Both API handlers must independently
// enforce the current policy and exact account eligibility before any mutation.
export function privatePreviewRecoveryRoute(path, method, hasServerAction = false) {
  if (typeof path !== "string" || hasServerAction || /[%\\?#]/.test(path)) return null;
  if (READS.has(method) && PAGES.has(path)) return "PAGE";
  if (method === "POST" && APIS.has(path)) return "API";
  if (READS.has(method) && path.startsWith("/_next/static/") &&
      path.slice("/_next/static/".length).split("/").every(part =>
        part.length > 0 && part !== "." && part !== ".." && /^[A-Za-z0-9_.-]+$/.test(part))) return "ASSET";
  return null;
}

export function privatePreviewRecoveryIdentity(user, env = {}, now = new Date()) {
  try {
    const policy = readPrivatePreviewRecoveryPolicy(env, now);
    if (!policy.enabled || !user || !validId(user.id) || !canonicalEmail(user.email) || !ROLES.has(user.role) ||
        user.privatePreviewAccess !== null || !Array.isArray(user.memberships) || user.memberships.length > 1_000) return null;
    const eligible = user.memberships.filter(member => member && validId(member.id) &&
      member.userId === user.id && ROLES.has(member.role) && validId(member.organisationId) &&
      member.organisation?.id === member.organisationId &&
      policy.accounts.some(account => account.userId === user.id && account.organisationId === member.organisationId && account.email === user.email));
    if (eligible.length !== 1) return null;
    const member = eligible[0], security = member.organisation.enterpriseSecurityPolicy;
    // Missing selected policy data is not proof that password fallback is allowed.
    if (security === undefined || (security !== null &&
        (typeof security !== "object" || Array.isArray(security) ||
          typeof security.ssoRequired !== "boolean" || typeof security.passwordFallback !== "boolean" ||
          (security.ssoRequired && !security.passwordFallback)))) return null;
    return { userId: user.id, organisationId: member.organisationId, memberId: member.id, email: user.email };
  } catch { return null; }
}
