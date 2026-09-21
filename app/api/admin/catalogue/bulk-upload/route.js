import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  CatalogueBulkImportError,
  extractCatalogueArchive,
  matchManifestRowsToAudio,
  metadataForBulkRow,
  parseCatalogueBatchSettings,
  parseCatalogueManifest
} from "@/lib/catalogue-bulk-import.mjs";
import {
  CatalogueTrackStorageError,
  findExistingCatalogueChecksums,
  inspectCatalogueAudio,
  storeCatalogueTrack
} from "@/lib/catalogue-track-storage";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function superAdminOnly(access) {
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only a Ruvanas Super Admin can bulk import catalogue music." }, { status: 403 });
  }
  return null;
}

function rowResponse(row) {
  return {
    sheetRow: row.sheetRow,
    artist: row.artist,
    title: row.title,
    mixName: row.mixName,
    bpm: row.bpm,
    durationSeconds: row.durationSeconds,
    genreSource: row.genreSource,
    genres: row.genreNames,
    isExplicit: row.isExplicit,
    fileName: row.file?.baseName || null,
    notes: row.notes,
    errors: row.errors
  };
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    const denied = superAdminOnly(access);
    if (denied) return denied;

    const formData = await request.formData();
    const archive = formData.get("archive");
    const manifest = formData.get("manifest");
    const mode = String(formData.get("mode") || "validate");
    if (!archive || !(archive instanceof File) || archive.size === 0) {
      return NextResponse.json({ error: "Choose the ZIP file containing the music." }, { status: 400 });
    }
    if (!manifest || !(manifest instanceof File) || manifest.size === 0) {
      return NextResponse.json({ error: "Choose the CSV or XLSX catalogue spreadsheet." }, { status: 400 });
    }
    if (!['validate', 'import'].includes(mode)) {
      return NextResponse.json({ error: "Choose whether to check or import the batch." }, { status: 400 });
    }

    const settings = parseCatalogueBatchSettings({
      rightsHolder: formData.get("rightsHolder"),
      rightsReference: formData.get("rightsReference"),
      permittedTerritories: formData.get("permittedTerritories"),
      licenceExpiresAt: formData.get("licenceExpiresAt"),
      rightsConfirmed: formData.get("rightsConfirmed"),
      publishNow: formData.get("publishNow"),
      licensedCatalogue: formData.get("licensedCatalogue"),
      permittedUses: formData.getAll("permittedUses").map(String)
    });
    if (!settings.ok) return NextResponse.json({ error: settings.error }, { status: 400 });

    const genres = await prisma.mediaGenre.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" }
    });
    const [manifestRows, audioFiles] = await Promise.all([
      parseCatalogueManifest({ buffer: Buffer.from(await manifest.arrayBuffer()), fileName: manifest.name, genres }),
      extractCatalogueArchive(Buffer.from(await archive.arrayBuffer()))
    ]);
    const rows = matchManifestRowsToAudio(manifestRows, audioFiles);
    const inspected = [];
    for (const row of rows) {
      if (!row.file || row.errors.length) { inspected.push(null); continue; }
      try {
        const audio = inspectCatalogueAudio({ buffer: row.file.buffer, fileName: row.file.baseName });
        inspected.push(audio);
      } catch (error) {
        row.errors.push(error instanceof Error ? error.message : "The audio file is invalid.");
        inspected.push(null);
      }
      const metadata = metadataForBulkRow(row, settings.data);
      if (!metadata.ok) row.errors.push(metadata.error);
      else row.metadata = metadata.data;
    }

    const firstChecksumRow = new Map();
    for (let index = 0; index < inspected.length; index += 1) {
      const audio = inspected[index];
      if (!audio) continue;
      if (firstChecksumRow.has(audio.storageKey)) {
        rows[index].errors.push(`This audio is identical to spreadsheet row ${firstChecksumRow.get(audio.storageKey)}.`);
      } else firstChecksumRow.set(audio.storageKey, rows[index].sheetRow);
    }
    const existing = await findExistingCatalogueChecksums(inspected.filter(Boolean));
    for (let index = 0; index < inspected.length; index += 1) {
      if (inspected[index] && existing.has(inspected[index].storageKey)) rows[index].errors.push("This audio already exists in the Ruvanas catalogue.");
    }

    const usedFileNames = new Set(rows.map((row) => row.file?.fileName).filter(Boolean));
    const unmatchedFiles = audioFiles.filter((file) => !usedFileNames.has(file.fileName)).map((file) => file.baseName);
    const invalidRows = rows.filter((row) => row.errors.length).length;
    const preview = {
      ready: invalidRows === 0,
      summary: { spreadsheetRows: rows.length, matchedTracks: rows.length - invalidRows, invalidRows, audioFiles: audioFiles.length },
      unmatchedFiles,
      rows: rows.map(rowResponse)
    };
    if (mode === "validate") return NextResponse.json({ ok: true, preview });
    if (!preview.ready) {
      return NextResponse.json({ error: "Fix the highlighted spreadsheet or ZIP matches before importing.", preview }, { status: 400 });
    }

    const batchId = crypto.randomUUID();
    const imported = [];
    const failures = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      try {
        const stored = await storeCatalogueTrack({
          buffer: row.file.buffer,
          fileName: row.file.baseName,
          metadata: row.metadata,
          actorUserId: access.user.id,
          inspected: inspected[index],
          auditContext: { bulkImportId: batchId, spreadsheetRow: row.sheetRow, manifestName: manifest.name, archiveName: archive.name }
        });
        imported.push({ sheetRow: row.sheetRow, trackId: stored.track.id, artist: stored.track.artist, title: stored.track.title });
      } catch (error) {
        failures.push({ sheetRow: row.sheetRow, artist: row.artist, title: row.title, error: error instanceof CatalogueTrackStorageError ? error.message : "The track could not be stored." });
      }
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: access.user.id,
        action: "CATALOGUE_BULK_IMPORT_COMPLETED",
        entityType: "CatalogueBatch",
        entityId: batchId,
        details: { archiveName: archive.name, manifestName: manifest.name, requested: rows.length, imported: imported.length, failed: failures.length }
      }
    });
    securityLog(failures.length ? "warn" : "info", "CATALOGUE_BULK_IMPORT_COMPLETED", request, {
      actorUserId: access.user.id,
      batchId,
      imported: imported.length,
      failed: failures.length
    });
    return NextResponse.json({ ok: failures.length === 0, batchId, imported, failures }, { status: failures.length ? 207 : 201 });
  } catch (error) {
    const expected = error instanceof CatalogueBulkImportError || error instanceof CatalogueTrackStorageError;
    const status = expected ? error.status : 500;
    securityLog(status >= 500 ? "error" : "warn", "CATALOGUE_BULK_IMPORT_ERROR", request, {
      error: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.json({ error: expected ? error.message : "The catalogue batch could not be processed. Please try again." }, { status });
  }
}
