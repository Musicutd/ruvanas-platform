import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  getPromoOnlyAudioSampleState, importPromoOnlyAudioSample,
  recoverPromoOnlyAudioSample, repairPromoOnlyAudioSamplePreflight,
  resolvePromoOnlyAudioSampleAsset
} from "../lib/promo-only-audio-sample-service.js";

const ACTOR = "private-preview-owner";
const CHECKSUM = "a".repeat(64);
const AUDIO = Buffer.from("ID3synthetic-private-sample");
const CONFIG = Object.freeze({ enabled: true, ready: true, manualOnly: true,
  trackId: "713637", releaseId: "122500", audioDownloadEnabled: false,
  allowHttpMediaTest: false, supplierCredentialsConfigured: true,
  storageCredentialsConfigured: true });
const MARKER = JSON.stringify({ managedBy: "PROMOONLY_MANUAL_METADATA_SAMPLE_V1" });

function source() {
  const connection = { id: "connection-1", providerKey: "PROMO_ONLY", name: "Promo Only",
    createdByUserId: ACTOR, status: "PAUSED", nextSyncAt: null,
    syncLeaseOwner: null, syncLeaseUntil: null, revokedAt: null,
    apiBaseUrl: "https://api.promoonly.com/",
    tokenUrl: "https://api.promoonly.com/user/authenticate",
    cataloguePath: "/releases/date/1", oauthScopes: ["catalogue.read"],
    defaultPermittedTerritories: [], defaultPermittedUses: [],
    configuration: { managedBy: "PROMOONLY_MANUAL_METADATA_SAMPLE_V1",
      manualOnly: true, rssConfigured: false, productionLocked: true },
    clientCredentialsEncrypted: "test-encrypted-marker" };
  const item = { id: "provider-item-1", connectionId: connection.id,
    externalTrackId: "713637", releaseId: "release-1",
    release: { id: "release-1", connectionId: connection.id,
      externalReleaseId: "122500", status: "ACTIVE" },
    title: "Synthetic sample", artist: "Synthetic artist", album: "Synthetic album",
    mixName: null, bpm: null, releaseDate: new Date("2026-10-11T00:00:00.000Z"),
    label: null, contentWarning: null, durationSeconds: 60,
    isExplicit: false, rightsHolder: "Promo Only", rightsReference: "promo-only:713637",
    mediaType: "2", deliveryMode: "DOWNLOAD", sourceGenre: "Unmapped fixture style",
    sourceUrlEncrypted: null, autoDjReady: false,
    permittedUses: [], permittedTerritories: [], licenceStartsAt: null,
    licenceExpiresAt: null, status: "ACTIVE", trackId: null,
    importState: "METADATA_READY", audioStatus: "NOT_REQUESTED",
    downloadRetryCount: 0, sourceChecksumSha256: null, sourceMimeType: null,
    sourceSizeBytes: null, lastImportErrorCode: null,
    revision: 1, metadataChecksum: "b".repeat(64) };
  return { connection, item, stored: null, audit: [] };
}

function whereMatches(row, where) {
  return Object.entries(where).every(([key, value]) =>
    value && typeof value === "object" && Array.isArray(value.in)
      ? value.in.includes(row[key]) : row[key] === value);
}

function makeDb() {
  const state = source();
  const db = { state,
    musicDistributorConnection: {
      findUnique: async ({ where }) => where.providerKey === "PROMO_ONLY" ? state.connection : null
    },
    musicDistributorTrack: {
      findUnique: async ({ where }) =>
        where.connectionId_externalTrackId?.connectionId === state.connection.id &&
        where.connectionId_externalTrackId?.externalTrackId === state.item.externalTrackId
          ? state.item : null,
      updateMany: async ({ where, data }) => {
        if (!whereMatches(state.item, where)) return { count: 0 };
        Object.assign(state.item, data);
        return { count: 1 };
      }
    },
    track: { findUnique: async ({ where }) =>
      where.id === state.stored?.id ? state.stored : null },
    auditLog: {
      create: async ({ data }) => { state.audit.push(data); return data; },
      findMany: async ({ where, orderBy, take }) => {
        const rows = state.audit.filter((row) =>
          row.entityType === where.entityType && row.entityId === where.entityId &&
          row.action.startsWith(where.action.startsWith));
        if (orderBy) rows.sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        return (take ? rows.slice(0, take) : rows).map(
          ({ action, actorUserId, details, createdAt }) =>
            ({ action, actorUserId, details, createdAt }));
      }
    },
    $transaction: async (operation) => operation(db)
  };
  return db;
}

function preflightLockedDb() {
  const db = makeDb();
  Object.assign(db.state.item, { importState: "RECONCILIATION_REQUIRED",
    audioStatus: "SAMPLE_CLAIMED",
    lastImportErrorCode: "PROMOONLY_AUDIO_SAMPLE_SERVERS_INVALID" });
  db.state.audit.push({ actorUserId: ACTOR,
    action: "PROMOONLY_AUDIO_SAMPLE_CLAIMED",
    entityType: "MusicDistributorTrack", entityId: db.state.item.id });
  return db;
}

function queuedRecoveryLockedDb() {
  const db = makeDb();
  Object.assign(db.state.item, { importState: "RECONCILIATION_REQUIRED",
    audioStatus: "SAMPLE_CLAIMED",
    lastImportErrorCode: "PROMOONLY_AUDIO_SAMPLE_REQUEST_FAILED" });
  const claim = (createdAt) => ({ actorUserId: ACTOR,
    action: "PROMOONLY_AUDIO_SAMPLE_CLAIMED",
    entityType: "MusicDistributorTrack", entityId: db.state.item.id,
    createdAt, details: { externalTrackId: "713637", externalReleaseId: "122500",
      rightsGranted: false } });
  db.state.audit.push(claim(new Date("2026-10-11T17:00:00.000Z")),
    { actorUserId: ACTOR, action: "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIRED",
      entityType: "MusicDistributorTrack", entityId: db.state.item.id,
      createdAt: new Date("2026-10-11T17:30:00.000Z"),
      details: { originalFailureCode: "PROMOONLY_AUDIO_SAMPLE_SERVERS_INVALID",
        mediaRequested: false, rightsGranted: false } },
    claim(new Date("2026-10-11T18:06:00.000Z")));
  return db;
}

function options(db, { acknowledgementFails = false, storageFails = false } = {}) {
  const bytes = Buffer.from(AUDIO);
  const spy = { supplierCalls: 0, acknowledgeCalls: 0, disposed: false, bytes,
    storedInput: null };
  const runtime = { actorUserId: ACTOR, config: CONFIG,
    decryptMarker: (value) => value === "test-encrypted-marker" ? MARKER : "invalid",
    now: new Date("2026-10-11T13:00:00.000Z"),
    fetchSample: async () => {
      spy.supplierCalls++;
      return { supplierRequestCount: 5,
        audio: { buffer: bytes, fileName: "sample.mp3", contentType: "audio/mpeg" },
        dispose: () => { spy.disposed = true; },
        acknowledge: async () => {
          spy.acknowledgeCalls++;
          assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED",
            "supplier acknowledgement must follow the durable, unapproved link");
          assert.equal(db.state.item.trackId, "draft-track-1");
          if (acknowledgementFails) throw new Error("synthetic acknowledgement lost");
          return { status: "ACKNOWLEDGED", supplierRequestCount: 6 };
        } };
    },
    inspectAudio: async ({ buffer, fileName, claimedType }) => {
      assert.equal(buffer, bytes);
      assert.equal(fileName, "sample.mp3");
      assert.equal(claimedType, "audio/mpeg");
      return { checksum: CHECKSUM, contentType: "audio/mpeg",
        extension: "mp3", storageKey: `catalogue/music/${CHECKSUM}.mp3` };
    },
    storeTrack: async (input) => {
      spy.storedInput = input;
      assert.equal(db.state.item.sourceChecksumSha256, CHECKSUM,
        "exact checksum evidence must be durable before any storage operation");
      assert.equal(db.state.item.sourceMimeType, "audio/mpeg");
      assert.equal(db.state.item.sourceSizeBytes, BigInt(bytes.length));
      assert.ok(input.privateSampleStorage.abortSignal instanceof AbortSignal);
      await input.privateSampleStorage.recordKeys({ checksum: CHECKSUM,
        quarantineKey: "quarantine/catalogue/00000000-0000-4000-8000-000000000001.mp3",
        finalStorageKey: `catalogue/music/${CHECKSUM}.mp3`,
        needsStorageWrite: true, preexistingReadyAsset: false });
      if (storageFails) throw new Error("synthetic storage failure");
      db.state.stored = { id: "draft-track-1", mediaAssetId: "asset-1",
        catalogueProvider: "PROMO_ONLY", status: "DRAFT",
        rightsReviewStatus: "DRAFT", rightsConfirmedAt: null,
        rightsConfirmedById: null, rightsReviewedAt: null,
        rightsReviewedById: null, minimumCatalogueLevel: "NONE",
        permittedTerritories: "", permittedUses: [],
        mediaAsset: { id: "asset-1", organisationId: null,
          libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC", status: "READY",
          licensedCatalogue: false,
          storageKey: `catalogue/music/${CHECKSUM}.mp3`,
          mimeType: "audio/mpeg", sizeBytes: BigInt(bytes.length) } };
      return { track: { id: "draft-track-1" } };
    }
  };
  return { runtime, spy };
}

function recoveryOptions(db, testOptions = {}) {
  const { runtime, spy } = options(db, testOptions);
  const syntheticFetch = runtime.fetchSample;
  delete runtime.fetchSample;
  runtime.recoverSample = async () => {
    const sample = await syntheticFetch();
    const acknowledge = sample.acknowledge;
    return { ...sample, existingQueueOnly: true, supplierRequestCount: 4,
      acknowledge: async () => ({ ...await acknowledge(),
        existingQueueOnly: true, supplierRequestCount: 5 }) };
  };
  return { runtime, spy };
}

test("exact owned metadata sample imports one private, unapproved audio item and acknowledges after linking", async () => {
  const db = makeDb();
  const { runtime, spy } = options(db);
  assert.deepEqual(await getPromoOnlyAudioSampleState(db, runtime), {
    enabled: true, ready: true, canImport: true, canRecover: false, playbackAvailable: false,
    reconciliationRequired: false, safeErrorCode: null });
  const result = await importPromoOnlyAudioSample(db, runtime);
  assert.deepEqual(result, { imported: true, playbackAvailable: true,
    reconciliationRequired: false, safeErrorCode: null });
  assert.equal(spy.supplierCalls, 1);
  assert.equal(spy.acknowledgeCalls, 1);
  assert.equal(spy.disposed, true);
  assert.ok(spy.bytes.every((byte) => byte === 0), "sample buffer should be zeroed");
  assert.equal(spy.storedInput.reviewApproved, false);
  assert.equal(spy.storedInput.metadata.status, "DRAFT");
  assert.equal(spy.storedInput.metadata.minimumCatalogueLevel, "NONE");
  assert.equal(spy.storedInput.metadata.licensedCatalogue, false);
  assert.deepEqual(spy.storedInput.metadata.genreIds, []);
  assert.deepEqual(spy.storedInput.metadata.permittedUses, []);
  assert.equal(spy.storedInput.metadata.permittedTerritories, "");
  assert.equal(db.state.connection.status, "PAUSED");
  assert.equal(db.state.item.autoDjReady, false);
  assert.equal(db.state.item.audioStatus, "STORED_PENDING_RIGHTS");
  assert.equal(db.state.item.importState, "CATALOGUED");
  assert.ok(db.state.audit.some((entry) =>
    entry.action === "PROMOONLY_AUDIO_SAMPLE_STORAGE_KEYS_IDENTIFIED" &&
    entry.details.finalStorageKey === `catalogue/music/${CHECKSUM}.mp3`));
  assert.equal((await resolvePromoOnlyAudioSampleAsset(db, runtime)).id, "asset-1");
  assert.equal((await getPromoOnlyAudioSampleState(db, runtime)).playbackAvailable, true);
  await assert.rejects(importPromoOnlyAudioSample(db, runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED" });
  assert.equal(spy.supplierCalls, 1);
});

test("foreign owner, altered connection, wrong release and unready config stop before supplier calls", async () => {
  for (const mutate of [
    (db) => { db.state.connection.createdByUserId = "another-owner"; },
    (db) => { db.state.connection.status = "ACTIVE"; },
    (db) => { db.state.connection.cataloguePath = "/other"; },
    (db) => { db.state.connection.configuration.managedBy = "other"; },
    (db) => { db.state.connection.clientCredentialsEncrypted = "wrong"; },
    (db) => { db.state.item.release.externalReleaseId = "999"; },
    (db) => { db.state.item.permittedUses = ["ONLINE_RADIO"]; }
  ]) {
    const db = makeDb();
    const { runtime, spy } = options(db);
    mutate(db);
    await assert.rejects(importPromoOnlyAudioSample(db, runtime),
      { code: "PROMOONLY_AUDIO_SAMPLE_SOURCE_UNAVAILABLE" });
    assert.equal(spy.supplierCalls, 0);
    assert.equal(db.state.audit.length, 0);
  }
  const db = makeDb();
  const { runtime, spy } = options(db);
  await assert.rejects(importPromoOnlyAudioSample(db, {
    ...runtime, config: { ...CONFIG, ready: false }
  }), { code: "PROMOONLY_AUDIO_SAMPLE_NOT_READY" });
  assert.equal(spy.supplierCalls, 0);
});

test("lost acknowledgement or storage failure permanently blocks re-download and private stream", async () => {
  const db = makeDb();
  const { runtime, spy } = options(db, { acknowledgementFails: true });
  const result = await importPromoOnlyAudioSample(db, runtime);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.playbackAvailable, false);
  assert.equal(db.state.item.trackId, "draft-track-1");
  assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
  assert.equal(await resolvePromoOnlyAudioSampleAsset(db, runtime), null);
  await assert.rejects(importPromoOnlyAudioSample(db, runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED" });
  assert.equal(spy.supplierCalls, 1);

  const failedDb = makeDb();
  const failed = options(failedDb, { storageFails: true });
  await assert.rejects(importPromoOnlyAudioSample(failedDb, failed.runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_RECONCILIATION_REQUIRED" });
  assert.equal(failedDb.state.item.importState, "RECONCILIATION_REQUIRED");
  assert.equal(failedDb.state.item.trackId, null);
  assert.equal(failedDb.state.item.sourceChecksumSha256, CHECKSUM,
    "ambiguous storage keeps the exact digest for manual reconciliation");
  assert.equal(failed.spy.acknowledgeCalls, 0);
  await assert.rejects(importPromoOnlyAudioSample(failedDb, failed.runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED" });
  assert.equal(failed.spy.supplierCalls, 1);
});

test("fixed supplier HTTPS/entitlement failures remain visible without retry or raw provider text", async () => {
  for (const code of ["PROMOONLY_AUDIO_SAMPLE_HTTPS_OR_HOST_UNSUPPORTED",
    "PROMOONLY_AUDIO_SAMPLE_ENTITLEMENT_DENIED",
    "PROMOONLY_AUDIO_SAMPLE_TOKEN_EXPIRY_TOO_SHORT",
    "PROMOONLY_AUDIO_SAMPLE_MEDIA_HTTP_STATUS_INVALID",
    "PROMOONLY_AUDIO_SAMPLE_MEDIA_LENGTH_MISMATCH"]) {
    const db = makeDb();
    const { runtime } = options(db);
    let calls = 0;
    await assert.rejects(importPromoOnlyAudioSample(db, { ...runtime,
      fetchSample: async () => {
        calls++;
        throw Object.assign(new Error("synthetic supplier secret or URL must not leak"), { code });
      }
    }), { code });
    assert.equal(calls, 1);
    assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
    assert.equal(db.state.item.lastImportErrorCode, code);
  }
});

test("bounded storage timeout never acknowledges, retries, or plays; late draft stays in reconciliation", async () => {
  const db = makeDb();
  const { runtime, spy } = options(db);
  const controller = new AbortController();
  let finishStore;
  runtime.storageAbortSignal = controller.signal;
  runtime.storeTrack = async (input) => {
    await input.privateSampleStorage.recordKeys({ checksum: CHECKSUM,
      quarantineKey: "quarantine/catalogue/00000000-0000-4000-8000-000000000002.mp3",
      finalStorageKey: `catalogue/music/${CHECKSUM}.mp3`,
      needsStorageWrite: true, preexistingReadyAsset: false });
    return new Promise((resolve) => { finishStore = () => resolve({ track: { id: "late-draft-track" } }); });
  };
  const pending = importPromoOnlyAudioSample(db, runtime);
  for (let attempts = 0; !finishStore && attempts < 100; attempts++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(typeof finishStore, "function");
  controller.abort();
  await assert.rejects(pending, { code: "PROMOONLY_AUDIO_SAMPLE_STORAGE_TIMEOUT" });
  assert.equal(spy.acknowledgeCalls, 0);
  assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
  assert.equal(await resolvePromoOnlyAudioSampleAsset(db, runtime), null);
  await assert.rejects(importPromoOnlyAudioSample(db, runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED" });
  assert.equal(spy.supplierCalls, 1);
  finishStore();
  for (let attempts = 0; db.state.item.trackId !== "late-draft-track" && attempts < 100; attempts++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(db.state.item.trackId, "late-draft-track");
  assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
  assert.equal(await resolvePromoOnlyAudioSampleAsset(db, runtime), null);
  assert.ok(spy.bytes.every((byte) => byte === 0));
});

test("one exact pre-queue server-ID lock can be repaired after fresh three-call hosted verification", async () => {
  const db = preflightLockedDb();
  const { runtime } = options(db);
  let checks = 0;
  const result = await repairPromoOnlyAudioSamplePreflight(db, { ...runtime,
    checkPreflight: async () => {
      checks++;
      assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
      return { verified: true, hasZeroServerId: true, serverCount: 1,
        supplierRequestCount: 3 };
    }
  });
  assert.deepEqual(result, { repaired: true, canImport: true,
    playbackAvailable: false, reconciliationRequired: false, safeErrorCode: null });
  assert.equal(checks, 1);
  assert.equal(db.state.item.importState, "METADATA_READY");
  assert.equal(db.state.item.audioStatus, "NOT_REQUESTED");
  assert.equal(db.state.item.lastImportErrorCode, null);
  assert.equal(db.state.item.trackId, null);
  assert.equal(db.state.audit[0].action, "PROMOONLY_AUDIO_SAMPLE_CLAIMED");
  assert.equal(db.state.audit[1].action, "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIRED");
  await assert.rejects(repairPromoOnlyAudioSamplePreflight(db, { ...runtime,
    checkPreflight: async () => { checks++; }
  }), { code: "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_ALLOWED" });
  assert.equal(checks, 1);
  Object.assign(db.state.item, { importState: "RECONCILIATION_REQUIRED",
    audioStatus: "SAMPLE_CLAIMED",
    lastImportErrorCode: "PROMOONLY_AUDIO_SAMPLE_SERVERS_INVALID" });
  db.state.audit.push({ actorUserId: ACTOR,
    action: "PROMOONLY_AUDIO_SAMPLE_CLAIMED",
    entityType: "MusicDistributorTrack", entityId: db.state.item.id });
  await assert.rejects(repairPromoOnlyAudioSamplePreflight(db, { ...runtime,
    checkPreflight: async () => { checks++; }
  }), { code: "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_ALLOWED" });
  assert.equal(checks, 1, "no second hosted check or repair after a later failed claim");
});

test("one existing-queue recovery preserves old audits, claims durably, and stores only a draft", async () => {
  const db = queuedRecoveryLockedDb();
  const { runtime, spy } = recoveryOptions(db);
  assert.deepEqual(await getPromoOnlyAudioSampleState(db, runtime), {
    enabled: true, ready: true, canImport: false, canRecover: true,
    playbackAvailable: false, reconciliationRequired: true,
    safeErrorCode: "PROMOONLY_AUDIO_SAMPLE_REQUEST_FAILED" });
  await assert.rejects(importPromoOnlyAudioSample(db, runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_ALREADY_CLAIMED" });
  const result = await recoverPromoOnlyAudioSample(db, runtime);
  assert.deepEqual(result, { imported: true, playbackAvailable: true,
    reconciliationRequired: false, safeErrorCode: null });
  assert.equal(db.state.item.downloadRetryCount, 1);
  assert.equal(spy.supplierCalls, 1);
  assert.equal(spy.acknowledgeCalls, 1);
  assert.equal(db.state.audit[0].action, "PROMOONLY_AUDIO_SAMPLE_CLAIMED");
  assert.equal(db.state.audit[1].action, "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIRED");
  assert.equal(db.state.audit[2].action, "PROMOONLY_AUDIO_SAMPLE_CLAIMED");
  assert.equal(db.state.audit[3].action, "PROMOONLY_AUDIO_SAMPLE_RECOVERY_CLAIMED");
  assert.equal(db.state.audit[3].details.originalFailureCode,
    "PROMOONLY_AUDIO_SAMPLE_REQUEST_FAILED");
  assert.equal(db.state.audit[3].details.queueMutated, false);
  assert.equal(spy.storedInput.metadata.status, "DRAFT");
  assert.equal(spy.storedInput.reviewApproved, false);
  assert.equal(db.state.item.autoDjReady, false);
  assert.equal((await getPromoOnlyAudioSampleState(db, runtime)).canRecover, false);
  await assert.rejects(recoverPromoOnlyAudioSample(db, runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_RECOVERY_NOT_ALLOWED" });
  assert.equal(spy.supplierCalls, 1);
});

test("recovery failure after durable claim never retries, queues again, or enables playback", async () => {
  const db = queuedRecoveryLockedDb();
  const { runtime } = recoveryOptions(db);
  let requests = 0;
  runtime.recoverSample = async () => {
    requests++;
    throw Object.assign(new Error("synthetic supplier response not exposed"), {
      code: "PROMOONLY_AUDIO_SAMPLE_REQUEST_FAILED", phase: "MEDIA",
      supplierRequestCount: 4 });
  };
  await assert.rejects(recoverPromoOnlyAudioSample(db, runtime), (error) => {
    assert.equal(error.code, "PROMOONLY_AUDIO_SAMPLE_REQUEST_FAILED");
    assert.equal(error.phase, "MEDIA");
    assert.equal(error.supplierRequestCount, 4);
    assert.doesNotMatch(error.message, /synthetic supplier response/);
    return true;
  });
  assert.equal(requests, 1);
  assert.equal(db.state.item.downloadRetryCount, 1);
  assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
  assert.equal(db.state.audit.length, 4);
  assert.equal(db.state.audit[3].action, "PROMOONLY_AUDIO_SAMPLE_RECOVERY_CLAIMED");
  assert.equal(await resolvePromoOnlyAudioSampleAsset(db, runtime), null);
  await assert.rejects(recoverPromoOnlyAudioSample(db, runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_RECOVERY_NOT_ALLOWED" });
  assert.equal(requests, 1);
});

test("fixed existing-queue identity and transport failures remain distinguishable after one claim", async () => {
  for (const code of ["PROMOONLY_AUDIO_SAMPLE_EXISTING_QUEUE_INVALID",
    "PROMOONLY_AUDIO_SAMPLE_QUEUED_RECOVERY_FAILED"]) {
    const db = queuedRecoveryLockedDb();
    const { runtime } = recoveryOptions(db);
    runtime.recoverSample = async () => {
      throw Object.assign(new Error("untrusted supplier detail"), {
        code, phase: "QUEUE", supplierRequestCount: 2 });
    };
    await assert.rejects(recoverPromoOnlyAudioSample(db, runtime), { code });
    assert.equal(db.state.item.lastImportErrorCode, code);
    assert.equal(db.state.audit[3].action, "PROMOONLY_AUDIO_SAMPLE_RECOVERY_CLAIMED");
  }
});

test("recovered bytes with unconfirmed ACK stay unplayable and never repeat supplier calls", async () => {
  const db = queuedRecoveryLockedDb();
  const { runtime, spy } = recoveryOptions(db, { acknowledgementFails: true });
  const result = await recoverPromoOnlyAudioSample(db, runtime);
  assert.deepEqual(result, { imported: true, playbackAvailable: false,
    reconciliationRequired: true, safeErrorCode: "PROMOONLY_AUDIO_SAMPLE_ACK_UNCONFIRMED",
    phase: "ACK", supplierRequestCount: 4 });
  assert.equal(db.state.item.trackId, "draft-track-1");
  assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
  assert.equal(await resolvePromoOnlyAudioSampleAsset(db, runtime), null);
  await assert.rejects(recoverPromoOnlyAudioSample(db, runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_RECOVERY_NOT_ALLOWED" });
  assert.equal(spy.supplierCalls, 1);
  assert.equal(spy.acknowledgeCalls, 1);
});

test("queued recovery rejects changed source, wrong history, media evidence, and CAS races before supplier", async () => {
  for (const mutate of [
    (db) => { db.state.connection.status = "ACTIVE"; },
    (db) => { db.state.connection.createdByUserId = "other"; },
    (db) => { db.state.item.lastImportErrorCode = "PROMOONLY_AUDIO_SAMPLE_NETWORK"; },
    (db) => { db.state.item.downloadRetryCount = 1; },
    (db) => { db.state.item.sourceChecksumSha256 = CHECKSUM; },
    (db) => { db.state.item.sourceMimeType = "audio/mpeg"; },
    (db) => { db.state.item.sourceSizeBytes = 100n; },
    (db) => { db.state.item.trackId = "draft-track"; },
    (db) => { db.state.audit[0].actorUserId = "other"; },
    (db) => { db.state.audit[0].details.externalTrackId = "other"; },
    (db) => { db.state.audit[1].details.mediaRequested = true; },
    (db) => { db.state.audit[1].createdAt = new Date("2026-10-11T19:00:00.000Z"); },
    (db) => { db.state.audit[2].action = "PROMOONLY_AUDIO_SAMPLE_IMPORTED"; },
    (db) => { db.state.audit.push({ actorUserId: ACTOR,
      action: "PROMOONLY_AUDIO_SAMPLE_BYTES_IDENTIFIED",
      entityType: "MusicDistributorTrack", entityId: db.state.item.id }); },
    (db) => { db.state.audit.push({ actorUserId: ACTOR,
      action: "PROMOONLY_AUDIO_SAMPLE_RECOVERY_CLAIMED",
      entityType: "MusicDistributorTrack", entityId: db.state.item.id }); }
  ]) {
    const db = queuedRecoveryLockedDb();
    const { runtime, spy } = recoveryOptions(db);
    mutate(db);
    await assert.rejects(recoverPromoOnlyAudioSample(db, runtime),
      { code: /PROMOONLY_AUDIO_SAMPLE_(RECOVERY_NOT_ALLOWED|SOURCE_UNAVAILABLE)/ });
    assert.equal(spy.supplierCalls, 0);
    assert.equal(db.state.item.downloadRetryCount <= 1, true);
  }
  const db = queuedRecoveryLockedDb();
  const { runtime, spy } = recoveryOptions(db);
  const originalUpdate = db.musicDistributorTrack.updateMany;
  db.musicDistributorTrack.updateMany = async (args) =>
    args.where.lastImportErrorCode === "PROMOONLY_AUDIO_SAMPLE_REQUEST_FAILED"
      ? { count: 0 } : originalUpdate(args);
  await assert.rejects(recoverPromoOnlyAudioSample(db, runtime),
    { code: "PROMOONLY_AUDIO_SAMPLE_RECOVERY_NOT_ALLOWED" });
  assert.equal(spy.supplierCalls, 0);
  assert.equal(db.state.audit.length, 3);
});

test("preflight repair rejects wrong failure, media evidence, owner, or altered audit before supplier check", async () => {
  for (const mutate of [
    (db) => { db.state.item.lastImportErrorCode = "PROMOONLY_AUDIO_SAMPLE_NETWORK"; },
    (db) => { db.state.item.audioStatus = "STORED_PENDING_RIGHTS"; },
    (db) => { db.state.item.sourceChecksumSha256 = CHECKSUM; },
    (db) => { db.state.item.sourceMimeType = "audio/mpeg"; },
    (db) => { db.state.item.sourceSizeBytes = 123n; },
    (db) => { db.state.item.trackId = "draft-track"; },
    (db) => { db.state.item.downloadRetryCount = 1; },
    (db) => { db.state.item.autoDjReady = true; },
    (db) => { db.state.connection.createdByUserId = "another-owner"; },
    (db) => { db.state.audit[0].actorUserId = "another-owner"; },
    (db) => { db.state.audit.push({ actorUserId: ACTOR,
      action: "PROMOONLY_AUDIO_SAMPLE_STORAGE_KEYS_IDENTIFIED",
      entityType: "MusicDistributorTrack", entityId: db.state.item.id }); },
    (db) => { db.state.audit.push({ actorUserId: ACTOR,
      action: "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIRED",
      entityType: "MusicDistributorTrack", entityId: db.state.item.id }); }
  ]) {
    const db = preflightLockedDb();
    const { runtime } = options(db);
    mutate(db);
    let checks = 0;
    await assert.rejects(repairPromoOnlyAudioSamplePreflight(db, { ...runtime,
      checkPreflight: async () => { checks++; return { verified: true,
        hasZeroServerId: true, serverCount: 1, supplierRequestCount: 3 }; }
    }), { code: /PROMOONLY_AUDIO_SAMPLE_(PREFLIGHT_REPAIR_NOT_ALLOWED|SOURCE_UNAVAILABLE)/ });
    assert.equal(checks, 0);
  }
});

test("unverified hosted preflight and CAS race retain the permanent lock", async () => {
  for (const proof of [
    { verified: false, hasZeroServerId: true, serverCount: 1, supplierRequestCount: 3 },
    { verified: true, hasZeroServerId: false, serverCount: 1, supplierRequestCount: 3 },
    { verified: true, hasZeroServerId: true, serverCount: 0, supplierRequestCount: 3 },
    { verified: true, hasZeroServerId: true, serverCount: 1, supplierRequestCount: 4 }
  ]) {
    const db = preflightLockedDb();
    const { runtime } = options(db);
    await assert.rejects(repairPromoOnlyAudioSamplePreflight(db, { ...runtime,
      checkPreflight: async () => proof
    }), { code: "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_VERIFIED" });
    assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
    assert.equal(db.state.audit.length, 1);
  }
  const db = preflightLockedDb();
  const { runtime } = options(db);
  const originalUpdate = db.musicDistributorTrack.updateMany;
  db.musicDistributorTrack.updateMany = async (args) =>
    args.where.lastImportErrorCode === "PROMOONLY_AUDIO_SAMPLE_SERVERS_INVALID"
      ? { count: 0 } : originalUpdate(args);
  await assert.rejects(repairPromoOnlyAudioSamplePreflight(db, { ...runtime,
    checkPreflight: async () => ({ verified: true, hasZeroServerId: true,
      serverCount: 1, supplierRequestCount: 3 })
  }), { code: "PROMOONLY_AUDIO_SAMPLE_PREFLIGHT_REPAIR_NOT_ALLOWED" });
  assert.equal(db.state.item.importState, "RECONCILIATION_REQUIRED");
  assert.equal(db.state.audit.length, 1);
});

test("private stream rechecks exact unapproved asset identity and withdrawal", async () => {
  const db = makeDb();
  const { runtime } = options(db);
  await importPromoOnlyAudioSample(db, runtime);
  for (const change of [
    () => { db.state.item.status = "TAKEN_DOWN"; },
    () => { db.state.stored.status = "READY"; },
    () => { db.state.stored.rightsReviewStatus = "APPROVED"; },
    () => { db.state.stored.mediaAsset.organisationId = "foreign-org"; },
    () => { db.state.stored.mediaAsset.storageKey = "catalogue/music/other.mp3"; },
    () => { db.state.stored.mediaAsset.sizeBytes = BigInt(50 * 1024 * 1024 + 1); },
    () => { db.state.stored.mediaAsset.mimeType = "audio/ogg"; },
    () => { db.state.item.sourceChecksumSha256 = "b".repeat(64); }
  ]) {
    const state = structuredClone(db.state);
    change();
    assert.equal(await resolvePromoOnlyAudioSampleAsset(db, runtime), null);
    Object.assign(db.state, state);
  }
});

test("private routes require preview-code owner, exact write origin and static no-selection stream", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const post = readFileSync(resolve(root, "app/api/admin/promo-only/audio-sample/route.js"), "utf8");
  const stream = readFileSync(resolve(root, "app/api/admin/promo-only/audio-sample/stream/route.js"), "utf8");
  for (const source of [post, stream]) {
    assert.match(source, /session\?\.authMethod !== "PREVIEW_CODE"/);
    assert.match(source, /isPrivatePreviewAdmin\(session\.user, policy\)/);
    assert.match(source, /"cache-control": "private, no-store"/);
    assert.match(source, /new URL\(request\.url\)\.search/);
  }
  assert.match(post, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(post, /sampleRequestBodyIsEmpty\(request\)/);
  assert.match(post, /limit: 2/);
  assert.doesNotMatch(post, /export async function GET/);
  assert.match(stream, /origin && origin !== policy\.previewOrigin/);
  assert.match(stream, /protectedAudioResponse\(request, asset\)/);
  assert.doesNotMatch(stream, /export async function POST/);
  assert.doesNotMatch(stream, /params\.trackId|presigned|signedUrl|publicR2Url/);
  const storage = readFileSync(resolve(root, "lib/catalogue-track-storage.js"), "utf8");
  assert.match(storage, /privateSampleStorage = null/);
  assert.match(storage, /sendStorageCommand\(r2\.client, new PutObjectCommand/);
  assert.match(storage, /sendStorageCommand\(r2\.client, new CopyObjectCommand/);
  assert.match(storage, /copyAttempted && !transactionAttempted && needsStorageWrite &&/);
  assert.match(storage, /!preexistingReadyAsset && finalStorageKey/);
  assert.match(storage, /AbortSignal\.timeout\(privateSampleStorage\.cleanupTimeoutMs\)/);
  const repair = readFileSync(resolve(root,
    "app/api/admin/promo-only/audio-sample/preflight-repair/route.js"), "utf8");
  assert.match(repair, /session\?\.authMethod !== "PREVIEW_CODE"/);
  assert.match(repair, /isPrivatePreviewAdmin\(session\.user, policy\)/);
  assert.match(repair, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(repair, /new URL\(request\.url\)\.search/);
  assert.match(repair, /sampleRequestBodyIsEmpty\(request\)/);
  assert.match(repair, /promo-only-audio-preflight-repair:/);
  assert.match(repair, /limit: 2/);
  assert.doesNotMatch(repair, /export async function GET/);
  const recover = readFileSync(resolve(root,
    "app/api/admin/promo-only/audio-sample/recover/route.js"), "utf8");
  assert.match(recover, /session\?\.authMethod !== "PREVIEW_CODE"/);
  assert.match(recover, /isPrivatePreviewAdmin\(session\.user, policy\)/);
  assert.match(recover, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(recover, /new URL\(request\.url\)\.search/);
  assert.match(recover, /sampleRequestBodyIsEmpty\(request\)/);
  assert.match(recover, /promo-only-audio-queue-recovery:/);
  assert.match(recover, /limit: 2/);
  assert.doesNotMatch(recover, /export async function GET|downloads\/queue/);
});
