import { z } from "zod";
import { isCatalogueLicenceCurrent } from "./catalogue-upload.mjs";

export const MAX_ORGANISATION_MUSIC_FILE_SIZE_BYTES = 100 * 1024 * 1024;
export const MUSIC_RIGHTS_USES = Object.freeze([
  "RETAIL_RADIO",
  "SCHOOL_RADIO",
  "ONLINE_RADIO"
]);

const optionalInteger = (minimum, maximum) =>
  z.preprocess(
    (value) => {
      const normalized = String(value ?? "").trim();
      return normalized ? Number(normalized) : null;
    },
    z.number().int().min(minimum).max(maximum).nullable()
  );

const optionalDate = z.preprocess(
  (value) => String(value ?? "").trim() || null,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
);

const checkbox = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean()
);

const organisationMusicSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200),
  album: z.string().trim().max(200).optional().nullable(),
  releaseYear: optionalInteger(1877, 2200),
  durationSeconds: optionalInteger(1, 86400),
  isExplicit: checkbox,
  rightsHolder: z.string().trim().min(1).max(200),
  rightsReference: z.string().trim().min(1).max(500),
  rightsBasis: z.enum(["OWNED_MASTER", "DIRECT_LICENCE", "DISTRIBUTOR_LICENCE", "OTHER"]),
  permittedTerritories: z.string().trim().min(1).max(500),
  permittedUses: z.array(z.enum(MUSIC_RIGHTS_USES)).min(1),
  licenceStartsAt: optionalDate,
  licenceExpiresAt: optionalDate,
  rightsConfirmed: checkbox.refine(Boolean, {
    message: "Confirm that your organisation is authorised to store and use this recording."
  })
});

function realDate(value, label) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Enter a real ${label} date.`);
  }
  return date;
}

export function parseOrganisationMusicMetadata(input) {
  const parsed = organisationMusicSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || "Enter complete music and rights details."
    };
  }

  try {
    const licenceStartsAt = realDate(parsed.data.licenceStartsAt, "licence start");
    const licenceExpiresAt = realDate(parsed.data.licenceExpiresAt, "licence expiry");
    if (licenceStartsAt && licenceExpiresAt && licenceStartsAt > licenceExpiresAt) {
      return { ok: false, error: "The licence expiry must be on or after its start date." };
    }

    return {
      ok: true,
      data: {
        ...parsed.data,
        album: parsed.data.album || null,
        permittedUses: [...new Set(parsed.data.permittedUses)],
        licenceStartsAt,
        licenceExpiresAt
      }
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function organisationMusicStorageKey(organisationId, checksum, extension) {
  if (!/^[a-z0-9]+$/i.test(organisationId) || !/^[0-9a-f]{64}$/.test(checksum) || !/^[a-z0-9]+$/.test(extension)) {
    throw new Error("Invalid organisation music storage identity.");
  }
  return `organisations/${organisationId}/music/${checksum}.${extension}`;
}

export function musicRightsWindowIsCurrent(track, instant = new Date()) {
  const current = new Date(instant);
  if (Number.isNaN(current.getTime())) return false;
  const day = current.toISOString().slice(0, 10);
  if (track?.licenceStartsAt && day < new Date(track.licenceStartsAt).toISOString().slice(0, 10)) return false;
  return isCatalogueLicenceCurrent(track?.licenceExpiresAt, current);
}

function territoryAllowed(permittedTerritories, territory) {
  if (!territory) return true;
  const values = String(permittedTerritories || "")
    .split(/[,;\n]/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (values.some((value) => ["WORLDWIDE", "GLOBAL", "ALL", "*"].includes(value))) return true;
  return values.includes(String(territory).trim().toUpperCase());
}

export function musicTrackEligibility(track, {
  organisationId,
  requiredUse = null,
  territory = null,
  instant = new Date()
} = {}) {
  const asset = track?.mediaAsset;
  if (!track || track.status !== "READY") return { playable: false, reason: "TRACK_NOT_READY" };
  if (!asset || asset.status !== "READY" || asset.mediaType !== "MUSIC") {
    return { playable: false, reason: "MEDIA_NOT_READY" };
  }
  if (!musicRightsWindowIsCurrent(track, instant)) return { playable: false, reason: "RIGHTS_WINDOW_INACTIVE" };

  if (asset.libraryType === "RUVANAS_CATALOGUE") {
    if (asset.organisationId !== null) return { playable: false, reason: "CATALOGUE_OWNERSHIP_INVALID" };
    // Catalogue publication is already restricted to the Super Admin routes.
    // Preserve that established approval contract for legacy and current rows.
    return { playable: true, reason: "RUVANAS_CATALOGUE" };
  }

  if (asset.libraryType !== "ORGANISATION_MUSIC" || !organisationId || asset.organisationId !== organisationId) {
    return { playable: false, reason: "ORGANISATION_OWNERSHIP_INVALID" };
  }
  if (
    track.rightsReviewStatus !== "APPROVED" ||
    !track.rightsConfirmedAt ||
    !track.rightsHolder ||
    !track.rightsReference ||
    !track.rightsBasis ||
    !territoryAllowed(track.permittedTerritories, territory)
  ) {
    return { playable: false, reason: "RIGHTS_NOT_APPROVED" };
  }

  const uses = Array.isArray(track.permittedUses) ? track.permittedUses : [];
  if (requiredUse) {
    if (!uses.includes(requiredUse)) return { playable: false, reason: "USE_NOT_PERMITTED" };
  } else if (!MUSIC_RIGHTS_USES.every((use) => uses.includes(use))) {
    // Until a caller supplies a product context, only universally cleared
    // organisation music may enter the shared Retail/School/Online resolver.
    return { playable: false, reason: "PRODUCT_CONTEXT_REQUIRED" };
  }

  return { playable: true, reason: "ORGANISATION_MUSIC" };
}

export function prepareMusicRightsSubmission(track) {
  if (track?.status !== "DRAFT" || !["DRAFT", "REJECTED"].includes(track?.rightsReviewStatus)) {
    throw new Error("Only draft music can be submitted for rights review.");
  }
  if (!track?.rightsConfirmedAt || !track?.rightsHolder || !track?.rightsReference || !track?.rightsBasis) {
    throw new Error("Complete and confirm the rights declaration before submitting.");
  }
  if (!Array.isArray(track.permittedUses) || track.permittedUses.length === 0) {
    throw new Error("Choose at least one permitted Ruvanas service.");
  }
  return { rightsReviewStatus: "IN_REVIEW", rightsReviewNotes: null };
}
