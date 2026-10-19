import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateAudioUpload } from "../lib/audio-validation.mjs";
import { catalogueStorageKey, MAX_CATALOGUE_FILE_SIZE_BYTES } from "../lib/catalogue-upload.mjs";
import { measureCatalogueAudioDuration } from "../lib/catalogue-audio-duration.mjs";

const storageSource = await readFile(new URL("../lib/catalogue-track-storage.js", import.meta.url), "utf8");
const bulkSource = await readFile(new URL("../app/api/admin/catalogue/bulk-upload/route.js", import.meta.url), "utf8");
const withoutImports = (source) => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");

function silentWav(seconds) {
  const sampleRate = 8_000;
  const dataBytes = seconds * sampleRate;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function metadata(durationSeconds) {
  return {
    title: "Synthetic song", artist: "Synthetic artist", album: null, mixName: null,
    bpm: null, releaseYear: null, durationSeconds, isExplicit: false,
    rightsHolder: "Synthetic rights holder", rightsReference: "synthetic-reference",
    permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"],
    licenceExpiresAt: null, licensedCatalogue: false,
    minimumCatalogueLevel: "FOCUSED", status: "DRAFT", genreIds: []
  };
}

function storageHarness() {
  const state = { assetReads: 0, assetWrites: [], transactions: 0, objects: [], audits: [], batchAudits: [] };
  let assetNumber = 0;
  class PutObjectCommand { constructor(input) { this.input = input; this.kind = "PUT"; } }
  class CopyObjectCommand { constructor(input) { this.input = input; this.kind = "COPY"; } }
  class DeleteObjectCommand { constructor(input) { this.input = input; this.kind = "DELETE"; } }
  const tx = {
    mediaAsset: { update: async () => ({}) },
    mediaAssetGenre: { createMany: async () => ({ count: 0 }) },
    track: { create: async ({ data }) => ({ id: `track-${assetNumber}`, ...data }) },
    auditLog: { create: async ({ data }) => { state.audits.push(data); return data; } }
  };
  const prisma = {
    mediaAsset: {
      findUnique: async () => { state.assetReads++; return null; },
      findMany: async () => { state.assetReads++; return []; },
      create: async ({ data }) => { state.assetWrites.push(data); assetNumber++; return { id: `asset-${assetNumber}`, ...data }; },
      update: async ({ data }) => { state.assetWrites.push(data); return data; }
    },
    mediaGenre: { findMany: async () => [] },
    auditLog: { create: async ({ data }) => { state.batchAudits.push(data); return data; } },
    $transaction: async (callback) => { state.transactions++; return callback(tx); }
  };
  const client = { send: async (command) => { state.objects.push(command); return {}; } };
  const deps = {
    crypto, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, prisma,
    getR2Storage: () => ({ bucketName: "synthetic-bucket", client }),
    validateAudioUpload, catalogueStorageKey, MAX_CATALOGUE_FILE_SIZE_BYTES,
    resolveNewCatalogueGenres: async () => ({ ids: [], createdNames: [] }),
    measureCatalogueAudioDuration
  };
  const storage = new Function(...Object.keys(deps),
    `${withoutImports(storageSource)}\nreturn { inspectCatalogueAudio, findExistingCatalogueChecksums, storeCatalogueTrack, CatalogueTrackStorageError };`)(...Object.values(deps));
  return { state, prisma, storage };
}

class SyntheticFile {
  constructor(name, contents) {
    this.name = name;
    this.contents = Buffer.from(contents);
    this.size = this.contents.length;
  }
  async arrayBuffer() { return Uint8Array.from(this.contents).buffer; }
}

function bulkHarness(storageFixture, { audio, submittedSeconds, mode = "validate" }) {
  const state = { released: false, logs: [] };
  const manifest = new SyntheticFile("synthetic.csv", Buffer.from("synthetic-manifest"));
  const archive = new SyntheticFile("synthetic.zip", Buffer.from("synthetic-archive"));
  const file = { fileName: "synthetic.wav", baseName: "synthetic.wav", buffer: audio };
  const fields = new Map([["archive", archive], ["manifest", manifest], ["mode", mode]]);
  const form = { get: (name) => fields.get(name) ?? null, getAll: () => [] };
  const deps = {
    crypto,
    NextResponse: { json: (body, options = {}) => Response.json(body, options) },
    catalogueTerritoriesFromForm: () => ({ ok: true, codes: ["MT"] }),
    prisma: storageFixture.prisma,
    requirePlatformAdmin: async () => ({ ok: true, user: { role: "SUPER_ADMIN", id: "synthetic-admin" } }),
    accessDenied: () => Response.json({ error: "Denied" }, { status: 401 }),
    CatalogueBulkImportError: class CatalogueBulkImportError extends Error { status = 400; },
    extractCatalogueArchive: async () => [file],
    matchManifestRowsToAudio: (rows) => rows.map((row) => ({ ...row, file })),
    metadataForBulkRow: (row) => ({ ok: true, data: metadata(row.durationSeconds) }),
    parseCatalogueBatchSettings: () => ({ ok: true, data: {} }),
    parseCatalogueManifest: async () => [{ sheetRow: 2, title: "Synthetic song", artist: "Synthetic artist",
      mixName: null, bpm: null, durationSeconds: submittedSeconds, genreSource: "", genreNames: [],
      newGenreNames: [], isExplicit: false, notes: [], errors: [], genreIds: [] }],
    CatalogueTrackStorageError: storageFixture.storage.CatalogueTrackStorageError,
    findExistingCatalogueChecksums: storageFixture.storage.findExistingCatalogueChecksums,
    inspectCatalogueAudio: storageFixture.storage.inspectCatalogueAudio,
    storeCatalogueTrack: storageFixture.storage.storeCatalogueTrack,
    securityLog: (...args) => state.logs.push(args),
    catalogueBulkFileSizeError: () => null,
    acquireCatalogueBulkRequest: () => () => { state.released = true; },
    CatalogueBulkRequestError: class CatalogueBulkRequestError extends Error { status = 400; },
    readCatalogueBulkFormData: async () => form,
    File: SyntheticFile
  };
  const POST = new Function(...Object.keys(deps), `${withoutImports(bulkSource)}\nreturn POST;`)(...Object.values(deps));
  return { post: () => POST({}), state };
}

test("an unprobeable signed upload fails before any DB or R2 write", async () => {
  const fixture = storageHarness();
  const invalidWav = Buffer.from("RIFF0000WAVE");
  await assert.rejects(fixture.storage.storeCatalogueTrack({ buffer: invalidWav, fileName: "bad.wav",
    metadata: metadata(10_020), actorUserId: "synthetic-admin" }),
  { code: "CATALOGUE_DURATION_UNVERIFIED" });
  assert.equal(fixture.state.assetReads, 0);
  assert.equal(fixture.state.assetWrites.length, 0);
  assert.equal(fixture.state.transactions, 0);
  assert.equal(fixture.state.objects.length, 0);
});

test("storage re-probes its buffer and records verified 167 seconds despite forged inspected/audit duration", async () => {
  const fixture = storageHarness();
  const buffer = silentWav(167);
  const checked = await fixture.storage.inspectCatalogueAudio({ buffer, fileName: "song.wav" });
  const stored = await fixture.storage.storeCatalogueTrack({ buffer, fileName: "song.wav",
    metadata: metadata(10_020), actorUserId: "synthetic-admin",
    inspected: { ...checked, durationSeconds: 10_020 },
    auditContext: { durationSeconds: 10_020, durationSource: "FORGED", bulkImportId: "synthetic-batch" } });
  assert.equal(stored.audio.durationSeconds, 167);
  assert.equal(fixture.state.assetWrites[0].durationSeconds, 167);
  const details = fixture.state.audits[0].details;
  assert.equal(details.durationSeconds, 167);
  assert.equal(details.submittedDurationSeconds, 10_020);
  assert.equal(details.durationSource, "VERIFIED_AUDIO");
  assert.equal(details.bulkImportId, "synthetic-batch");
  assert.deepEqual(fixture.state.objects.map((item) => item.kind), ["PUT", "COPY", "DELETE"]);
});

test("already correct submitted 182- and 192-second lengths remain unchanged in storage and audit", async () => {
  for (const duration of [182, 192]) {
    const fixture = storageHarness();
    const stored = await fixture.storage.storeCatalogueTrack({ buffer: silentWav(duration),
      fileName: "song.wav", metadata: metadata(duration), actorUserId: "synthetic-admin" });
    assert.equal(stored.audio.durationSeconds, duration);
    assert.equal(fixture.state.assetWrites[0].durationSeconds, duration);
    assert.equal(fixture.state.audits[0].details.submittedDurationSeconds, duration);
  }
});

test("a reused Buffer whose bytes change cannot reuse the old duration probe", async () => {
  const fixture = storageHarness();
  const buffer = silentWav(167);
  const checked = await fixture.storage.inspectCatalogueAudio({ buffer, fileName: "song.wav" });
  assert.equal(checked.durationSeconds, 167);
  // Keep the same buffer and byte length, but change the WAV sample rate.
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  const changed = await fixture.storage.inspectCatalogueAudio({ buffer, fileName: "song.wav" });
  assert.notEqual(changed.checksum, checked.checksum);
  assert.equal(changed.durationSeconds, 84);
});

test("actual bulk route preview replaces 10020 with 167 before writes, and import stores 167", async () => {
  const audio = silentWav(167);
  const checked = storageHarness();
  const validate = bulkHarness(checked, { audio, submittedSeconds: 10_020 });
  const previewResponse = await validate.post();
  assert.equal(previewResponse.status, 200);
  const preview = (await previewResponse.json()).preview;
  assert.equal(preview.ready, true);
  assert.equal(preview.rows[0].durationSeconds, 167);
  assert.match(preview.rows[0].notes.join(" "), /Spreadsheet length differs.*167 seconds/);
  assert.equal(checked.state.assetWrites.length, 0);
  assert.equal(checked.state.objects.length, 0);
  assert.equal(validate.state.released, true);

  const imported = storageHarness();
  const route = bulkHarness(imported, { audio: silentWav(167), submittedSeconds: 10_020, mode: "import" });
  const response = await route.post();
  assert.equal(response.status, 201);
  assert.equal(imported.state.assetWrites[0].durationSeconds, 167);
  assert.equal(imported.state.audits[0].details.durationSeconds, 167);
  assert.equal(route.state.released, true);
});

test("bulk route refuses an unprobeable file in import mode with zero DB/R2 writes", async () => {
  const fixture = storageHarness();
  const route = bulkHarness(fixture, { audio: Buffer.from("RIFF0000WAVE"),
    submittedSeconds: 10_020, mode: "import" });
  const response = await route.post();
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.preview.ready, false);
  assert.equal(fixture.state.assetWrites.length, 0);
  assert.equal(fixture.state.objects.length, 0);
  assert.equal(fixture.state.transactions, 0);
  assert.equal(route.state.released, true);
});
