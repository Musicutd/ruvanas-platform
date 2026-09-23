import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  decodeSpreadsheetText,
  extractCatalogueArchive,
  matchManifestRowsToAudio,
  metadataForBulkRow,
  parseCatalogueBatchSettings,
  parseCatalogueManifest
} from "../lib/catalogue-bulk-import.mjs";

const genres = [
  { id: "cm0000000000000000000001", name: "R&B", slug: "r-and-b" },
  { id: "cm0000000000000000000002", name: "Pop", slug: "pop" },
  { id: "cm0000000000000000000003", name: "Dance", slug: "dance" }
];

const settings = parseCatalogueBatchSettings({
  rightsHolder: "Promo Only",
  rightsReference: "AGREEMENT-2026",
  permittedTerritories: "Worldwide",
  licenceExpiresAt: "",
  rightsConfirmed: "true",
  publishNow: "false",
  licensedCatalogue: "true",
  minimumCatalogueLevel: "PROFESSIONAL",
  permittedUses: ["ONLINE_RADIO"]
});

test("bulk catalogue import requires valid chosen territories", () => {
  assert.equal(parseCatalogueBatchSettings({ ...settings.data, permittedTerritories: "" }).ok, false);
  assert.equal(parseCatalogueBatchSettings({ ...settings.data, permittedTerritories: "unknown continent" }).ok, false);
  assert.equal(settings.data.permittedTerritories, "WORLDWIDE");
});

test("spreadsheet HTML entities are decoded before genre matching", async () => {
  assert.equal(decodeSpreadsheetText("Contemporary R&amp;B"), "Contemporary R&B");
  const csv = Buffer.from("#,Artist,Title,Mix,Time,BPM,Genre,Content Warning\n1,Adele,Example,Clean,3:17,121,Contemporary R&amp;B,X\n2,Artist,Second,,180,104,Dance Pop,\n");
  const rows = await parseCatalogueManifest({ buffer: csv, fileName: "catalogue.csv", genres });
  assert.deepEqual(rows[0].genreNames, ["R&B"]);
  assert.deepEqual(rows[0].genreIds, ["cm0000000000000000000001"]);
  assert.equal(rows[0].durationSeconds, 197);
  assert.equal(rows[0].bpm, 121);
  assert.equal(rows[0].isExplicit, true);
  assert.deepEqual(rows[1].genreNames, ["Pop", "Dance"]);
});

test("spreadsheet rows match numbered audio without requiring a File column", async () => {
  const csv = Buffer.from("#,Artist,Title,Mix,Time,BPM,Genre,Content Warning\n1,Adele,Example,Clean,3:17,121,R&amp;B,\n");
  const rows = await parseCatalogueManifest({ buffer: csv, fileName: "catalogue.csv", genres });
  const file = { fileName: "music/01 Adele - Example.mp3", baseName: "01 Adele - Example.mp3", buffer: Buffer.from("audio") };
  const matched = matchManifestRowsToAudio(rows, [file]);
  assert.equal(matched[0].file, file);
  assert.deepEqual(matched[0].errors, []);
});

test("bulk metadata uses shared rights and row Mix and BPM", async () => {
  assert.equal(settings.ok, true);
  const csv = Buffer.from("File,Artist,Title,Mix,Time,BPM,Genre\ntrack.mp3,Artist,Title,Radio Edit,3:30,128,R&amp;B\n");
  const [row] = await parseCatalogueManifest({ buffer: csv, fileName: "catalogue.csv", genres });
  const metadata = metadataForBulkRow(row, settings.data);
  assert.equal(metadata.ok, true);
  assert.equal(metadata.data.mixName, "Radio Edit");
  assert.equal(metadata.data.bpm, 128);
  assert.equal(metadata.data.rightsHolder, "Promo Only");
  assert.equal(metadata.data.minimumCatalogueLevel, "PROFESSIONAL");
  assert.deepEqual(metadata.data.genreIds, ["cm0000000000000000000001"]);
});

test("bulk validation rejects invalid BPM before upload", async () => {
  const csv = Buffer.from("Artist,Title,BPM,Genre\nArtist,Title,500,R&amp;B\n");
  const [row] = await parseCatalogueManifest({ buffer: csv, fileName: "catalogue.csv", genres });
  assert.match(row.errors.join(" "), /BPM/i);
});

test("XLSX manifests and nested ZIP audio are accepted", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Catalogue");
  sheet.addRow(["#", "Artist", "Title", "Mix", "Time", "BPM", "Genre"]);
  sheet.addRow([1, "Artist", "Title", "Clean", "3:00", 120, "R&amp;B"]);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const rows = await parseCatalogueManifest({ buffer: xlsx, fileName: "catalogue.xlsx", genres });
  assert.equal(rows[0].title, "Title");
  assert.deepEqual(rows[0].genreNames, ["R&B"]);

  const zip = new JSZip();
  zip.file("music/01 Artist - Title.mp3", Buffer.from("ID3test"));
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const files = await extractCatalogueArchive(archive);
  assert.equal(files.length, 1);
  assert.equal(files[0].baseName, "01 Artist - Title.mp3");
});
