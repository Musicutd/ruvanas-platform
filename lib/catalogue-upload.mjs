import { z } from "zod";

export const MAX_CATALOGUE_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_CATALOGUE_GENRES = 10;

const optionalInteger = (minimum, maximum) =>
  z.preprocess(
    (value) => {
      const normalized = String(value ?? "").trim();
      return normalized ? Number(normalized) : null;
    },
    z.number().int().min(minimum).max(maximum).nullable()
  );

const optionalDate = z.preprocess(
  (value) => {
    const normalized = String(value ?? "").trim();
    return normalized || null;
  },
  z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Enter a real licence expiry date.")
    .nullable()
);

const checkbox = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean()
);

const catalogueMetadataSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200),
  album: z.string().trim().max(200).optional().nullable(),
  releaseYear: optionalInteger(1877, 2200),
  durationSeconds: optionalInteger(1, 86400),
  isExplicit: checkbox,
  rightsHolder: z.string().trim().min(1).max(200),
  rightsReference: z.string().trim().min(1).max(500),
  permittedTerritories: z.string().trim().min(1).max(500),
  licenceExpiresAt: optionalDate,
  rightsConfirmed: checkbox.refine(Boolean, {
    message: "Confirm that Ruvanas is authorised to store and use this track."
  }),
  publishNow: checkbox,
  genreIds: z.array(z.string().cuid()).max(MAX_CATALOGUE_GENRES)
});

export function parseCatalogueMetadata(input) {
  const parsed = catalogueMetadataSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ||
        "Enter valid track metadata and confirm the music rights."
    };
  }

  const uniqueGenreIds = [...new Set(parsed.data.genreIds)];

  if (uniqueGenreIds.length !== parsed.data.genreIds.length) {
    return { ok: false, error: "The same genre cannot be selected twice." };
  }

  return {
    ok: true,
    data: {
      ...parsed.data,
      album: parsed.data.album || null,
      genreIds: uniqueGenreIds,
      licenceExpiresAt: parsed.data.licenceExpiresAt
        ? new Date(`${parsed.data.licenceExpiresAt}T00:00:00.000Z`)
        : null,
      status: parsed.data.publishNow ? "READY" : "DRAFT"
    }
  };
}

export function catalogueStorageKey(checksum, extension) {
  if (!/^[0-9a-f]{64}$/.test(checksum) || !/^[a-z0-9]+$/.test(extension)) {
    throw new Error("Invalid catalogue storage identity.");
  }

  return `catalogue/music/${checksum}.${extension}`;
}

export function isCatalogueLicenceCurrent(licenceExpiresAt, instant = new Date()) {
  if (!licenceExpiresAt) return true;

  const expiry = new Date(licenceExpiresAt);
  const current = new Date(instant);

  if (Number.isNaN(expiry.getTime()) || Number.isNaN(current.getTime())) {
    return false;
  }

  return current.toISOString().slice(0, 10) <= expiry.toISOString().slice(0, 10);
}

