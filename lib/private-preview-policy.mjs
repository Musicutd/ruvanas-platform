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
  return {
    enabled,
    valid: validMode && (!enabled || (validEmails && distinctOrigins)),
    allowedEmails,
    publicUrl,
    previewOrigin
  };
}

export function isPrivatePreviewUserAllowed(user, policy) {
  if (!policy) return false;
  if (!policy.enabled) return true;
  if (!policy.valid) return false;
  const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
  return allowedEmail(email) && policy.allowedEmails.has(email);
}
