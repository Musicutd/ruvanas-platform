import crypto from "node:crypto";

export const DJ_ACCESS_CAPABILITIES = Object.freeze([
  ["VIEW_CHANNEL", "View channel status"],
  ["CONTROL_EXTERNAL_LIVE", "Control External Live"],
  ["START_BROWSER_STUDIO", "Start Browser Live Studio"],
  ["RECORD_LIVE_SESSION", "Record a live session"]
]);

export const DJ_ACCESS_MINUTES_MIN = 15;
export const DJ_ACCESS_HOURS_MAX = 12;

const CAPABILITIES = new Set(DJ_ACCESS_CAPABILITIES.map(([value]) => value));

function boundedText(value, maximum) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

function requiredDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be a valid date and time.`);
  return date;
}

export function normalizeDjCapabilities(values) {
  const requested = Array.isArray(values) ? values : [];
  const capabilities = [...new Set(["VIEW_CHANNEL", ...requested.map((value) => String(value || "").trim().toUpperCase())])];
  if (capabilities.some((capability) => !CAPABILITIES.has(capability))) throw new Error("Choose only supported DJ permissions.");
  if (capabilities.includes("RECORD_LIVE_SESSION") && !capabilities.includes("START_BROWSER_STUDIO")) {
    throw new Error("Recording permission requires Browser Live Studio permission.");
  }
  return capabilities;
}

export function parseDjAccessGrantInput(input = {}, now = new Date()) {
  const label = boundedText(input.label, 120);
  const channelId = boundedText(input.channelId, 120);
  const granteeUserId = boundedText(input.granteeUserId, 120);
  const startsAt = requiredDate(input.startsAt, "The access start");
  const endsAt = requiredDate(input.endsAt, "The access end");
  const capabilities = normalizeDjCapabilities(input.capabilities);
  if (label.length < 2) throw new Error("Add a clear DJ access label.");
  if (!channelId) throw new Error("Choose an active channel.");
  if (!granteeUserId) throw new Error("Choose a member of this organisation.");
  if (endsAt <= startsAt) throw new Error("DJ access must end after it starts.");
  if (endsAt.getTime() - startsAt.getTime() < DJ_ACCESS_MINUTES_MIN * 60_000) throw new Error(`DJ access must last at least ${DJ_ACCESS_MINUTES_MIN} minutes.`);
  if (endsAt.getTime() - startsAt.getTime() > DJ_ACCESS_HOURS_MAX * 60 * 60_000) throw new Error(`DJ access cannot exceed ${DJ_ACCESS_HOURS_MAX} hours.`);
  if (endsAt <= now) throw new Error("DJ access cannot end in the past.");
  if (startsAt.getTime() > now.getTime() + 90 * 24 * 60 * 60_000) throw new Error("DJ access can be scheduled up to 90 days ahead.");
  return { label, channelId, granteeUserId, startsAt, endsAt, capabilities };
}

export function createDjAccessToken(now = new Date(), grantEndsAt) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const normalEnd = requiredDate(grantEndsAt, "The DJ access end");
  const expiresAt = normalEnd;
  if (expiresAt <= now) throw new Error("DJ access is outside its valid window.");
  return { rawToken, tokenHash: hashDjAccessToken(rawToken), expiresAt };
}

export function hashDjAccessToken(rawToken) {
  const value = String(rawToken || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("This DJ access link is incomplete.");
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function djGrantAvailability(grant, now = new Date(), requiredCapability = "VIEW_CHANNEL") {
  if (!grant || grant.status !== "ACTIVE" || grant.revokedAt) return { allowed: false, reason: "DJ_ACCESS_REVOKED" };
  if (new Date(grant.startsAt) > now) return { allowed: false, reason: "DJ_ACCESS_NOT_STARTED" };
  if (new Date(grant.endsAt) <= now) return { allowed: false, reason: "DJ_ACCESS_EXPIRED" };
  if (!grant.capabilities?.includes(requiredCapability)) return { allowed: false, reason: "DJ_CAPABILITY_DENIED" };
  return { allowed: true, reason: null };
}

export function isDjAccessTokenActive(token, now = new Date()) {
  return Boolean(token && !token.revokedAt && new Date(token.expiresAt) > now);
}

export function safeDjAccessGrant(grant, now = new Date()) {
  const availability = djGrantAvailability(grant, now);
  return {
    id: grant.id,
    label: grant.label,
    channel: grant.channel,
    grantee: grant.grantee ? { id: grant.grantee.id, name: grant.grantee.name || "Team member", email: grant.grantee.email } : null,
    capabilities: grant.capabilities,
    status: grant.status,
    state: grant.status === "REVOKED" ? "REVOKED" : new Date(grant.endsAt) <= now ? "EXPIRED" : new Date(grant.startsAt) > now ? "SCHEDULED" : availability.allowed ? "ACTIVE" : "UNAVAILABLE",
    startsAt: new Date(grant.startsAt).toISOString(),
    endsAt: new Date(grant.endsAt).toISOString(),
    revokedAt: grant.revokedAt ? new Date(grant.revokedAt).toISOString() : null,
    revokeReason: grant.revokeReason || null,
    createdAt: new Date(grant.createdAt).toISOString(),
    token: grant.tokens?.[0] ? { expiresAt: new Date(grant.tokens[0].expiresAt).toISOString(), lastUsedAt: grant.tokens[0].lastUsedAt ? new Date(grant.tokens[0].lastUsedAt).toISOString() : null, active: isDjAccessTokenActive(grant.tokens[0], now) } : null
  };
}
