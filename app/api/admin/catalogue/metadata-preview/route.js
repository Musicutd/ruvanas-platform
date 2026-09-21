import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { CatalogueBulkImportError, MAX_CATALOGUE_MANIFEST_SIZE_BYTES, parseCatalogueManifest } from "@/lib/catalogue-bulk-import.mjs";
import { selectSingleCatalogueRow } from "@/lib/catalogue-single-metadata.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can match catalogue metadata." }, { status: 403 });

    const formData = await request.formData();
    const spreadsheet = formData.get("spreadsheet");
    const audioFileName = String(formData.get("audioFileName") || "");
    if (!(spreadsheet instanceof File) || !spreadsheet.size) return NextResponse.json({ error: "Choose a CSV or XLSX metadata spreadsheet." }, { status: 400 });
    if (spreadsheet.size > MAX_CATALOGUE_MANIFEST_SIZE_BYTES) return NextResponse.json({ error: "The metadata spreadsheet exceeds 10 MB." }, { status: 413 });
    const genres = await prisma.mediaGenre.findMany({ where: { active: true, providerReviewStatus: "APPROVED" }, select: { id: true, name: true, slug: true } });
    const rows = await parseCatalogueManifest({
      buffer: Buffer.from(await spreadsheet.arrayBuffer()),
      fileName: spreadsheet.name,
      genres,
      allowNewGenres: true
    });
    const selected = selectSingleCatalogueRow(rows, audioFileName);
    if (!selected.ok) return NextResponse.json({ error: selected.error }, { status: 400 });
    const row = selected.row;
    return NextResponse.json({
      ok: true,
      metadata: {
        sheetRow: row.sheetRow,
        title: row.title,
        artist: row.artist,
        album: row.album || "",
        mixName: row.mixName || "",
        bpm: row.bpm ?? "",
        releaseYear: row.releaseYear ?? "",
        durationSeconds: row.durationSeconds ?? "",
        isExplicit: row.isExplicit,
        genreIds: row.genreIds,
        genreNames: row.genreNames,
        newGenreNames: row.newGenreNames
      }
    });
  } catch (error) {
    const known = error instanceof CatalogueBulkImportError;
    return NextResponse.json({ error: known ? error.message : "The metadata spreadsheet could not be checked." }, { status: known ? error.status : 500 });
  }
}
