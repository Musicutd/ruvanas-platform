import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  assertPromoOnlyDownloadAuthority,
  mapPromoOnlyTrack,
  normalizePromoOnlyGenre,
  parsePromoOnlyRss,
  promoOnlyDownloadDecision,
  readPromoOnlyConfig,
  safePromoOnlyConfig
} from "../lib/promo-only.mjs";
import { PromoOnlyApiClient, PromoOnlyTokenManager } from "../lib/promo-only-client.mjs";
import { runPromoOnlySync } from "../lib/promo-only-service.js";
import { syncPromoOnlyGenre } from "../lib/provider-genre-service.js";
import { musicTrackEligibility } from "../lib/media-library-pro.mjs";
import { studioQueueReadiness } from "../lib/studio-playout.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const config = { enabled: true, mode: "AUDIO_TEST", audioDownloadEnabled: true, userId: "test-user", apiKey: "key", apiSecret: "secret", requestTimeoutMs: 5000, retryMax: 0, maxAudioBytes: 1000, downloadHosts: ["media.example.test"] };

test("disabled defaults, production lock, safe diagnostics and download gate", () => {
  assert.equal(readPromoOnlyConfig({}).mode, "OFF");
  assert.throws(() => readPromoOnlyConfig({ PROMOONLY_ENABLED: "true", PROMOONLY_MODE: "PRODUCTION" }), { code: "PROMOONLY_PRODUCTION_LOCKED" });
  assert.equal(promoOnlyDownloadDecision({ config, actorRole: "SUBSCRIBER", entitlementAccepted: true }).reason, "PROMOONLY_SUPER_ADMIN_REQUIRED");
  for (const actorRole of ["CLIENT_ADMIN", "PILLAR_ADMIN", "DJ", "PRESENTER", "SCHOOL_ADMIN", "ORGANISATION_OWNER", "USER"]) {
    assert.equal(promoOnlyDownloadDecision({ config, actorRole, entitlementAccepted: true }).allowed, false);
  }
  assert.equal(promoOnlyDownloadDecision({ config, actorRole: "SUPER_ADMIN", entitlementAccepted: false }).reason, "PROMOONLY_ENTITLEMENT_REQUIRED");
  assert.equal(promoOnlyDownloadDecision({ config: { ...config, mode: "METADATA" }, actorRole: "SUPER_ADMIN", entitlementAccepted: true }).allowed, false);
  assert.equal(promoOnlyDownloadDecision({ config, actorRole: "SUPER_ADMIN", entitlementAccepted: true }).allowed, true);
  const safe = safePromoOnlyConfig({ ...config, rssUrl: "https://example.test/rss" });
  assert.equal("apiKey" in safe, false);
  assert.equal("apiSecret" in safe, false);
  assert.equal("rssUrl" in safe, false);
  assert.equal(safe.allowHttpMediaTest, false);
});

test("RSS handles entities, namespaces, repeated items, invalid XML and DTD refusal", () => {
  const xml = `<?xml version="1.0"?><rss xmlns:po="https://example.test/ns"><channel><item><guid>first</guid><title>R&amp;B Mix</title><po:trackid>91</po:trackid><category>R&amp;B</category></item><item><guid>second</guid><title>Dance</title><po:releaseid>55</po:releaseid></item></channel></rss>`;
  const [first, second] = parsePromoOnlyRss(xml);
  assert.equal(first.title, "R&B Mix");
  assert.equal(first.category, "R&B");
  assert.equal(first.trackId, "91");
  assert.equal(second.releaseId, "55");
  assert.equal(parsePromoOnlyRss(xml)[0].idempotencyKey, first.idempotencyKey);
  assert.equal(normalizePromoOnlyGenre(first.category), "r&b");
  assert.throws(() => parsePromoOnlyRss("<!DOCTYPE rss [<!ENTITY x SYSTEM 'file:///secret'>]><rss/>") , { code: "PROMOONLY_RSS_UNSAFE_XML" });
  assert.throws(() => parsePromoOnlyRss("<rss><item>"), { code: "PROMOONLY_RSS_INVALID_XML" });
  assert.throws(() => parsePromoOnlyRss(xml, { maxBytes: 50 }), { code: "PROMOONLY_RSS_TOO_LARGE" });
});

test("provider metadata retains identifiers, mix, BPM, genre and content warning", () => {
  const mapped = mapPromoOnlyTrack({ trackid: 91, title: "Example", artist: "Singer", titleid: 22, releaseid: 55, genre: "R&B", bpm: 121, mix: "Radio Edit", duration: "3:20", explicit: true, content_warning: "Strong language", isrc: "USABC2500001" });
  assert.deepEqual([mapped.externalTrackId, mapped.externalTitleId, mapped.externalReleaseId, mapped.sourceGenre], ["91", "22", "55", "R&B"]);
  assert.deepEqual([mapped.mixName, mapped.bpm, mapped.durationSeconds, mapped.contentWarning, mapped.isExplicit], ["Radio Edit", 121, 200, "Strong language", true]);
  assert.throws(() => mapPromoOnlyTrack({ trackid: 1, title: "No artist" }), { code: "PROMOONLY_METADATA_INCOMPLETE" });
});

test("token refresh uses the official Basic and Bearer forms without exposing secrets", async () => {
  let clock = 1_000_000;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ token: `token-${calls.length}`, expires: Math.floor(clock / 1000) + 60 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const manager = new PromoOnlyTokenManager(config, { fetchImpl, now: () => clock });
  assert.equal(await manager.getToken(), "token-1");
  assert.equal(await manager.getToken(), "token-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.authorization, `Basic ${Buffer.from("key:secret").toString("base64")}`);
  assert.equal(String(calls[0].options.body), "userid=test-user");
  clock += 31_000;
  assert.equal(await manager.getToken(), "token-2");
  const client = new PromoOnlyApiClient(config, { fetchImpl, tokenManager: manager });
  await client.track("123");
  assert.equal(calls[2].options.headers.authorization, `Bearer ${Buffer.from("test-user:token-2").toString("base64")}`);
  assert.match(calls[2].url, /\/track\/123$/);
});

test("media download rejects unknown host before any outbound request", async () => {
  let fetched = 0;
  const client = new PromoOnlyApiClient(config, { fetchImpl: async () => { fetched++; throw new Error("must not fetch"); }, tokenManager: { getToken: async () => "token" } });
  await assert.rejects(() => client.downloadQueuedMedia({ trackid: 91, dl_token: "grant", servers: ["127.0.0.1"] }), { code: "PROMOONLY_DOWNLOAD_HOST_DENIED" });
  assert.equal(fetched, 0);
});

test("queued audio requires a matching server ID before fetching and reporting success", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/download/server/91")) return new Response(JSON.stringify([{ host: "dc03.promoonly.com", id: 7 }]), { headers: { "content-type": "application/json" } });
    if (String(url).includes("/pool/v5/download/")) return new Response(new Uint8Array([0x49, 0x44, 0x33, 0, 0]), { headers: { "content-type": "audio/mpeg", "content-disposition": 'attachment; filename="sample.mp3"' } });
    return new Response(JSON.stringify({ result: "ok" }), { headers: { "content-type": "application/json" } });
  };
  const client = new PromoOnlyApiClient(config, { fetchImpl, tokenManager: { getToken: async () => "test-token" } });
  const audio = await client.downloadQueuedMedia({ trackid: 91, dl_token: "grant", servers: ["dc03.promoonly.com"] });
  assert.equal(audio.serverId, 7);
  assert.equal(audio.fileName, "sample.mp3");
  assert.equal(calls[1].url, "https://dc03.promoonly.com/pool/v5/download/grant");
  await client.confirmDownload({ trackid: 91, serverid: audio.serverId, dl_token: "grant" });
  assert.equal(calls[2].url, "https://api.promoonly.com/download/success");
  assert.equal(String(calls[2].options.body), "trackid=91&serverid=7&dl_token=grant");
});

test("plain HTTP media is rejected by default before a provider-server request", async () => {
  let fetched = 0;
  const client = new PromoOnlyApiClient(config, { fetchImpl: async () => { fetched++; throw new Error("unexpected request"); } });
  await assert.rejects(() => client.downloadQueuedMedia({ trackid: 91, dl_token: "grant", servers: ["http://dc03.promoonly.com"] }), { code: "PROMOONLY_MEDIA_HTTPS_REQUIRED" });
  assert.equal(fetched, 0);
});

test("HTTP media requires an explicit server-only testing exception", async () => {
  const calls = [];
  const client = new PromoOnlyApiClient({ ...config, allowHttpMediaTest: true }, {
    tokenManager: { getToken: async () => "test-token" },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/download/server/")) return new Response(JSON.stringify([{ id: 7, host: "dc03.promoonly.com" }]), { headers: { "content-type": "application/json" } });
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0, 0]), { headers: { "content-type": "audio/mpeg" } });
    }
  });
  const result = await client.downloadQueuedMedia({ trackid: 91, dl_token: "grant", servers: ["dc03.promoonly.com"] });
  assert.equal(result.serverId, 7);
  assert.equal(calls[1], "http://dc03.promoonly.com/pool/v5/download/grant");
});

test("subscriber import is rejected and the service checks before database access", () => {
  assert.throws(() => assertPromoOnlyDownloadAuthority({ config, actorRole: "SUBSCRIBER", entitlementAccepted: true }), { code: "PROMOONLY_SUPER_ADMIN_REQUIRED" });
  const service = read("lib/promo-only-download-service.js");
  assert.ok(service.indexOf("assertPromoOnlyDownloadAuthority({ config, actorRole") < service.indexOf("await db.musicDistributorTrack.findUnique"));
  assert.throws(() => assertPromoOnlyDownloadAuthority({ config: { ...config, audioDownloadEnabled: false }, actorRole: "SUPER_ADMIN", entitlementAccepted: true }), { code: "PROMOONLY_AUDIO_DOWNLOAD_DISABLED" });
});

test("provider track is tier-gated and fails closed if provider relationship is absent", () => {
  const asset = { id: "media", status: "READY", mediaType: "MUSIC", libraryType: "RUVANAS_CATALOGUE", organisationId: null, licensedCatalogue: true, genres: [{ mediaGenre: { slug: "pop", name: "Pop" } }] };
  const item = { status: "ACTIVE", autoDjReady: true, canonicalGenre: { active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED" } };
  const track = { status: "READY", mediaAsset: asset, catalogueProvider: "PROMO_ONLY", rightsReference: "contract-123", rightsReviewStatus: "APPROVED", permittedUses: ["ONLINE_RADIO"], permittedTerritories: "WORLDWIDE", minimumCatalogueLevel: "PROFESSIONAL", distributorItems: [item] };
  const options = { requiredUse: "ONLINE_RADIO", licensedCatalogueLevel: "FOCUSED" };
  assert.equal(musicTrackEligibility(track, options).reason, "CATALOGUE_TIER_REQUIRED");
  assert.equal(musicTrackEligibility(track, { ...options, licensedCatalogueLevel: "PROFESSIONAL" }).playable, true);
  assert.equal(musicTrackEligibility({ ...track, distributorItems: undefined }, { ...options, licensedCatalogueLevel: "PROFESSIONAL" }).playable, false);
  assert.equal(musicTrackEligibility({ ...track, distributorItems: [{ ...item, autoDjReady: false }] }, { ...options, licensedCatalogueLevel: "PROFESSIONAL" }).playable, false);
  const premium = { ...track, minimumCatalogueLevel: "FOCUSED", mediaAsset: { ...asset, genres: [{ mediaGenre: { slug: "r-and-b", name: "R&B" } }] }, distributorItems: [{ ...item, canonicalGenre: { active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "PREMIUM", slug: "r-and-b", name: "R&B" } }] };
  assert.equal(musicTrackEligibility(premium, { ...options, licensedCatalogueLevel: "PROFESSIONAL" }).playable, false);
  assert.equal(musicTrackEligibility(premium, { ...options, licensedCatalogueLevel: "PREMIUM" }).playable, true);
  assert.equal(musicTrackEligibility({ ...premium, permittedTerritories: "MT" }, { ...options, licensedCatalogueLevel: "PREMIUM" }).reason, "TERRITORY_REQUIRED");
  assert.equal(studioQueueReadiness({ ...asset, track }, { licensedMusicCatalogueEnabled: true, licensedMusicCatalogueLevel: "FOCUSED" }).ready, false);
  assert.equal(studioQueueReadiness({ ...asset, track }, { licensedMusicCatalogueEnabled: true, licensedMusicCatalogueLevel: "PROFESSIONAL" }).ready, true);
  assert.equal(studioQueueReadiness({ ...asset, track: { ...track, rightsReviewStatus: "DRAFT" } }, { licensedMusicCatalogueEnabled: true, licensedMusicCatalogueLevel: "PREMIUM" }).ready, false);
});

test("RSS discovery is idempotent and a later METADATA mode enriches the same item once", async () => {
  const feed = new Map();
  const tracks = new Map();
  const genre = { id: "genre-1", name: "R&B", slug: "r-and-b", active: true, providerReviewStatus: "APPROVED" };
  let mapping = null;
  let metadataCalls = 0;
  let protectedStatus = "READY";
  let providerTitle = "Example";
  const connection = { id: "connection", providerKey: "PROMO_ONLY", createdByUserId: "admin", configuration: {}, defaultMinimumCatalogueLevel: "FOCUSED", defaultPermittedTerritories: ["WORLDWIDE"], defaultPermittedUses: ["ONLINE_RADIO"], syncCursor: null };
  const db = {
    musicDistributorConnection: { findUnique: async () => connection, update: async ({ data }) => Object.assign(connection, data) },
    musicDistributorSyncRun: { create: async () => ({ id: `run-${Math.random()}` }), update: async () => ({}) },
    musicProviderFeedItem: {
      findUnique: async ({ where }) => feed.get(where.connectionId_idempotencyKey.idempotencyKey) || null,
      upsert: async ({ where, create, update }) => {
        const key = where.connectionId_idempotencyKey.idempotencyKey;
        const prior = feed.get(key);
        const value = prior ? { ...prior, ...update } : { id: key, ...create, lastSeenAt: new Date() };
        feed.set(key, value); return value;
      },
      update: async ({ where, data }) => { const value = { ...feed.get(where.id), ...data }; feed.set(where.id, value); return value; },
      findMany: async ({ where }) => [...feed.values()].filter((item) => where.status.in.includes(item.status))
    },
    musicProviderGenreMapping: { findUnique: async () => mapping, create: async ({ data }) => { mapping = { ...data, catalogGenre: genre }; return mapping; } },
    mediaGenre: { findFirst: async () => genre },
    musicDistributorTrack: {
      findUnique: async ({ where }) => tracks.get(where.connectionId_externalTrackId.externalTrackId) || null,
      upsert: async ({ where, create, update }) => {
        const key = where.connectionId_externalTrackId.externalTrackId;
        const value = tracks.has(key) ? { ...tracks.get(key), ...update } : { id: "provider-track", ...create };
        tracks.set(key, value); return value;
      }
    },
    track: { update: async ({ data }) => { protectedStatus = data.status; return {}; } },
    auditLog: { create: async () => ({}) },
    $transaction: async (operations) => Promise.all(operations)
  };
  let xml = "<rss><channel><item><guid>item-91</guid><title>Example</title><trackid>91</trackid></item></channel></rss>";
  const fetchImpl = async () => new Response(xml, { headers: { "content-type": "application/rss+xml" } });
  const common = { actorUserId: "admin", fetchImpl, clientFactory: () => ({ track: async () => { metadataCalls++; return { trackid: 91, title: providerTitle, artist: "Singer", genre: "R&B", mix: "Clean", bpm: 120 }; } }) };
  const discovery = { ...config, mode: "DISCOVERY", pollMinutes: 30, rssUrl: "https://example.test/rss", maxRssBytes: 2048, autoCreateGenres: true, genreReviewRequired: false };
  await runPromoOnlySync(db, { ...common, config: discovery });
  assert.equal(feed.size, 1);
  assert.equal(metadataCalls, 0);
  await runPromoOnlySync(db, { ...common, config: { ...discovery, mode: "METADATA" } });
  assert.equal(metadataCalls, 1);
  assert.equal(tracks.size, 1);
  assert.equal(tracks.get("91").sourceGenre, "R&B");
  assert.equal(mapping.catalogGenreId, genre.id);
  await runPromoOnlySync(db, { ...common, config: { ...discovery, mode: "METADATA" } });
  assert.equal(metadataCalls, 1);
  assert.equal(tracks.size, 1);
  tracks.get("91").trackId = "protected-track";
  providerTitle = "Updated provider title";
  xml = xml.replace("<title>Example</title>", "<title>Updated provider title</title>");
  await runPromoOnlySync(db, { ...common, config: { ...discovery, mode: "METADATA" } });
  assert.equal(tracks.get("91").autoDjReady, false);
  assert.equal(tracks.get("91").importState, "RECONCILIATION_REQUIRED");
  assert.equal(protectedStatus, "DRAFT");
});

test("unknown provider genre is created once, while original spelling survives the mapping", async () => {
  let genre = null;
  let mapping = null;
  let creations = 0;
  const db = {
    mediaGenre: {
      findFirst: async () => genre,
      findUnique: async () => null,
      create: async ({ data }) => { creations++; genre = { id: "genre-new", ...data }; return genre; }
    },
    musicProviderGenreMapping: {
      findUnique: async () => mapping,
      create: async ({ data }) => { mapping = { id: "map-new", ...data, catalogGenre: genre }; return mapping; }
    }
  };
  const options = { autoCreateGenres: true, genreReviewRequired: true };
  const first = await syncPromoOnlyGenre(db, "  Dance   /  House ", options);
  const repeat = await syncPromoOnlyGenre(db, "dance / house", options);
  assert.equal(creations, 1);
  assert.equal(first.genre.id, repeat.genre.id);
  assert.equal(first.mapping.sourceGenre, "Dance / House");
  assert.equal(first.mapping.normalizedSourceGenre, "dance / house");
  assert.equal(first.mapping.reviewStatus, "PENDING");
});

test("administrator endpoints guard roles and generic distributor cannot control Promo Only", () => {
  for (const path of ["app/api/admin/promo-only/sync/route.js", "app/api/admin/promo-only/tracks/[trackId]/download/route.js", "app/api/admin/promo-only/tracks/[trackId]/route.js", "app/api/admin/promo-only/genres/[mappingId]/route.js"]) {
    assert.match(read(path), /SUPER_ADMIN/);
  }
  assert.match(read("app/api/admin/music-distributors/[connectionId]/sync/route.js"), /PROMO_ONLY/);
  assert.match(read("app/api/studio/playout/route.js"), /studioQueueReadiness/);
  const subscriber = read("app/api/catalogue/music/route.js");
  assert.match(subscriber, /loadEligibleSubscriberMusic/);
  assert.match(subscriber, /sourceScopes: scopes/);
  assert.match(subscriber, /includesRuvanasCatalogue/);
  assert.match(subscriber, /licensedMusicCatalogueEnabled/);
  assert.match(subscriber, /subscriberProductAccess/);
  assert.doesNotMatch(subscriber, /dl_token|downloadHost|providerMetadata|storageKey/);
});

test("migration defines provider provenance, identity and genre uniqueness", () => {
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20261124000000_promo_only_testing_sync/migration.sql");
  for (const model of ["MusicProviderFeedItem", "MusicProviderGenreMapping"]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
    assert.match(migration, new RegExp(`CREATE TABLE "${model}"`));
  }
  for (const field of ["catalogueProvider", "sourceGenre", "canonicalGenreId", "minimumCatalogueLevel", "providerReviewStatus", "idempotencyKey"]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
    assert.match(migration, new RegExp(`"${field}"`));
  }
  assert.match(migration, /MusicProviderGenreMapping_provider_normalizedSourceGenre_key/);
  assert.match(migration, /MusicProviderFeedItem_connectionId_idempotencyKey_key/);
});
