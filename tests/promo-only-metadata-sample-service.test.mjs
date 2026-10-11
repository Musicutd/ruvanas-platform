import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mapPromoOnlyTrack } from "../lib/promo-only.mjs";
import { runPromoOnlyMetadataSample, sampleRequestBodyIsEmpty } from "../lib/promo-only-metadata-sample-service.js";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const ACTOR = "synthetic-preview-owner";
const CONFIG = Object.freeze({
  enabled: true, ready: true, manualOnly: true, mode: "METADATA", rssUrl: null,
  audioDownloadEnabled: false, allowHttpMediaTest: false, autoCreateGenres: false,
  genreReviewRequired: true, retryMax: 0
});
const TRACK = Object.freeze({
  id: 91, title: "Synthetic fixture recording", artist: "Synthetic fixture artist",
  releaseid: 55, media_type: 2, modified: 1_780_000_000,
  release: "Synthetic fixture release", genre: "Unmapped Fixture Genre"
});

function makeDb() {
  let state = { connection: null, releases: new Map(), tracks: new Map(), runs: [], audits: [],
    catalogueTrackWrites: 0, globalGenreWrites: 0 };
  let inTransaction = false;
  let failAudit = false;
  const transactionOptions = [];

  function tables(snapshot) {
    return {
      musicDistributorConnection: {
        findUnique: async ({ where }) => where.providerKey === "PROMO_ONLY" ? snapshot.connection : null,
        create: async ({ data }) => {
          if (snapshot.connection) throw new Error("Synthetic provider-key collision");
          snapshot.connection = { id: "connection-1", name: data.name, providerKey: data.providerKey,
            createdByUserId: data.createdByUserId, status: data.status,
            nextSyncAt: data.nextSyncAt, syncLeaseOwner: null, syncLeaseUntil: null,
            revokedAt: null, apiBaseUrl: data.apiBaseUrl, tokenUrl: data.tokenUrl,
            cataloguePath: data.cataloguePath, oauthScopes: data.oauthScopes,
            defaultMinimumCatalogueLevel: data.defaultMinimumCatalogueLevel,
            defaultPermittedTerritories: data.defaultPermittedTerritories,
            defaultPermittedUses: data.defaultPermittedUses, pausedAt: data.pausedAt,
            clientCredentialsEncrypted: data.clientCredentialsEncrypted,
            configuration: data.configuration };
          return snapshot.connection;
        }
      },
      musicDistributorTrack: {
        findUnique: async ({ where }) => snapshot.tracks.get(where.connectionId_externalTrackId.externalTrackId) || null,
        upsert: async ({ where, create, update }) => {
          const key = where.connectionId_externalTrackId.externalTrackId;
          const existing = snapshot.tracks.get(key);
          if (!existing) {
            const created = { id: `provider-track-${key}`, trackId: null, autoDjReady: false,
              sourceUrlEncrypted: null, revision: 1, ...create };
            snapshot.tracks.set(key, created);
            return created;
          }
          const revision = update.revision?.increment;
          Object.assign(existing, { ...update, ...(revision ? { revision: existing.revision + revision } : {}) });
          return existing;
        }
      },
      musicDistributorRelease: {
        upsert: async ({ where, create, update }) => {
          const key = where.connectionId_externalReleaseId.externalReleaseId;
          const existing = snapshot.releases.get(key);
          if (existing) { Object.assign(existing, update); return existing; }
          const created = { id: `release-${key}`, status: "ACTIVE", takenDownAt: null, ...create };
          snapshot.releases.set(key, created);
          return created;
        }
      },
      musicProviderGenreMapping: { findUnique: async () => null },
      mediaGenre: {
        findFirst: async () => null,
        create: async () => { snapshot.globalGenreWrites++; throw new Error("Global genre creation is forbidden"); }
      },
      track: {
        updateMany: async () => { snapshot.catalogueTrackWrites++; throw new Error("Catalogue Track writes are forbidden"); }
      },
      musicDistributorSyncRun: {
        create: async ({ data }) => {
          const run = { id: `run-${snapshot.runs.length + 1}`, ...data };
          snapshot.runs.push(run);
          return run;
        }
      },
      auditLog: {
        create: async ({ data }) => {
          if (failAudit) { failAudit = false; throw new Error("Synthetic audit write failure"); }
          snapshot.audits.push(data);
          return data;
        }
      }
    };
  }

  const db = {
    get state() { return state; },
    get transactionOptions() { return transactionOptions; },
    get inTransaction() { return inTransaction; },
    failOneAudit() { failAudit = true; },
    musicDistributorConnection: {
      findUnique: (...args) => tables(state).musicDistributorConnection.findUnique(...args)
    },
    async $transaction(operation, options) {
      transactionOptions.push(options);
      const snapshot = structuredClone(state);
      inTransaction = true;
      try {
        const result = await operation(tables(snapshot));
        state = snapshot;
        return result;
      } finally {
        inTransaction = false;
      }
    }
  };
  return db;
}

function sample(track = TRACK) {
  return { metadata: mapPromoOnlyTrack(track), requestCount: 4, releaseCount: 3 };
}

function options(db, track = TRACK) {
  return { actorUserId: ACTOR, config: CONFIG, now: NOW,
    encryptMarker: (value) => {
      assert.deepEqual(JSON.parse(value), { managedBy: "PROMOONLY_MANUAL_METADATA_SAMPLE_V1" });
      return "synthetic-encrypted-marker";
    },
    decryptMarker: (value) => {
      if (value !== "synthetic-encrypted-marker") throw new Error("Synthetic marker mismatch");
      return JSON.stringify({ managedBy: "PROMOONLY_MANUAL_METADATA_SAMPLE_V1" });
    },
    fetchSample: async () => {
      assert.equal(db.inTransaction, false, "supplier fetch must precede the DB-only transaction");
      return sample(track);
    } };
}

test("one manual sample imports once, remains paused and grants no audio or rights", async () => {
  const db = makeDb();
  const first = await runPromoOnlyMetadataSample(db, options(db));
  assert.deepEqual(first, { createdCount: 1, updatedCount: 0, unchangedCount: 0,
    requestCount: 4, releaseCount: 3, tracksReceived: 1, downloadedCount: 0 });
  assert.equal(db.state.connection.status, "PAUSED");
  assert.equal(db.state.connection.nextSyncAt, null);
  assert.deepEqual(db.state.connection.oauthScopes, ["catalogue.read"]);
  assert.deepEqual(db.state.connection.defaultPermittedUses, []);
  assert.equal(db.state.connection.clientCredentialsEncrypted, "synthetic-encrypted-marker");
  const row = db.state.tracks.get("91");
  assert.equal(row.importState, "METADATA_READY");
  assert.equal(row.audioStatus, "NOT_REQUESTED");
  assert.equal(row.trackId, null);
  assert.equal(row.autoDjReady, false);
  assert.deepEqual(row.permittedTerritories, []);
  assert.deepEqual(row.permittedUses, []);
  assert.equal(db.state.catalogueTrackWrites, 0);
  assert.equal(db.state.globalGenreWrites, 0);
  assert.equal(db.state.runs[0].trigger, "MANUAL_API_SAMPLE");
  assert.equal(db.state.runs[0].mode, "METADATA_SAMPLE");
  assert.equal(db.state.runs[0].downloadedCount, 0);
  assert.deepEqual(db.transactionOptions.map((value) => value.isolationLevel), ["Serializable"]);
  assert.equal(db.state.audits.length, 1);

  const second = await runPromoOnlyMetadataSample(db, options(db));
  assert.equal(second.unchangedCount, 1);
  assert.equal(second.createdCount, 0);
  assert.equal(db.state.tracks.size, 1);
  assert.equal(db.state.tracks.get("91").revision, 1);
  assert.equal(db.state.runs.length, 2);
  assert.equal(db.state.connection.nextSyncAt, null);
});

test("metadata change preserves an existing takedown and reviewed scopes", async () => {
  const db = makeDb();
  await runPromoOnlyMetadataSample(db, options(db));
  const row = db.state.tracks.get("91");
  row.status = "TAKEN_DOWN";
  row.takenDownAt = NOW;
  row.minimumCatalogueLevel = "PREMIUM";
  row.permittedTerritories = ["MT"];
  row.permittedUses = ["ONLINE_RADIO"];
  row.rightsReference = "synthetic-reviewed-reference";
  const changed = await runPromoOnlyMetadataSample(db, options(db, {
    ...TRACK, title: "Synthetic fixture recording, amended", modified: 1_780_000_100
  }));
  assert.equal(changed.updatedCount, 1);
  const after = db.state.tracks.get("91");
  assert.equal(after.status, "TAKEN_DOWN");
  assert.deepEqual(after.permittedTerritories, ["MT"]);
  assert.deepEqual(after.permittedUses, ["ONLINE_RADIO"]);
  assert.equal(after.rightsReference, "synthetic-reviewed-reference");
  assert.equal(after.minimumCatalogueLevel, "PREMIUM");
  assert.equal(after.trackId, null);
  assert.equal(db.state.catalogueTrackWrites, 0);
});

test("legacy, scheduled, foreign-owner or altered manual connections fail before supplier fetch", async () => {
  const db = makeDb();
  await runPromoOnlyMetadataSample(db, options(db));
  for (const change of [
    { status: "ACTIVE" }, { nextSyncAt: NOW }, { createdByUserId: "different-owner" },
    { oauthScopes: ["catalogue.read", "download.test"] },
    { clientCredentialsEncrypted: "wrong-marker" },
    { configuration: { managedBy: "PROMOONLY_ENVIRONMENT", manualOnly: true, rssConfigured: false, productionLocked: true } }
  ]) {
    const original = structuredClone(db.state.connection);
    Object.assign(db.state.connection, change);
    let fetched = 0;
    await assert.rejects(runPromoOnlyMetadataSample(db, {
      ...options(db), fetchSample: async () => { fetched++; return sample(); }
    }), { code: "PROMOONLY_SAMPLE_CONNECTION_CONFLICT" });
    assert.equal(fetched, 0);
    Object.assign(db.state.connection, original);
  }
  assert.equal(db.state.runs.length, 1);
});

test("supplier failure, invalid sample, linked media and audit failure leave no partial import", async () => {
  const db = makeDb();
  await assert.rejects(runPromoOnlyMetadataSample(db, {
    ...options(db), fetchSample: async () => { throw Object.assign(new Error("Synthetic provider unavailable"), { code: "PROMOONLY_API_NETWORK" }); }
  }), { code: "PROMOONLY_API_NETWORK" });
  assert.equal(db.state.connection, null);
  await assert.rejects(runPromoOnlyMetadataSample(db, {
    ...options(db), fetchSample: async () => ({ ...sample(), requestCount: 5 })
  }), { code: "PROMOONLY_SAMPLE_RESPONSE_INVALID" });
  assert.equal(db.state.connection, null);

  db.failOneAudit();
  await assert.rejects(runPromoOnlyMetadataSample(db, options(db)), /Synthetic audit write failure/);
  assert.equal(db.state.connection, null);
  assert.equal(db.state.tracks.size, 0);
  assert.equal(db.state.runs.length, 0);

  await runPromoOnlyMetadataSample(db, options(db));
  db.state.tracks.get("91").trackId = "customer-owned-media";
  const before = structuredClone(db.state);
  await assert.rejects(runPromoOnlyMetadataSample(db, options(db, {
    ...TRACK, title: "Provider changed", modified: 1_780_000_200
  })), { code: "PROMOONLY_SAMPLE_MEDIA_EXISTS" });
  assert.deepEqual(db.state, before);
});

test("native empty POST streams are accepted but bytes, advertised data and a stalled stream are not", async () => {
  const url = "https://private-preview.example.test/api/admin/promo-only/metadata-sample";
  assert.equal(await sampleRequestBodyIsEmpty(new Request(url, { method: "POST" })), true);
  const emptyStream = new ReadableStream({ start(controller) { controller.close(); } });
  assert.equal(await sampleRequestBodyIsEmpty(new Request(url, {
    method: "POST", body: emptyStream, duplex: "half"
  })), true);
  assert.equal(await sampleRequestBodyIsEmpty(new Request(url, { method: "POST", body: "x" })), false);
  assert.equal(await sampleRequestBodyIsEmpty(new Request(url, {
    method: "POST", headers: { "content-length": "1" }
  })), false);
  const stalled = new ReadableStream({});
  assert.equal(await sampleRequestBodyIsEmpty(new Request(url, {
    method: "POST", body: stalled, duplex: "half"
  }), { timeoutMs: 20 }), false);
});

test("route is preview-code owner only, exact-origin, no-body, actor-rate-limited and POST-only", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(resolve(root, "app/api/admin/promo-only/metadata-sample/route.js"), "utf8");
  assert.match(source, /request\.headers\.get\("origin"\) !== policy\.previewOrigin/);
  assert.match(source, /session\?\.authMethod !== "PREVIEW_CODE"/);
  assert.match(source, /isPrivatePreviewAdmin\(session\.user, policy\)/);
  assert.match(source, /sampleRequestBodyIsEmpty\(request\)/);
  assert.match(source, /limit: 2, windowMs: HOUR_MS/);
  assert.match(source, /"cache-control": "private, no-store"/);
  assert.doesNotMatch(source, /export async function GET/);
  assert.doesNotMatch(source, /fetchPromoOnlyRss|runPromoOnlySync|queueDownload/);
});
