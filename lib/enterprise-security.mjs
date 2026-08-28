import crypto from "node:crypto";

export const SERVICE_ACCOUNT_SCOPES = Object.freeze([
  "organisation:read",
  "analytics:read",
  "reports:read",
  "media:read"
]);

export function normalizeServiceAccountScopes(scopes) {
  if (!Array.isArray(scopes)) return [];

  return [...new Set(scopes.map((scope) => String(scope || "").trim().toLowerCase()))]
    .filter((scope) => SERVICE_ACCOUNT_SCOPES.includes(scope))
    .sort();
}

export function normalizeEmailDomains(domains) {
  if (!Array.isArray(domains)) return [];

  return [...new Set(domains.map((domain) => String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")))]
    .filter((domain) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain))
    .sort();
}

export function validateEnterprisePolicy(input, { providerReady = false } = {}) {
  const sessionMaxAgeMinutes = Number(input.sessionMaxAgeMinutes);
  const idleTimeoutMinutes = Number(input.idleTimeoutMinutes);
  const ssoRequired = input.ssoRequired === true;
  const passwordFallback = input.passwordFallback !== false;

  if (!Number.isInteger(sessionMaxAgeMinutes) || sessionMaxAgeMinutes < 60 || sessionMaxAgeMinutes > 43200) {
    return { ok: false, error: "Session maximum age must be between 60 minutes and 30 days." };
  }

  if (!Number.isInteger(idleTimeoutMinutes) || idleTimeoutMinutes < 15 || idleTimeoutMinutes > sessionMaxAgeMinutes) {
    return { ok: false, error: "Idle timeout must be at least 15 minutes and no longer than the session maximum age." };
  }

  if (ssoRequired && !providerReady) {
    return { ok: false, error: "SSO cannot be required until a verified identity provider is ready." };
  }

  return {
    ok: true,
    policy: {
      ssoRequired,
      passwordFallback,
      sessionMaxAgeMinutes,
      idleTimeoutMinutes,
      allowedEmailDomains: normalizeEmailDomains(input.allowedEmailDomains)
    }
  };
}

export function hashServiceApiKey(rawKey, secret) {
  if (!secret || String(secret).length < 32) {
    throw new Error("A service API key hashing secret of at least 32 characters is required.");
  }

  return crypto.createHmac("sha256", secret).update(String(rawKey)).digest("hex");
}

export function generateServiceApiKey(secret, randomBytes = crypto.randomBytes) {
  const publicPart = randomBytes(6).toString("hex");
  const privatePart = randomBytes(32).toString("hex");
  const prefix = `rvsa_${publicPart}`;
  const rawKey = `${prefix}_${privatePart}`;

  return {
    rawKey,
    prefix,
    tokenHash: hashServiceApiKey(rawKey, secret)
  };
}

export function serviceAccountIsUsable(account, key, now = new Date()) {
  return Boolean(
    account?.status === "ACTIVE" &&
    !account.revokedAt &&
    (!account.expiresAt || new Date(account.expiresAt) > now) &&
    key?.status === "ACTIVE" &&
    !key.revokedAt &&
    (!key.expiresAt || new Date(key.expiresAt) > now)
  );
}

export function scopeAllows(grantedScopes, requiredScope) {
  return normalizeServiceAccountScopes(grantedScopes).includes(requiredScope);
}

