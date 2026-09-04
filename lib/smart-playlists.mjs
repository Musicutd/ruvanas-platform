import { z } from "zod";
import { musicTrackEligibility } from "./media-library-pro.mjs";

export const SMART_PLAYLIST_FIELDS = Object.freeze([
  "GENRE", "ARTIST", "ALBUM", "RELEASE_YEAR", "EXPLICIT", "LIBRARY_TYPE"
]);
export const SMART_PLAYLIST_SORTS = Object.freeze([
  "ARTIST_TITLE", "RELEASE_YEAR_DESC", "RELEASE_YEAR_ASC", "RECENTLY_ADDED"
]);

const OPERATORS = Object.freeze({
  GENRE: ["IS", "IS_NOT"],
  ARTIST: ["IS", "IS_NOT", "CONTAINS"],
  ALBUM: ["IS", "IS_NOT", "CONTAINS"],
  RELEASE_YEAR: ["IS", "AT_LEAST", "AT_MOST"],
  EXPLICIT: ["IS"],
  LIBRARY_TYPE: ["IS"]
});

const ruleSchema = z.object({
  field: z.enum(SMART_PLAYLIST_FIELDS),
  operator: z.enum(["IS", "IS_NOT", "CONTAINS", "AT_LEAST", "AT_MOST"]),
  value: z.string().trim().min(1).max(120)
});

const playlistSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  maxTracks: z.coerce.number().int().min(1).max(1000).default(250),
  defaultWeight: z.coerce.number().int().min(1).max(1000).default(100),
  sort: z.enum(SMART_PLAYLIST_SORTS).default("ARTIST_TITLE"),
  rightsUse: z.enum(["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO"]).default("ONLINE_RADIO"),
  territory: z.string().trim().max(80).optional().nullable(),
  rules: z.array(ruleSchema).min(1).max(12)
});

export function canAuthorSmartPlaylist(role) {
  return ["OWNER", "MANAGER", "CONTENT_EDITOR"].includes(role);
}

export function canPublishSmartPlaylist(role) {
  return ["OWNER", "MANAGER"].includes(role);
}

export function smartPlaylistSlug(name) {
  const slug = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  if (!slug) throw new Error("Enter a playlist name that contains letters or numbers.");
  return slug;
}

function normalizeRule(rule, index) {
  const allowed = OPERATORS[rule.field] || [];
  if (!allowed.includes(rule.operator)) {
    throw new Error(`Rule ${index + 1} does not support that comparison.`);
  }
  let value = rule.value.trim();
  if (rule.field === "RELEASE_YEAR") {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 1877 || year > 2200) {
      throw new Error(`Rule ${index + 1} needs a valid release year.`);
    }
    value = String(year);
  }
  if (rule.field === "EXPLICIT") {
    value = value.toLowerCase();
    if (!["true", "false"].includes(value)) {
      throw new Error(`Rule ${index + 1} must choose explicit or clean.`);
    }
  }
  if (rule.field === "LIBRARY_TYPE") {
    value = value.toUpperCase();
    if (!["RUVANAS_CATALOGUE", "ORGANISATION_MUSIC"].includes(value)) {
      throw new Error(`Rule ${index + 1} needs a valid music library.`);
    }
  }
  return { field: rule.field, operator: rule.operator, value };
}

export function parseSmartPlaylistInput(input) {
  const parsed = playlistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Enter valid smart-playlist settings." };
  }
  try {
    const rules = parsed.data.rules.map(normalizeRule);
    const signatures = new Set();
    for (const rule of rules) {
      const signature = `${rule.field}:${rule.operator}:${rule.value.toLowerCase()}`;
      if (signatures.has(signature)) return { ok: false, error: "Remove the duplicated smart-playlist rule." };
      signatures.add(signature);
    }
    return {
      ok: true,
      data: {
        ...parsed.data,
        description: parsed.data.description || null,
        territory: parsed.data.territory || null,
        rules
      }
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function textFilter(operator, value) {
  if (operator === "CONTAINS") return { contains: value, mode: "insensitive" };
  return { equals: value, mode: "insensitive" };
}

function genreCondition(value) {
  return {
    mediaAsset: {
      genres: {
        some: {
          mediaGenre: {
            OR: [
              { name: { equals: value, mode: "insensitive" } },
              { slug: smartPlaylistSlug(value) }
            ]
          }
        }
      }
    }
  };
}

export function smartPlaylistRuleWhere(rule) {
  const normalized = normalizeRule(rule, 0);
  const { field, operator, value } = normalized;
  let condition;
  if (field === "GENRE") condition = genreCondition(value);
  if (field === "ARTIST") condition = { artist: textFilter(operator, value) };
  if (field === "ALBUM") condition = { album: textFilter(operator, value) };
  if (field === "RELEASE_YEAR") {
    const year = Number(value);
    condition = { releaseYear: operator === "AT_LEAST" ? { gte: year } : operator === "AT_MOST" ? { lte: year } : year };
  }
  if (field === "EXPLICIT") condition = { isExplicit: value === "true" };
  if (field === "LIBRARY_TYPE") condition = { mediaAsset: { libraryType: value } };
  return operator === "IS_NOT" ? { NOT: condition } : condition;
}

export function smartPlaylistTrackQuery(playlist) {
  const organisationId = playlist.organisationId;
  if (!organisationId) throw new Error("A smart playlist must be scoped to one organisation.");
  const rules = (playlist.rules || []).map((rule, index) => normalizeRule(rule, index));
  const orderBy = {
    ARTIST_TITLE: [{ artist: "asc" }, { title: "asc" }, { id: "asc" }],
    RELEASE_YEAR_DESC: [{ releaseYear: "desc" }, { artist: "asc" }, { title: "asc" }],
    RELEASE_YEAR_ASC: [{ releaseYear: "asc" }, { artist: "asc" }, { title: "asc" }],
    RECENTLY_ADDED: [{ createdAt: "desc" }, { id: "asc" }]
  }[playlist.sort || "ARTIST_TITLE"];
  return {
    where: {
      status: "READY",
      mediaAsset: {
        status: "READY",
        mediaType: "MUSIC",
        OR: [
          { libraryType: "RUVANAS_CATALOGUE", organisationId: null },
          { libraryType: "ORGANISATION_MUSIC", organisationId }
        ]
      },
      AND: rules.map(smartPlaylistRuleWhere)
    },
    orderBy,
    take: Math.min(1000, Math.max(1, Number(playlist.maxTracks) || 250))
  };
}

function trackGenres(track) {
  return (track?.mediaAsset?.genres || []).map((entry) => entry.mediaGenre?.name || entry.mediaGenre?.slug || "").filter(Boolean);
}

function equals(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

export function smartPlaylistRuleMatches(track, rule) {
  const normalized = normalizeRule(rule, 0);
  const { field, operator, value } = normalized;
  let matched = false;
  if (field === "GENRE") matched = trackGenres(track).some((genre) => equals(genre, value) || smartPlaylistSlug(genre) === smartPlaylistSlug(value));
  if (field === "ARTIST") matched = operator === "CONTAINS" ? String(track?.artist || "").toLowerCase().includes(value.toLowerCase()) : equals(track?.artist, value);
  if (field === "ALBUM") matched = operator === "CONTAINS" ? String(track?.album || "").toLowerCase().includes(value.toLowerCase()) : equals(track?.album, value);
  if (field === "RELEASE_YEAR") {
    const actual = Number(track?.releaseYear);
    const expected = Number(value);
    matched = Number.isInteger(actual) && (operator === "AT_LEAST" ? actual >= expected : operator === "AT_MOST" ? actual <= expected : actual === expected);
  }
  if (field === "EXPLICIT") matched = Boolean(track?.isExplicit) === (value === "true");
  if (field === "LIBRARY_TYPE") matched = track?.mediaAsset?.libraryType === value;
  return operator === "IS_NOT" ? !matched : matched;
}

export function describeSmartPlaylistRule(rule) {
  const labels = { GENRE: "Genre", ARTIST: "Artist", ALBUM: "Album", RELEASE_YEAR: "Release year", EXPLICIT: "Content", LIBRARY_TYPE: "Library" };
  const operators = { IS: "is", IS_NOT: "is not", CONTAINS: "contains", AT_LEAST: "is at least", AT_MOST: "is at most" };
  const value = rule.field === "EXPLICIT" ? (String(rule.value) === "true" ? "explicit" : "clean") : String(rule.value).replaceAll("_", " ").toLowerCase();
  return `${labels[rule.field] || rule.field} ${operators[rule.operator] || rule.operator} ${value}`;
}

export function evaluateSmartPlaylistCandidates(tracks, playlist, instant = new Date()) {
  const rules = playlist.rules || [];
  const selected = [];
  for (const track of tracks || []) {
    if (!rules.every((rule) => smartPlaylistRuleMatches(track, rule))) continue;
    const eligibility = musicTrackEligibility(track, {
      organisationId: playlist.organisationId,
      requiredUse: playlist.rightsUse || "ONLINE_RADIO",
      territory: playlist.territory || null,
      instant
    });
    if (!eligibility.playable) continue;
    selected.push({
      track,
      eligibilityReason: eligibility.reason,
      explanations: rules.map(describeSmartPlaylistRule)
    });
  }
  return selected.slice(0, Math.min(1000, Math.max(1, Number(playlist.maxTracks) || 250)));
}
