import crypto from "node:crypto";
import { z } from "zod";
import { catalogueTerritoryAllows, limitCatalogueTerritories } from "./catalogue-territories.mjs";

export const DISTRIBUTOR_CONTRACT_VERSION = "ruvanas-distributor-v1";
export const DISTRIBUTOR_CATALOGUE_LEVELS = Object.freeze(["FOCUSED", "PROFESSIONAL", "PREMIUM"]);
export const DISTRIBUTOR_RIGHTS_USES = Object.freeze([
  "RETAIL_RADIO",
  "SCHOOL_RADIO",
  "ONLINE_RADIO",
  "HEALTH_RADIO",
  "FAITH_RADIO",
  "ORGANISATIONS_RADIO",
  "CORRECTIONS_RADIO"
]);
export const DISTRIBUTOR_DELIVERY_MODES = Object.freeze(["DOWNLOAD", "PROTECTED_STREAM"]);

const levelOrder = Object.freeze({ NONE: 0, FOCUSED: 1, PROFESSIONAL: 2, PREMIUM: 3 });
const safeId = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const optionalText = (max = 300) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);
const stringList = (item, maximum = 250) => z.array(item).max(maximum).default([]).transform((items) => [...new Set(items)]);
const territory = z.string().trim().toUpperCase().regex(/^(?:[A-Z]{2}|EUROPE|WORLDWIDE)$/);
const rightsUse = z.enum(DISTRIBUTOR_RIGHTS_USES);
const catalogueLevel = z.enum(DISTRIBUTOR_CATALOGUE_LEVELS);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a real ISO date.");
const optionalDate = isoDate.optional().nullable().transform((value) => value ? new Date(`${value}T00:00:00.000Z`) : null);

function privateAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
}

export function validateDistributorEndpoint(value, label = "Distributor endpoint") {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} cannot contain credentials.`);
  if (url.port && url.port !== "443") throw new Error(`${label} must use the standard HTTPS port.`);
  if (privateAddress(url.hostname)) throw new Error(`${label} cannot use a private or local address.`);
  url.hash = "";
  return url.toString();
}

export function normalizeDistributorPath(value, { optional = false } = {}) {
  const path = String(value || "").trim();
  if (!path && optional) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("#") || path.length > 500) {
    throw new Error("Distributor API paths must be relative paths beginning with one slash.");
  }
  return path;
}

export function distributorApiUrl(connection, path, query = {}) {
  const base = new URL(validateDistributorEndpoint(connection.apiBaseUrl, "Distributor API base URL"));
  const resolved = new URL(normalizeDistributorPath(path), base);
  if (resolved.origin !== base.origin) throw new Error("Distributor API paths cannot change the configured origin.");
  for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined && value !== "") resolved.searchParams.set(key, String(value));
  return resolved.toString();
}

const connectionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  providerKey: z.string().trim().toUpperCase().min(2).max(80).regex(/^[A-Z0-9._-]+$/),
  apiBaseUrl: z.string().trim().max(2000),
  tokenUrl: z.string().trim().max(2000),
  cataloguePath: z.string().trim().max(500).default("/v1/catalogue"),
  usageReportPath: z.string().trim().max(500).optional().nullable(),
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().min(12).max(4000),
  oauthScopes: stringList(z.string().trim().min(1).max(120), 30),
  defaultMinimumCatalogueLevel: catalogueLevel.default("FOCUSED"),
  defaultPermittedTerritories: stringList(territory),
  defaultPermittedUses: stringList(rightsUse, DISTRIBUTOR_RIGHTS_USES.length),
  syncIntervalMinutes: z.coerce.number().int().min(15).max(10080).default(60)
}).strict();

export function parseDistributorConnection(input) {
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Enter valid distributor connection details." };
  try {
    const data = parsed.data;
    if (!data.defaultPermittedTerritories.length || (data.defaultPermittedTerritories.includes("WORLDWIDE") && data.defaultPermittedTerritories.length > 1)) {
      return { ok: false, error: "Select at least one contract-approved territory; do not combine WORLDWIDE with restricted territories." };
    }
    return { ok: true, data: {
      ...data,
      apiBaseUrl: validateDistributorEndpoint(data.apiBaseUrl, "Distributor API base URL"),
      tokenUrl: validateDistributorEndpoint(data.tokenUrl, "OAuth token URL"),
      cataloguePath: normalizeDistributorPath(data.cataloguePath),
      usageReportPath: normalizeDistributorPath(data.usageReportPath, { optional: true })
    } };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function normalizeIsrc(value) {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized)) throw new Error("ISRC must contain a valid 12-character recording code.");
  return normalized;
}

const releaseSchema = z.object({
  id: safeId,
  title: z.string().trim().min(1).max(300),
  label: optionalText(200),
  releaseDate: optionalDate,
  status: z.enum(["ACTIVE", "TAKEN_DOWN", "UNAVAILABLE"]).default("ACTIVE")
}).strict();

const collectionSchema = z.object({
  id: safeId,
  name: z.string().trim().min(1).max(200),
  minimumCatalogueLevel: catalogueLevel.optional(),
  permittedTerritories: stringList(territory),
  permittedUses: stringList(rightsUse, DISTRIBUTOR_RIGHTS_USES.length),
  active: z.boolean().default(true)
}).strict();

const trackSchema = z.object({
  id: safeId,
  recordingId: safeId.optional().nullable(),
  releaseId: safeId.optional().nullable(),
  collectionIds: stringList(safeId),
  isrc: z.string().trim().max(32).optional().nullable(),
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().min(1).max(300),
  album: optionalText(300),
  label: optionalText(200),
  genres: stringList(z.string().trim().min(1).max(80), 24),
  explicit: z.boolean().default(false),
  delivery: z.object({
    mode: z.enum(DISTRIBUTOR_DELIVERY_MODES),
    url: z.string().trim().max(4000).optional().nullable(),
    checksumSha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/).optional().nullable(),
    mimeType: z.string().trim().max(120).optional().nullable(),
    sizeBytes: z.coerce.bigint().positive().optional().nullable()
  }).strict(),
  minimumCatalogueLevel: catalogueLevel.optional(),
  permittedTerritories: stringList(territory),
  permittedUses: stringList(rightsUse, DISTRIBUTOR_RIGHTS_USES.length),
  licenceStartsAt: optionalDate,
  licenceExpiresAt: optionalDate,
  rightsHolder: z.string().trim().min(1).max(300),
  rightsReference: z.string().trim().min(1).max(500),
  status: z.enum(["ACTIVE", "TAKEN_DOWN", "UNAVAILABLE"]).default("ACTIVE"),
  takedownReason: optionalText(500)
}).strict().superRefine((track, context) => {
  if (!track.delivery.url) context.addIssue({ code: z.ZodIssueCode.custom, path: ["delivery", "url"], message: "A protected delivery URL is required." });
  if (track.licenceStartsAt && track.licenceExpiresAt && track.licenceStartsAt > track.licenceExpiresAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["licenceExpiresAt"], message: "The licence expiry cannot be before its start." });
  }
});

const cataloguePageSchema = z.object({
  cursor: z.string().trim().max(1000).optional().nullable(),
  hasMore: z.boolean().default(false),
  releases: z.array(releaseSchema).max(1000).default([]),
  collections: z.array(collectionSchema).max(1000).default([]),
  tracks: z.array(trackSchema).max(2000).default([])
}).strict();

function uniqueById(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`The distributor response contains a duplicate ${label} id: ${item.id}.`);
    ids.add(item.id);
  }
}

function defaults(list, fallback) {
  return list.length ? list : [...(fallback || [])];
}

function leastRestrictedCatalogueLevel(levels, fallback) {
  const available = levels.filter((level) => Object.hasOwn(levelOrder, level));
  return available.length
    ? available.sort((left, right) => levelOrder[left] - levelOrder[right])[0]
    : fallback;
}

export function parseDistributorCataloguePage(input, connection = {}) {
  const parsed = cataloguePageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "The distributor returned invalid catalogue data." };
  try {
    uniqueById(parsed.data.releases, "release");
    uniqueById(parsed.data.collections, "collection");
    uniqueById(parsed.data.tracks, "track");
    const releases = parsed.data.releases.map((item) => withMetadataChecksum(item));
    const releaseById = new Map(releases.map((item) => [item.id, item]));
    const collections = parsed.data.collections.map((item) => withMetadataChecksum({
      ...item,
      minimumCatalogueLevel: item.minimumCatalogueLevel || connection.defaultMinimumCatalogueLevel || "FOCUSED",
      permittedTerritories: limitCatalogueTerritories(item.permittedTerritories, connection.defaultPermittedTerritories),
      permittedUses: defaults(item.permittedUses, connection.defaultPermittedUses)
    }));
    const collectionById = new Map(collections.map((item) => [item.id, item]));
    const tracks = parsed.data.tracks.map((item) => {
      const sourceUrl = validateDistributorEndpoint(item.delivery.url, "Track delivery URL");
      const assignedCollections = item.collectionIds.map((id) => collectionById.get(id)).filter((entry) => entry?.active);
      const collectionTerritories = [...new Set(assignedCollections.flatMap((entry) => entry.permittedTerritories))];
      const collectionUses = [...new Set(assignedCollections.flatMap((entry) => entry.permittedUses))];
      const release = item.releaseId ? releaseById.get(item.releaseId) : null;
      const releaseTakenDown = release?.status === "TAKEN_DOWN";
      return withMetadataChecksum({
        ...item,
        isrc: normalizeIsrc(item.isrc),
        minimumCatalogueLevel: item.minimumCatalogueLevel || leastRestrictedCatalogueLevel(assignedCollections.map((entry) => entry.minimumCatalogueLevel), connection.defaultMinimumCatalogueLevel || "FOCUSED"),
        permittedTerritories: item.permittedTerritories.length
          ? limitCatalogueTerritories(item.permittedTerritories, connection.defaultPermittedTerritories)
          : assignedCollections.length ? collectionTerritories : limitCatalogueTerritories([], connection.defaultPermittedTerritories),
        permittedUses: defaults(item.permittedUses, defaults(collectionUses, connection.defaultPermittedUses)),
        status: releaseTakenDown ? "TAKEN_DOWN" : item.status,
        takedownReason: releaseTakenDown ? "Distributor release takedown" : item.takedownReason,
        delivery: { ...item.delivery, url: sourceUrl }
      });
    });
    return { ok: true, data: { ...parsed.data, releases, collections, tracks } };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function canonicalize(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function distributorChecksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function withMetadataChecksum(value) {
  return Object.freeze({ ...value, metadataChecksum: distributorChecksum(value) });
}

export function distributorReconciliationAction(previous, current) {
  if (!previous) return "CREATED";
  if (previous.status !== "TAKEN_DOWN" && current.status === "TAKEN_DOWN") return "TAKEN_DOWN";
  if (previous.status === "ACTIVE" && current.status === "UNAVAILABLE") return "UNAVAILABLE";
  if (previous.status !== "ACTIVE" && current.status === "ACTIVE") return "RESTORED";
  if (previous.metadataChecksum === current.metadataChecksum) return "UNCHANGED";
  const rights = ["minimumCatalogueLevel", "permittedTerritories", "permittedUses", "licenceStartsAt", "licenceExpiresAt", "rightsHolder", "rightsReference"];
  if (rights.some((key) => distributorChecksum(previous[key] ?? null) !== distributorChecksum(current[key] ?? null))) return "RIGHTS_CHANGED";
  return "UPDATED";
}

export function distributorTrackDecision(track, { catalogueLevel: subscriberLevel, territory: requestedTerritory, rightsUse: requestedUse, instant = new Date() } = {}) {
  if (!track || track.status !== "ACTIVE") return { playable: false, reason: "DISTRIBUTOR_TRACK_INACTIVE" };
  if ((levelOrder[subscriberLevel] ?? 0) < (levelOrder[track.minimumCatalogueLevel] ?? Number.POSITIVE_INFINITY)) return { playable: false, reason: "CATALOGUE_TIER_REQUIRED" };
  const day = new Date(instant).toISOString().slice(0, 10);
  if (track.licenceStartsAt && day < new Date(track.licenceStartsAt).toISOString().slice(0, 10)) return { playable: false, reason: "RIGHTS_WINDOW_INACTIVE" };
  if (track.licenceExpiresAt && day > new Date(track.licenceExpiresAt).toISOString().slice(0, 10)) return { playable: false, reason: "RIGHTS_WINDOW_INACTIVE" };
  if (!catalogueTerritoryAllows(track.permittedTerritories, requestedTerritory)) return { playable: false, reason: requestedTerritory ? "TERRITORY_NOT_PERMITTED" : "TERRITORY_REQUIRED" };
  if (requestedUse && !(track.permittedUses || []).includes(requestedUse)) return { playable: false, reason: "USE_NOT_PERMITTED" };
  return { playable: true, reason: "DISTRIBUTOR_CATALOGUE" };
}

export function distributorDuplicateKey(track) {
  if (track?.sourceChecksumSha256 || track?.delivery?.checksumSha256) return `SHA256:${track.sourceChecksumSha256 || track.delivery.checksumSha256}`;
  if (track?.isrc) return `ISRC:${normalizeIsrc(track.isrc)}`;
  return null;
}

export function distributorRetryDelayMs(attempt) {
  const number = Math.max(1, Math.min(8, Number(attempt) || 1));
  return Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** (number - 1)));
}

export function safeDistributorErrorCode(error, fallback = "DISTRIBUTOR_REQUEST_FAILED") {
  return String(error?.code || fallback).replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 80);
}

export function buildDistributorUsageReport({ connection, periodFrom, periodUntil, events = [], mappings = new Map(), generatedAt = new Date() }) {
  const from = new Date(periodFrom);
  const until = new Date(periodUntil);
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || from >= until) throw new Error("Choose a valid usage-report period.");
  const rows = events.map((event) => {
    const mapping = mappings.get(event.trackId);
    if (!mapping) throw new Error("Every reported event must map to a distributor track.");
    return {
      eventId: event.id,
      distributorTrackId: mapping.externalTrackId,
      isrc: mapping.isrc || null,
      occurredAt: new Date(event.occurredAt).toISOString(),
      durationSeconds: event.durationSeconds,
      territory: event.territoryCode,
      use: event.rightsUse
    };
  }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  const report = {
    contractVersion: DISTRIBUTOR_CONTRACT_VERSION,
    providerKey: connection.providerKey,
    periodFrom: from.toISOString(),
    periodUntil: until.toISOString(),
    generatedAt: new Date(generatedAt).toISOString(),
    rows
  };
  const payloadSha256 = distributorChecksum(report);
  return { report, payloadSha256, idempotencyKey: `distributor-usage:${connection.id}:${from.toISOString()}:${until.toISOString()}` };
}
