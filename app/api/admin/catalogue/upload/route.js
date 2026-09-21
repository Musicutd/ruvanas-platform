import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { MAX_CATALOGUE_FILE_SIZE_BYTES, parseCatalogueMetadata } from "@/lib/catalogue-upload.mjs";
import { CatalogueTrackStorageError, storeCatalogueTrack } from "@/lib/catalogue-track-storage";
import { securityLog } from "@/lib/security-log";
import { parseNewCatalogueGenreNames } from "@/lib/catalogue-single-metadata.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function superAdminOnly(access) {
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only a Ruvanas Super Admin can upload catalogue music." }, { status: 403 });
  }
  return null;
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    const denied = superAdminOnly(access);
    if (denied) return denied;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a music file before uploading." }, { status: 400 });
    }
    if (file.size > MAX_CATALOGUE_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "The music file exceeds the 50 MB upload limit." }, { status: 413 });
    }

    const metadata = parseCatalogueMetadata({
      title: formData.get("title"),
      artist: formData.get("artist"),
      album: formData.get("album"),
      mixName: formData.get("mixName"),
      bpm: formData.get("bpm"),
      releaseYear: formData.get("releaseYear"),
      durationSeconds: formData.get("durationSeconds"),
      isExplicit: formData.get("isExplicit"),
      rightsHolder: formData.get("rightsHolder"),
      rightsReference: formData.get("rightsReference"),
      permittedTerritories: formData.get("permittedTerritories"),
      licenceExpiresAt: formData.get("licenceExpiresAt"),
      rightsConfirmed: formData.get("rightsConfirmed"),
      publishNow: formData.get("publishNow"),
      licensedCatalogue: formData.get("licensedCatalogue"),
      permittedUses: formData.getAll("permittedUses").map(String),
      genreIds: formData.getAll("genreIds").map(String)
    });
    if (!metadata.ok) return NextResponse.json({ error: metadata.error }, { status: 400 });

    const newGenres = parseNewCatalogueGenreNames(formData.get("newGenres"), metadata.data.genreIds.length);
    if (!newGenres.ok) return NextResponse.json({ error: newGenres.error }, { status: 400 });
    if (newGenres.names.length) metadata.data.status = "DRAFT";

    const genres = metadata.data.genreIds.length
      ? await prisma.mediaGenre.findMany({ where: { id: { in: metadata.data.genreIds }, active: true, providerReviewStatus: "APPROVED" }, select: { id: true } })
      : [];
    if (genres.length !== metadata.data.genreIds.length) {
      return NextResponse.json({ error: "One or more selected genres are unavailable." }, { status: 400 });
    }

    const stored = await storeCatalogueTrack({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      claimedType: file.type,
      metadata: metadata.data,
      actorUserId: access.user.id,
      newGenreNames: newGenres.names
    });
    securityLog("info", "CATALOGUE_UPLOAD_SUCCEEDED", request, {
      actorUserId: access.user.id,
      trackId: stored.track.id,
      mediaAssetId: stored.mediaAsset.id,
      status: stored.track.status
    });
    return NextResponse.json({
      ok: true,
      track: { id: stored.track.id, title: stored.track.title, artist: stored.track.artist, status: stored.track.status }
    }, { status: 201 });
  } catch (error) {
    const genreUnavailable = error?.code === "CATALOGUE_GENRE_UNAVAILABLE";
    const status = error instanceof CatalogueTrackStorageError ? error.status : genreUnavailable ? 400 : 500;
    const message = error instanceof CatalogueTrackStorageError || genreUnavailable
      ? error.message
      : "The catalogue track could not be uploaded. Please try again.";
    securityLog(status >= 500 ? "error" : "warn", "CATALOGUE_UPLOAD_ERROR", request, {
      code: error?.code || "CATALOGUE_UPLOAD_ERROR",
      error: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.json({ error: message }, { status });
  }
}
