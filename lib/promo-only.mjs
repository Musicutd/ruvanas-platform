import crypto from "node:crypto";
import saxesPackage from "saxes";
import { validateDistributorEndpoint } from "./music-distributor.mjs";

const { SaxesParser } = saxesPackage;

export const PROMO_ONLY_PROVIDER = "PROMO_ONLY";
export const PROMO_ONLY_MODES = Object.freeze(["OFF", "DISCOVERY", "METADATA", "AUDIO_TEST"]);
export const PROMO_ONLY_IMPORT_STATES = Object.freeze([
  "DISCOVERED", "RESOLVING", "METADATA_READY", "DOWNLOAD_QUEUED", "DOWNLOADING",
  "MEDIA_VALIDATED", "CATALOGUED", "AUTODJ_READY", "RECONCILIATION_REQUIRED",
  "FAILED_RETRYABLE", "FAILED_PERMANENT"
]);
export const PROMO_ONLY_DEFAULT_MAX_RSS_BYTES = 2 * 1024 * 1024;
export const PROMO_ONLY_DEFAULT_MAX_AUDIO_BYTES = 50 * 1024 * 1024;

function envBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function envInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function optionalPublicHttpsUrl(value, label) {
  if (!String(value || "").trim()) return null;
  return validateDistributorEndpoint(value, label);
}

export function readPromoOnlyConfig(env = process.env) {
  const enabled = envBoolean(env.PROMOONLY_ENABLED, false);
  const requestedMode = String(env.PROMOONLY_MODE || (enabled ? "DISCOVERY" : "OFF")).trim().toUpperCase();
  if (requestedMode === "PRODUCTION") {
    const error = new Error("Promo Only PRODUCTION mode is locked in this testing build.");
    error.code = "PROMOONLY_PRODUCTION_LOCKED";
    throw error;
  }
  if (!PROMO_ONLY_MODES.includes(requestedMode)) {
    const error = new Error("Choose OFF, DISCOVERY, METADATA or AUDIO_TEST for PROMOONLY_MODE.");
    error.code = "PROMOONLY_MODE_INVALID";
    throw error;
  }
  const mode = enabled ? requestedMode : "OFF";
  const rssUrl = optionalPublicHttpsUrl(env.PROMOONLY_RSS_URL, "Promo Only RSS URL");
  if (enabled && mode !== "OFF" && !rssUrl) {
    const error = new Error("PROMOONLY_RSS_URL is required while Promo Only sync is enabled.");
    error.code = "PROMOONLY_RSS_URL_REQUIRED";
    throw error;
  }
  const userId = String(env.PROMOONLY_USER_ID || "").trim();
  const apiKey = String(env.PROMOONLY_API_KEY || "").trim();
  const apiSecret = String(env.PROMOONLY_API_SECRET || "").trim();
  const credentialsConfigured = Boolean(userId && apiKey && apiSecret);
  if (["METADATA", "AUDIO_TEST"].includes(mode) && !credentialsConfigured) {
    const error = new Error("Promo Only API credentials are required for METADATA and AUDIO_TEST modes.");
    error.code = "PROMOONLY_CREDENTIALS_REQUIRED";
    throw error;
  }
  const downloadRole = String(env.PROMOONLY_DOWNLOAD_ROLE || "SUPER_ADMIN").trim().toUpperCase();
  if (downloadRole !== "SUPER_ADMIN") {
    const error = new Error("PROMOONLY_DOWNLOAD_ROLE must remain SUPER_ADMIN.");
    error.code = "PROMOONLY_DOWNLOAD_ROLE_INVALID";
    throw error;
  }
  return Object.freeze({
    enabled,
    mode,
    rssUrl,
    pollMinutes: envInteger(env.PROMOONLY_POLL_MINUTES, 30, 15, 10_080),
    userId,
    apiKey,
    apiSecret,
    credentialsConfigured,
    audioDownloadEnabled: envBoolean(env.PROMOONLY_AUDIO_DOWNLOAD_ENABLED, false),
    allowHttpMediaTest: envBoolean(env.PROMOONLY_ALLOW_HTTP_MEDIA_TEST, false),
    downloadRole,
    maxDownloadsPerRun: envInteger(env.PROMOONLY_MAX_DOWNLOADS_PER_RUN, 10, 1, 50),
    autoCreateGenres: envBoolean(env.PROMOONLY_AUTO_CREATE_GENRES, true),
    genreReviewRequired: envBoolean(env.PROMOONLY_GENRE_REVIEW_REQUIRED, false),
    requestTimeoutMs: envInteger(env.PROMOONLY_REQUEST_TIMEOUT_MS, 20_000, 2_000, 60_000),
    retryMax: envInteger(env.PROMOONLY_RETRY_MAX, 3, 0, 5),
    maxRssBytes: envInteger(env.PROMOONLY_MAX_RSS_BYTES, PROMO_ONLY_DEFAULT_MAX_RSS_BYTES, 64 * 1024, 10 * 1024 * 1024),
    maxAudioBytes: envInteger(env.PROMOONLY_MAX_AUDIO_BYTES, PROMO_ONLY_DEFAULT_MAX_AUDIO_BYTES, 1024 * 1024, 250 * 1024 * 1024),
    downloadHosts: String(env.PROMOONLY_DOWNLOAD_HOSTS || "")
      .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
  });
}

export function safePromoOnlyConfig(config) {
  return Object.freeze({
    enabled: Boolean(config?.enabled),
    mode: PROMO_ONLY_MODES.includes(config?.mode) ? config.mode : "OFF",
    rssConfigured: Boolean(config?.rssUrl),
    rssHost: config?.rssUrl ? new URL(config.rssUrl).hostname : null,
    pollMinutes: config?.pollMinutes || 30,
    credentialsConfigured: Boolean(config?.credentialsConfigured),
    audioDownloadEnabled: Boolean(config?.audioDownloadEnabled),
    allowHttpMediaTest: Boolean(config?.allowHttpMediaTest),
    downloadRole: "SUPER_ADMIN",
    maxDownloadsPerRun: config?.maxDownloadsPerRun || 10,
    autoCreateGenres: config?.autoCreateGenres !== false,
    genreReviewRequired: Boolean(config?.genreReviewRequired),
    productionLocked: true
  });
}

export function promoOnlyDownloadDecision({ config, actorRole = null, privilegedWorker = false, entitlementAccepted = false, alreadyImported = false } = {}) {
  if (!config?.enabled) return { allowed: false, reason: "PROMOONLY_DISABLED" };
  if (config.mode !== "AUDIO_TEST") return { allowed: false, reason: "PROMOONLY_AUDIO_TEST_REQUIRED" };
  if (!config.audioDownloadEnabled) return { allowed: false, reason: "PROMOONLY_AUDIO_DOWNLOAD_DISABLED" };
  if (actorRole !== "SUPER_ADMIN" && !privilegedWorker) return { allowed: false, reason: "PROMOONLY_SUPER_ADMIN_REQUIRED" };
  if (!entitlementAccepted) return { allowed: false, reason: "PROMOONLY_ENTITLEMENT_REQUIRED" };
  if (alreadyImported) return { allowed: false, reason: "PROMOONLY_ALREADY_IMPORTED" };
  return { allowed: true, reason: "PROMOONLY_AUDIO_TEST_ALLOWED" };
}

export function assertPromoOnlyDownloadAuthority(input) {
  const decision = promoOnlyDownloadDecision(input);
  if (!decision.allowed) {
    const error = new Error("Promo Only audio import is not authorised.");
    error.code = decision.reason;
    error.status = decision.reason === "PROMOONLY_SUPER_ADMIN_REQUIRED" ? 403 : 409;
    throw error;
  }
  return decision;
}

export function normalizePromoOnlyGenre(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function promoOnlyGenreSlug(value) {
  return normalizePromoOnlyGenre(value).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "provider-genre";
}

function normalizedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function dateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function positiveInteger(value, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function first(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function mapPromoOnlyTrack(input = {}, release = {}) {
  const source = input?.track || input?.data || input;
  const externalTrackId = normalizedText(first(source, ["trackid", "trackId", "id"]));
  const title = normalizedText(first(source, ["title", "track_title", "name"]));
  const artist = normalizedText(first(source, ["artist", "artist_name", "primary_artist"]));
  if (!externalTrackId || !title || !artist) {
    const error = new Error("Promo Only metadata is missing a track ID, title or artist.");
    error.code = "PROMOONLY_METADATA_INCOMPLETE";
    throw error;
  }
  const sourceGenre = normalizedText(first(source, ["genre", "genre_name", "category"]));
  const duration = first(source, ["duration", "duration_seconds", "length"]);
  const durationSeconds = typeof duration === "string" && /^\d{1,2}:\d{2}$/.test(duration)
    ? duration.split(":").reduce((minutes, part) => minutes * 60 + Number(part), 0)
    : positiveInteger(duration, 1, 86_400);
  const releaseDate = dateOrNull(first(source, ["release_date", "releaseDate"]) || first(release, ["release_date", "releaseDate"]));
  const releaseYear = positiveInteger(first(source, ["year", "release_year"]) || releaseDate?.getUTCFullYear(), 1877, 2200);
  const explicitRaw = first(source, ["explicit", "is_explicit"]);
  const isExplicit = explicitRaw === true || ["1", "true", "yes", "explicit", "x"].includes(String(explicitRaw || "").trim().toLowerCase());
  const contentWarningRaw = first(source, ["content_warning", "content_warn", "contentWarning"]);
  const contentWarning = contentWarningRaw === true || ["1", "true", "yes"].includes(String(contentWarningRaw || "").trim().toLowerCase()) ? "Content warning" : contentWarningRaw === false || ["0", "false", "no"].includes(String(contentWarningRaw || "").trim().toLowerCase()) ? (isExplicit ? "Explicit" : null) : normalizedText(contentWarningRaw) || (isExplicit ? "Explicit" : null);
  return Object.freeze({
    externalTrackId,
    externalRecordingId: normalizedText(first(source, ["recordingid", "recordingId", "isrc"])) || null,
    externalTitleId: normalizedText(first(source, ["titleid", "titleId"])) || null,
    externalReleaseId: normalizedText(first(source, ["releaseid", "releaseId"]) || first(release, ["releaseid", "releaseId", "id"])) || null,
    isrc: normalizedText(first(source, ["isrc"])) || null,
    title,
    artist,
    album: normalizedText(first(source, ["album", "release", "release_name"]) || first(release, ["title", "name"])) || null,
    label: normalizedText(first(source, ["label", "record_label"]) || first(release, ["label"])) || null,
    mixName: normalizedText(first(source, ["mix", "version", "mix_name"])) || null,
    sourceGenre: sourceGenre || null,
    bpm: positiveInteger(first(source, ["bpm", "tempo"]), 20, 300),
    durationSeconds,
    releaseDate,
    releaseYear,
    isExplicit,
    contentWarning,
    endType: normalizedText(first(source, ["end", "end_type"])) || null,
    mediaType: normalizedText(first(source, ["media_type", "file_type", "format"])) || null,
    sourceModifiedAt: (() => { const value = first(source, ["modified", "mod_time", "modified_at", "updated_at", "sourceModifiedAt"]); return Number.isFinite(Number(value)) && Number(value) > 1_000_000_000 ? dateOrNull(Number(value) * 1000) : dateOrNull(value); })(),
    providerMetadata: source
  });
}

export function promoOnlyFeedItemKey(item) {
  const stable = normalizedText(item?.guid || item?.trackId || item?.releaseId || item?.link);
  if (stable) return crypto.createHash("sha256").update(`stable:${stable}`).digest("hex");
  return crypto.createHash("sha256").update(JSON.stringify({
    title: normalizedText(item?.title).toLowerCase(),
    publishedAt: dateOrNull(item?.publishedAt)?.toISOString() || null,
    sourceUrl: normalizedText(item?.link) || null
  })).digest("hex");
}

export function promoOnlyPayloadHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function localName(nodeOrName) {
  const name = typeof nodeOrName === "string" ? nodeOrName : nodeOrName?.local || nodeOrName?.name || "";
  return name.split(":").pop().toLowerCase();
}

function fieldValue(raw, names) {
  for (const name of names) if (raw[name]) return normalizedText(raw[name]);
  return null;
}

export function parsePromoOnlyRss(xml, { maxBytes = PROMO_ONLY_DEFAULT_MAX_RSS_BYTES } = {}) {
  const body = String(xml || "");
  if (!body.trim()) throw Object.assign(new Error("Promo Only RSS returned an empty response."), { code: "PROMOONLY_RSS_EMPTY" });
  if (Buffer.byteLength(body, "utf8") > maxBytes) throw Object.assign(new Error("Promo Only RSS exceeded the configured response limit."), { code: "PROMOONLY_RSS_TOO_LARGE" });
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw Object.assign(new Error("Promo Only RSS contains a disallowed DTD or entity declaration."), { code: "PROMOONLY_RSS_UNSAFE_XML" });
  const items = [];
  let current = null;
  const stack = [];
  let text = "";
  let parseError = null;
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  parser.on("error", (error) => { parseError = error; });
  parser.on("doctype", () => { parseError = new Error("DTD declarations are not allowed."); });
  parser.on("opentag", (node) => {
    const name = localName(node);
    stack.push(name);
    text = "";
    if (["item", "entry"].includes(name)) current = { raw: {} };
    if (current && name === "link") {
      const href = Object.values(node.attributes || {}).find((attribute) => localName(attribute) === "href")?.value;
      if (href) current.raw.link = href;
    }
  });
  parser.on("text", (value) => { text += value; });
  parser.on("cdata", (value) => { text += value; });
  parser.on("closetag", (nameValue) => {
    const name = localName(nameValue);
    if (current && !["item", "entry"].includes(name)) {
      const value = normalizedText(text);
      if (value && !current.raw[name]) current.raw[name] = value;
    }
    if (current && ["item", "entry"].includes(name)) {
      const raw = current.raw;
      const item = {
        guid: fieldValue(raw, ["guid", "id"]),
        link: fieldValue(raw, ["link", "url"]),
        title: fieldValue(raw, ["title"]),
        publishedAt: dateOrNull(fieldValue(raw, ["pubdate", "published", "updated", "date"])),
        description: fieldValue(raw, ["description", "summary", "content"]),
        category: fieldValue(raw, ["category", "genre"]),
        trackId: fieldValue(raw, ["trackid", "track_id"]),
        releaseId: fieldValue(raw, ["releaseid", "release_id"]),
        raw
      };
      item.idempotencyKey = promoOnlyFeedItemKey(item);
      item.rawHash = promoOnlyPayloadHash(item.raw);
      items.push(item);
      current = null;
    }
    stack.pop();
    text = "";
  });
  try { parser.write(body).close(); } catch (error) { parseError ||= error; }
  if (parseError) throw Object.assign(new Error("Promo Only RSS could not be parsed safely."), { code: "PROMOONLY_RSS_INVALID_XML" });
  return items;
}

export function promoOnlyRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

export function promoOnlyRetryDelayMs(attempt, random = Math.random) {
  const number = Math.max(1, Math.min(6, Number(attempt) || 1));
  const base = Math.min(5 * 60_000, 1_000 * (2 ** (number - 1)));
  return Math.round(base * (0.8 + Math.max(0, Math.min(1, random())) * 0.4));
}
