import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPromoOnlyTrack } from "../lib/promo-only.mjs";
import { runPromoOnlyMetadataBatch } from "../lib/promo-only-metadata-batch-service.js";

const ACTOR = "fixture-owner";
const NOW = new Date("2026-10-14T12:00:00.000Z");
const CONFIG = Object.freeze({ enabled: true, ready: true, manualOnly: true, mode: "METADATA",
  audioDownloadEnabled: false, allowHttpMediaTest: false, autoCreateGenres: false,
  genreReviewRequired: true, retryMax: 0, rssUrl: null });
const MARKER = JSON.stringify({ managedBy: "PROMOONLY_MANUAL_METADATA_SAMPLE_V1" });

function matches(row, conditions) {
  return Object.entries(conditions).every(([key, value]) => {
    if (key === "OR") return value.some(item => matches(row, item));
    if (value && typeof value === "object") {
      if (Object.hasOwn(value, "not")) return value.not === null ? row[key] != null : row[key] !== value.not;
      if (Object.hasOwn(value, "gt")) return row[key] > value.gt;
    }
    return row[key] === value;
  });
}
function makeDb() {
  let state = { users: new Map([[ACTOR, { id: ACTOR, role: "SUPER_ADMIN" }]]),
    connection: null, tracks: new Map(), releases: new Map(), runs: [], audits: [],
    releaseWrites: 0, globalGenreWrites: 0, mediaWrites: 0 };
  let inTransaction = false, failAudit = false, failTrackAt = 0, trackWrites = 0;
  const transactionOptions = [];
  function tables(s) {
    return {
      user: { findUnique: async ({ where }) => s.users.get(where.id) || null },
      musicDistributorConnection: {
        findUnique: async ({ where }) => where.providerKey === "PROMO_ONLY" ? s.connection : null,
        create: async ({ data }) => {
          assert.equal(s.connection, null);
          s.connection = { id: "fixture-connection", revokedAt: null,
            syncLeaseOwner: null, syncLeaseUntil: null, ...data };
          return s.connection;
        }
      },
      musicDistributorTrack: {
        findUnique: async ({ where }) => s.tracks.get(where.connectionId_externalTrackId.externalTrackId) || null,
        findFirst: async ({ where }) => [...s.tracks.values()].find(row => matches(row, where)) || null,
        upsert: async ({ where, create, update }) => {
          trackWrites++;
          if (failTrackAt && trackWrites === failTrackAt) throw Error("Synthetic track failure");
          const key = where.connectionId_externalTrackId.externalTrackId;
          const row = s.tracks.get(key);
          if (row) {
            const revision = update.revision?.increment;
            Object.assign(row, update, revision ? { revision: row.revision + revision } : {});
            return row;
          }
          const fresh = { id: `fixture-track-${key}`, trackId: null, sourceUrlEncrypted: null,
            autoDjReady: false, revision: 1, downloadRetryCount: 0, lastImportErrorCode: null,
            sourceChecksumSha256: null, sourceMimeType: null, sourceSizeBytes: null, ...create };
          s.tracks.set(key, fresh); return fresh;
        }
      },
      musicDistributorRelease: {
        findUnique: async ({ where }) => s.releases.get(where.connectionId_externalReleaseId.externalReleaseId) || null,
        upsert: async ({ where, create, update }) => {
          s.releaseWrites++;
          const key = where.connectionId_externalReleaseId.externalReleaseId;
          const row = s.releases.get(key);
          if (row) { Object.assign(row, update); return row; }
          const fresh = { id: `fixture-release-${key}`, status: "ACTIVE", takenDownAt: null, ...create };
          s.releases.set(key, fresh); return fresh;
        }
      },
      musicProviderGenreMapping: { findUnique: async () => null },
      mediaGenre: { findFirst: async () => null, create: async () => { s.globalGenreWrites++; throw Error("Genre write forbidden"); } },
      track: { updateMany: async () => { s.mediaWrites++; throw Error("Media write forbidden"); } },
      musicDistributorSyncRun: { create: async ({ data }) => {
        const row = { id: `fixture-run-${s.runs.length + 1}`, ...data }; s.runs.push(row); return row;
      } },
      auditLog: { create: async ({ data }) => {
        if (failAudit) { failAudit = false; throw Error("Synthetic audit failure"); }
        s.audits.push(data); return data;
      } }
    };
  }
  return {
    get state() { return state; }, get inTransaction() { return inTransaction; }, transactionOptions,
    failOneAudit() { failAudit = true; }, failSecondTrack() { failTrackAt = trackWrites + 2; },
    user: { findUnique: (...args) => tables(state).user.findUnique(...args) },
    musicDistributorConnection: { findUnique: (...args) => tables(state).musicDistributorConnection.findUnique(...args) },
    async $transaction(operation, options) {
      transactionOptions.push(options); const snapshot = structuredClone(state); inTransaction = true;
      try { const result = await operation(tables(snapshot)); state = snapshot; return result; }
      finally { inTransaction = false; }
    }
  };
}
function metadata(id, changes = {}) {
  return mapPromoOnlyTrack({ id, releaseid: 55, media_type: 2, title: `Synthetic track ${id}`,
    artist: "Synthetic artist", release: "Synthetic release", genre: "Unknown synthetic genre",
    modified: 1_780_000_000, ...changes });
}
function batch(ids = [91, 92], changes = {}) {
  return { metadata: ids.map(id => metadata(id)), requestCount: ids.length + 3,
    releaseCount: 3, selectedReleaseId: "55", truncatedCount: 0, ...changes };
}
function options(db, result = batch()) {
  return { actorUserId: ACTOR, config: CONFIG, now: NOW,
    encryptMarker: value => { assert.equal(value, MARKER); return "fixture-encrypted-marker"; },
    decryptMarker: value => { assert.equal(value, "fixture-encrypted-marker"); return MARKER; },
    fetchBatch: async (_config, fetchOptions) => {
      assert.equal(db.inTransaction, false);
      assert.equal(fetchOptions.now, Date.now, "Network clock must remain live, not transaction timestamp");
      return result;
    } };
}

test("manual batch stores metadata only, pauses connection and repeats without duplicates or revisions", async () => {
  const db = makeDb();
  const first = await runPromoOnlyMetadataBatch(db, options(db));
  assert.equal(first.createdCount, 2); assert.equal(first.skippedCount, 0);
  assert.equal(first.downloadedCount, 0); assert.equal(db.state.connection.status, "PAUSED");
  assert.equal(db.state.connection.nextSyncAt, null);
  assert.deepEqual(db.state.connection.oauthScopes, ["catalogue.read"]);
  assert.deepEqual(db.state.connection.defaultPermittedTerritories, []);
  for (const row of db.state.tracks.values()) {
    assert.equal(row.audioStatus, "NOT_REQUESTED"); assert.equal(row.trackId, null);
    assert.equal(row.autoDjReady, false); assert.deepEqual(row.permittedUses, []);
  }
  assert.equal(db.state.globalGenreWrites, 0); assert.equal(db.state.mediaWrites, 0);
  assert.equal(db.state.runs[0].trigger, "MANUAL_API_BATCH");
  assert.equal(db.state.runs[0].mode, "METADATA_BATCH");
  assert.equal(db.state.runs[0].downloadedCount, 0);
  assert.equal(db.state.audits[0].details.queueMutated, false);
  const again = await runPromoOnlyMetadataBatch(db, options(db));
  assert.equal(again.unchangedCount, 2); assert.equal(again.createdCount, 0);
  assert.equal(db.state.tracks.size, 2); assert.equal(db.state.tracks.get("91").revision, 1);
  assert.deepEqual(db.transactionOptions, [
    { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 },
    { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 }
  ]);
});

test("protected queued and linked rows and their shared release remain untouched while neighbour imports", async () => {
  const db = makeDb(); await runPromoOnlyMetadataBatch(db, options(db));
  Object.assign(db.state.tracks.get("91"), { audioStatus: "SAMPLE_CLAIMED", importState: "RECONCILIATION_REQUIRED",
    downloadRetryCount: 1, lastImportErrorCode: "TLS_LEAF_UNVERIFIED" });
  Object.assign(db.state.tracks.get("92"), { trackId: "fixture-linked-audio" });
  db.state.connection.configuration.recovery = { locked: true, queueTime: "synthetic" };
  const queued = structuredClone(db.state.tracks.get("91")), linked = structuredClone(db.state.tracks.get("92"));
  const release = structuredClone(db.state.releases.get("55")), connection = structuredClone(db.state.connection);
  const result = await runPromoOnlyMetadataBatch(db, options(db, batch([91, 92, 93], {
    metadata: [metadata(91), metadata(92), metadata(93, { release: "Amended shared release" })]
  })));
  assert.equal(result.createdCount, 1); assert.equal(result.skippedCount, 2);
  assert.equal(result.protectedReleasePreserved, true); assert.equal(db.state.runs.at(-1).rejectedCount, 2);
  assert.deepEqual(db.state.tracks.get("91"), queued); assert.deepEqual(db.state.tracks.get("92"), linked);
  assert.deepEqual(db.state.releases.get("55"), release); assert.deepEqual(db.state.connection, connection);
  assert.equal(db.state.tracks.get("93").releaseId, release.id); assert.equal(db.state.mediaWrites, 0);
});

test("protected neighbour outside selected tracks still freezes its shared release", async () => {
  const db = makeDb(); await runPromoOnlyMetadataBatch(db, options(db, batch([91])));
  db.state.tracks.get("91").sourceUrlEncrypted = "fixture-encrypted-source";
  const release = structuredClone(db.state.releases.get("55"));
  const result = await runPromoOnlyMetadataBatch(db, options(db, batch([92], {
    metadata: [metadata(92, { release: "Must not alter protected release", label: "Changed label" })]
  })));
  assert.equal(result.createdCount, 1); assert.equal(result.protectedReleasePreserved, true);
  assert.deepEqual(db.state.releases.get("55"), release);
});

test("every queued/recovery/media sentinel protects an existing row from generic upsert reset", async () => {
  for (const changes of [{ importState: "SAMPLE_CLAIMED" }, { audioStatus: "FAILED_RETRYABLE" },
    { autoDjReady: true }, { downloadRetryCount: 1 }, { lastImportErrorCode: "RECOVERY_LOCKED" },
    { sourceChecksumSha256: "a".repeat(64) }, { sourceMimeType: "audio/mpeg" }, { sourceSizeBytes: 1n }]) {
    const db = makeDb(); await runPromoOnlyMetadataBatch(db, options(db, batch([91])));
    Object.assign(db.state.tracks.get("91"), changes);
    const row = structuredClone(db.state.tracks.get("91"));
    const result = await runPromoOnlyMetadataBatch(db, options(db, batch([91], { metadata: [metadata(91, { title: "Amended" })] })));
    assert.equal(result.skippedCount, 1); assert.deepEqual(db.state.tracks.get("91"), row);
  }
});

test("missing/non-admin actor, scheduled and foreign-owner connections fail before supplier fetch", async () => {
  const db = makeDb(); let calls = 0;
  const fetchBatch = async () => { calls++; return batch(); };
  for (const actorUserId of ["", "missing", "viewer"]) {
    db.state.users.set("viewer", { id: "viewer", role: "VIEWER" });
    await assert.rejects(runPromoOnlyMetadataBatch(db, { ...options(db), actorUserId, fetchBatch }), { code: "PROMOONLY_BATCH_ACTOR_REQUIRED" });
  }
  assert.equal(calls, 0);
  await runPromoOnlyMetadataBatch(db, options(db));
  for (const change of [{ status: "ACTIVE" }, { nextSyncAt: NOW }, { createdByUserId: "foreign-owner" },
    { oauthScopes: ["catalogue.read", "download.test"] }, { clientCredentialsEncrypted: "foreign-marker" }]) {
    const original = structuredClone(db.state.connection); Object.assign(db.state.connection, change);
    await assert.rejects(runPromoOnlyMetadataBatch(db, { ...options(db), fetchBatch }), { code: "PROMOONLY_SAMPLE_CONNECTION_CONFLICT" });
    assert.equal(calls, 0); db.state.connection = original;
  }
});

test("25-track cap and identities are validated before any storage transaction", async () => {
  for (const invalid of [batch(Array.from({ length: 26 }, (_, i) => 100 + i)),
    batch([91], { selectedReleaseId: "99" }), batch([91, 91]), batch([91], { requestCount: 99 }),
    batch([91], { truncatedCount: -1 }), batch([], { requestCount: 3 })]) {
    const db = makeDb();
    await assert.rejects(runPromoOnlyMetadataBatch(db, options(db, invalid)), { code: "PROMOONLY_BATCH_RESPONSE_INVALID" });
    assert.equal(db.state.connection, null); assert.equal(db.transactionOptions.length, 0);
  }
  const db = makeDb(); const result = await runPromoOnlyMetadataBatch(db,
    options(db, batch(Array.from({ length: 25 }, (_, i) => 100 + i), { truncatedCount: 7 })));
  assert.equal(result.createdCount, 25); assert.equal(result.requestCount, 28); assert.equal(result.truncatedCount, 7);
});

test("supplier, intermediate storage and audit failures cannot leave a partial import", async () => {
  const db = makeDb(); const before = structuredClone(db.state);
  await assert.rejects(runPromoOnlyMetadataBatch(db, { ...options(db), fetchBatch: async () => { throw Error("Synthetic supplier failure"); } }), /Synthetic supplier failure/);
  assert.deepEqual(db.state, before);
  db.failSecondTrack();
  await assert.rejects(runPromoOnlyMetadataBatch(db, options(db)), /Synthetic track failure/);
  assert.deepEqual(db.state, before);
  db.failOneAudit();
  await assert.rejects(runPromoOnlyMetadataBatch(db, options(db)), /Synthetic audit failure/);
  assert.deepEqual(db.state, before);
});
