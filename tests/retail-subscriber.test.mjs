import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { RETAIL_PILOT_ACCESS as P, changeRetailPilotAccess } from "../lib/retail-stream-pilot-access.mjs";
import { retailStreamStationSlug } from "../lib/retail-stream-setup-service.mjs";
import { isRetailSubscriberContext, isRetailSubscriberSession, resolveRetailSubscriberWorkspace,
  RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";
import { retailSubscriberCatalogue, retailSubscriberLibrary, retailSubscriberPreviewRecipe, retailSubscriberCreateRecipe,
  retailSubscriberWorkspace, retailSubscriberPrepareWorkspace, retailSubscriberSchedule, retailSubscriberSaveSchedule,
  retailSubscriberPublicError } from "../lib/retail-subscriber-service.mjs";
import { retailSubscriberCommand, retailSubscriberQuery, retailSubscriberErrorStatus } from "../lib/retail-subscriber-request.mjs";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";

const NOW = new Date("2026-10-25T08:00:00Z"), BEFORE = new Date("2026-10-20T00:00:00Z"), EXPIRES = new Date("2026-11-23T12:00:00Z");
const ORG = P.organisationId, USER = "retail-tester", ADMIN = "platform-owner", ENV = { SECRET_ENCRYPTION_KEY: "11".repeat(32) };
const ID = "31400821-cc19-4c1d-bd7a-c723b8d35415", OTHER = "31400821-cc19-4c1d-bd7a-c723b8d35416";
const clone = value => structuredClone(value), recipe = { name: "Shop afternoon", buildMode: "GENRE_SEQUENCE", genreCodes: ["POP", "POP", "ROCK"], durationMinutes: 30 };
function track(i, genre = "pop") {
  const checksum = i.toString(16).padStart(64, "0");
  return { id: `track-${i}`, mediaAssetId: `asset-${i}`, title: `Title ${i}`, artist: `Artist ${i}`, album: "Album", mixName: "Radio edit", bpm: 120,
    status: "READY", catalogueProvider: "RUVANAS", minimumCatalogueLevel: "FOCUSED", rightsReviewStatus: "APPROVED",
    rightsConfirmedAt: BEFORE, rightsConfirmedById: ADMIN, rightsReviewedAt: BEFORE, rightsReviewedById: ADMIN,
    rightsHolder: "Synthetic owner", rightsReference: "Synthetic permission", rightsBasis: "OTHER",
    permittedUses: ["RETAIL_RADIO"], permittedTerritories: "MT", licenceStartsAt: BEFORE, licenceExpiresAt: EXPIRES, distributorItems: [],
    mediaAsset: { id: `asset-${i}`, organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC", status: "READY",
      licensedCatalogue: true, durationSeconds: 180, storageKey: `catalogue/music/${checksum}.mp3`, checksumSha256: checksum,
      sizeBytes: 1000000n, genres: [{ mediaGenre: { id: `genre-${genre}`, slug: genre, name: genre, active: true, minimumCatalogueLevel: "FOCUSED" } }] } };
}
async function fixture() {
  let next = 0, tail = Promise.resolve();
  const subscription = { organisationId: ORG, plan: clone(PREVIEW_TESTER_PLAN), status: "TRIAL", billingContract: null, currentPeriodEnd: EXPIRES,
    complimentaryAccessActive: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false, ...previewTesterOverrides(["RETAIL"]) };
  const organisation = { id: ORG, name: "Private Retail test", subscription, enterpriseSecurityPolicy: null };
  const membership = { organisationId: ORG, role: "OWNER", organisation };
  const user = { id: USER, email: P.email, role: "OWNER", memberships: [membership], privatePreviewAccess: {
    userId: USER, organisationId: ORG, pillars: ["RETAIL"], enabled: true, passwordEnabled: true, expiresAt: EXPIRES } };
  const session = { id: "retail-session", userId: USER, user, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG, expiresAt: EXPIRES, revokedAt: null };
  const context = { session, user, membership, memberships: [membership] };
  const station = { id: STATION, name: "Test Retail", organisationId: ORG, slug: retailStreamStationSlug(ORG), productFamily: "RETAIL", status: "DRAFT",
    publicPlayerEnabled: false, stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL", organisation,
    streamConfig: { stationId: STATION, providerKey: "CENTOVA_CAST", outputCodec: "MP3", streamUrl: P.listenerUrl,
      serverHost: P.host, serverPort: P.port, sourcePort: P.port, centovaUsername: P.account, sourceUsername: null, bitrateKbps: 128,
      sourcePasswordEncrypted: "SYNTHETIC_PRIVATE_CIPHERTEXT", probeEnabled: false, outboundAutoDjEnabled: false,
      encoderLeaseOwner: null, encoderLeaseUntil: null, sourceConnectionStatus: "DISCONNECTED" } };
  const d = { station, user, admin: { id: ADMIN, role: "SUPER_ADMIN" }, memberCount: 1, stationCount: 1, channels: [], modes: [],
    tracks: [track(1), track(2), track(3, "rock")], audits: new Map(), writes: [], locks: [], schedule: null, versions: [] };
  const matching = (m, where) => m.organisationId === where.organisationId && (!where.id || m.id === where.id) && m.source === where.source &&
    where.status.in.includes(m.status) && m.smartPlaylist?.organisationId === where.smartPlaylist.organisationId &&
    where.smartPlaylist.status.in.includes(m.smartPlaylist.status) && m.smartPlaylist.rightsUse === where.smartPlaylist.rightsUse &&
    where.smartPlaylist.simpleBuildMode.in.includes(m.smartPlaylist.simpleBuildMode);
  const db = {
    $executeRaw: async (_strings, ...values) => { d.locks.push(values); return 1; },
    station: { findUnique: async ({ where }) => clone(where.id === STATION || where.slug === d.station.slug ? d.station : null),
      findFirst: async ({ where }) => { assert.deepEqual(where, { id: STATION, organisationId: ORG }); return clone(d.station); },
      count: async ({ where }) => { assert.deepEqual(where, { organisationId: ORG }); return d.stationCount; } },
    channel: { findMany: async ({ where, take }) => { assert.deepEqual(where, { stationId: STATION }); return clone(d.channels.slice(0, take)); },
      create: async ({ data }) => { assert.equal(data.status, "DRAFT"); const row = { id: `c${String(++next).padStart(24, "0")}`, ...clone(data) };
        d.channels.push(row); d.writes.push({ model: "Channel", data: clone(data) }); return clone(row); } },
    user: { findUnique: async ({ where }) => clone(where.email === P.email ? d.user : where.id === ADMIN ? d.admin : null) },
    organisationMember: { count: async () => d.memberCount },
    mediaGenre: { findMany: async () => [track(1).mediaAsset.genres[0].mediaGenre, track(3, "rock").mediaAsset.genres[0].mediaGenre] },
    track: { findMany: async () => clone(d.tracks) },
    musicMode: {
      findMany: async ({ where, take }) => clone(d.modes.filter(m => matching(m, where)).slice(0, take)),
      findFirst: async ({ where }) => clone(d.modes.find(m => matching(m, where)) || null),
      count: async ({ where }) => d.modes.filter(m => matching(m, where)).length,
      create: async ({ data }) => { const row = { id: `c${String(++next).padStart(24, "0")}`, ...clone(data), smartPlaylist: null };
        d.modes.push(row); d.writes.push({ model: "MusicMode", data: clone(data) }); return clone(row); }
    },
    smartPlaylist: { create: async ({ data }) => { const row = { id: `c${String(++next).padStart(24, "0")}`, version: 1, ...clone(data) };
      d.modes.find(m => m.id === data.musicModeId).smartPlaylist = row; d.writes.push({ model: "SmartPlaylist", data: clone(data) }); return clone(row); } },
    programmeSchedule: {
      findFirst: async ({ where }) => { assert.equal(where.organisationId, ORG); assert.equal(where.channelId, d.channels[0]?.id);
        return d.schedule ? clone({ ...d.schedule, versions: d.versions.slice(-1) }) : null; },
      create: async ({ data }) => { d.schedule = { id: `c${String(++next).padStart(24, "0")}`, ...clone(data) };
        d.writes.push({ model: "ProgrammeSchedule", data: clone(data) }); return clone(d.schedule); }
    },
    programmeScheduleVersion: { create: async ({ data }) => {
      assert.equal(data.status, "DRAFT"); assert.equal(data.isActive, false);
      const id = `c${String(++next).padStart(24, "0")}`, row = { ...clone(data), id,
        items: data.items.create.map((item, i) => ({ ...clone(item), id: `${id}-item-${i}`, organisationId: ORG, versionId: id })) };
      d.versions.push(row); d.writes.push({ model: "ProgrammeScheduleVersion", data: clone(data) }); return clone(row); } },
    auditLog: {
      findUnique: async ({ where }) => clone(d.audits.get(where.id) || null),
      create: async ({ data }) => { const id = data.id || `history-${++next}`; assert.equal(d.audits.has(id), false);
        const row = { id, ...clone(data) }; d.audits.set(id, row); d.writes.push({ model: "AuditLog", data: clone(data) }); return clone(row); },
      upsert: async ({ where, create, update }) => { const row = d.audits.has(where.id) ? { ...d.audits.get(where.id), ...clone(update) } : clone(create);
        d.audits.set(where.id, row); d.writes.push({ model: "AuditLog", data: clone(row) }); return clone(row); }
    }
  };
  db.$transaction = async (operation, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    let unlock; const gate = new Promise(resolve => { unlock = resolve; }), previous = tail; tail = previous.then(() => gate); await previous;
    const snapshot = clone(d);
    try { return await operation(db); } catch (error) { Object.assign(d, snapshot); throw error; } finally { unlock(); }
  };
  await changeRetailPilotAccess(db, { actorUserId: ADMIN, organisationId: ORG, action: "approve", confirmed: true, now: NOW, env: ENV });
  d.writes = []; d.locks = [];
  // Simulate both source connection and unrelated control state already live.
  d.station.streamConfig.encoderLeaseOwner = "EXISTING_RETAIL_WORKER";
  d.audits.set(`retail-playout:control:${STATION}`, { details: { command: { action: "START", stationId: STATION } } });
  const options = { context, now: NOW, env: ENV };
  return { d, db, context, options, week: () => ({ action: "save", channelId: d.channels[0]?.id, name: "Retail week", timezone: "Europe/Malta",
    requestId: ID, baseVersionId: null, items: [{ label: "Shop afternoon", recurrence: "WEEKLY", weekday: 5, startTime: "14:00",
      durationMinutes: 30, priority: 0, sourceType: "MUSIC_MODE", sourceId: d.modes[0]?.id }] }) };
}

test("exact Retail read-only tester and fresh membership are required before database reads", async () => {
  const f = await fixture(); assert.equal(isRetailSubscriberSession(f.context.session, NOW), true); assert.equal(isRetailSubscriberContext(f.context, NOW), true);
  for (const mutate of [c => { c.session.authMethod = "PASSWORD"; }, c => { c.user.email = "radio@manuelchircop.com"; },
    c => { c.user.role = "SUPER_ADMIN"; }, c => { c.session.expiresAt = NOW; }, c => { c.session.revokedAt = NOW; },
    c => { c.user.privatePreviewAccess.enabled = false; }, c => { c.user.privatePreviewAccess.expiresAt = NOW; },
    c => { c.user.privatePreviewAccess.pillars = ["RETAIL", "ONLINE"]; }, c => { c.memberships.push(clone(c.membership)); },
    c => { c.membership.organisation.subscription.plan.licensedMusicCatalogueLevel = "FOCUSED"; },
    c => { c.session.activeOrganisationId = "foreign"; }, c => { c.membership.role = "MANAGER"; }]) {
    const context = clone(f.context); mutate(context); assert.equal(isRetailSubscriberContext(context, NOW), false);
    assert.equal(await resolveRetailSubscriberWorkspace({}, context, { now: NOW }), null);
    await assert.rejects(retailSubscriberPrepareWorkspace({}, { ...f.options, context, input: { action: "prepare", requestId: ID } }), { code: "SUBSCRIBER_ACCESS_DENIED" });
  }
});
test("exact route exceptions permit only metadata and reviewed draft commands", async () => {
  const f = await fixture(), allowed = (path, method) => privatePreviewTesterRequestAllowed({ session: f.context.session, now: NOW, pathname: path, method });
  for (const endpoint of ["catalogue", "library", "schedule", "workspace"]) {
    const path = `/api/programming/test-retail/${endpoint}`;
    assert.equal(allowed(path, "GET"), true); assert.equal(allowed(path, "HEAD"), true);
    assert.equal(allowed(path, "POST"), endpoint !== "catalogue");
    for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal(allowed(path, method), false);
    assert.equal(allowed(`${path}/start`, "POST"), false);
  }
  for (const path of ["/api/catalogue/music", "/api/programming/simple", "/api/programming/test-radio/library", "/api/stations", "/api/media/upload", "/api/admin/organisations/x/retail-stream/playout"]) assert.equal(allowed(path, "POST"), false);
  assert.equal(allowed("/api/catalogue/music", "GET"), false);
});
test("catalogue and library work without planning channel or START, and GETs never write", async () => {
  const f = await fixture(); f.d.audits.delete(`retail-playout:control:${STATION}`);
  const before = clone(f.d), catalogue = await retailSubscriberCatalogue(f.db, { ...f.options, query: {} });
  assert.equal(catalogue.total, 3); assert.equal(catalogue.metadataOnly, true); assert.equal(catalogue.territory, "MT");
  assert.equal((await retailSubscriberLibrary(f.db, f.options)).recipes.length, 0);
  assert.equal((await retailSubscriberWorkspace(f.db, f.options)).canPrepare, true);
  assert.equal((await retailSubscriberSchedule(f.db, f.options)).canEdit, false);
  assert.deepEqual(f.d, before);
  assert.doesNotMatch(JSON.stringify(catalogue), /CIPHERTEXT|storageKey|checksum|sourcePassword|radioca\.st|signature|grant|EXISTING_RETAIL_WORKER/);
});
test("forged/revoked/expired music access and changed source or owner fail closed without writes", async () => {
  for (const mutate of [d => { d.audits.get(`retail-pilot-access:${STATION}`).details.signature = "00".repeat(32); },
    d => { d.audits.get(`retail-pilot-access:${STATION}`).details.command.action = "REVOKE"; },
    d => { d.station.streamConfig.sourcePasswordEncrypted = "changed"; }, d => { d.admin.role = "OWNER"; },
    d => { d.memberCount = 2; }, d => { d.user.privatePreviewAccess.enabled = false; }]) {
    const f = await fixture(); mutate(f.d);
    await assert.rejects(retailSubscriberCatalogue(f.db, { ...f.options, query: {} }), error =>
      ["SUBSCRIBER_MUSIC_ACCESS_REQUIRED", "SUBSCRIBER_ACCESS_DENIED"].includes(error.code));
    assert.equal(f.d.writes.length, 0);
  }
  const f = await fixture(); await assert.rejects(retailSubscriberLibrary(f.db, { ...f.options, now: EXPIRES }), { code: "SUBSCRIBER_ACCESS_DENIED" });
});
test("catalogue retains Retail use, country, tier, rights, duration and private media checks", async () => {
  for (const mutate of [t => { t.permittedUses = ["ONLINE_RADIO"]; }, t => { t.permittedTerritories = "GB"; },
    t => { t.licenceExpiresAt = BEFORE; }, t => { t.rightsReviewStatus = "IN_REVIEW"; },
    t => { t.minimumCatalogueLevel = "PREMIUM"; }, t => { t.mediaAsset.status = "DRAFT"; },
    t => { t.mediaAsset.durationSeconds = 3601; }, t => { t.mediaAsset.storageKey = "https://secret.example/file"; },
    t => { t.mediaAsset.organisationId = "foreign"; }, t => { t.mediaAsset.libraryType = "ORGANISATION_MUSIC"; }]) {
    const f = await fixture(); mutate(f.d.tracks[0]); assert.equal((await retailSubscriberCatalogue(f.db, { ...f.options, query: {} })).total, 2);
  }
  const f = await fixture(); f.d.tracks.push(clone(f.d.tracks[0])); assert.equal((await retailSubscriberCatalogue(f.db, { ...f.options, query: {} })).total, 3);
});
test("metadata search and pagination are bounded and unknown query fields rejected", async () => {
  const f = await fixture(); assert.equal((await retailSubscriberCatalogue(f.db, { ...f.options, query: { q: "Title 2", limit: "1" } })).tracks[0].id, "track-2");
  assert.equal((await retailSubscriberCatalogue(f.db, { ...f.options, query: { genre: "ROCK" } })).total, 1);
  for (const query of [{ q: "x".repeat(101) }, { limit: 51 }, { offset: -1 }, { stationId: "other" }]) await assert.rejects(retailSubscriberCatalogue(f.db, { ...f.options, query }), { code: "SUBSCRIBER_QUERY_INVALID" });
});
test("catalogue never silently truncates an eligible inventory above the UI's 2000-track bound", async () => {
  const f = await fixture(); f.d.tracks = Array.from({ length: 2000 }, (_, i) => track(i + 1));
  const maximum = await retailSubscriberCatalogue(f.db, { ...f.options, query: { limit: 1 } });
  assert.equal(maximum.total, 2000); assert.equal(maximum.tracks.length, 1);
  f.d.tracks.push(track(2001));
  await assert.rejects(retailSubscriberCatalogue(f.db, { ...f.options, query: { limit: 1 } }), { code: "SUBSCRIBER_CATALOGUE_REVIEW_REQUIRED" });
  assert.equal(f.d.writes.length, 0);
});
test("workspace preparation is explicit, idempotent, within current allowance and DRAFT only", async () => {
  const f = await fixture(), source = clone(f.d.station.streamConfig), subscription = clone(f.context.membership.organisation.subscription), audits = clone(f.d.audits);
  const prepare = () => retailSubscriberPrepareWorkspace(f.db, { ...f.options, input: { action: "prepare", requestId: ID } });
  const [a, b] = await Promise.all([prepare(), prepare()]); assert.equal(a.preparedChannelId, b.preparedChannelId); assert.equal(f.d.channels.length, 1);
  assert.equal(f.d.channels[0].status, "DRAFT"); assert.equal(f.d.channels[0].musicRightsUse, "RETAIL_RADIO"); assert.equal(a.canPrepare, false);
  const count = f.d.writes.length; await retailSubscriberPrepareWorkspace(f.db, { ...f.options, input: { action: "prepare", requestId: OTHER } }); assert.equal(f.d.writes.length, count);
  assert.deepEqual(f.d.station.streamConfig, source); assert.deepEqual(f.context.membership.organisation.subscription, subscription);
  for (const [id, record] of audits) assert.deepEqual(f.d.audits.get(id), record);
  assert.ok(f.d.locks.every(values => values[0] === `retail-subscriber-planning:${ORG}`));
  assert.ok(f.d.writes.every(w => ["Channel", "AuditLog"].includes(w.model)));
  const f2 = await fixture(); f2.d.stationCount = 2;
  await assert.rejects(retailSubscriberPrepareWorkspace(f2.db, { ...f2.options, input: { action: "prepare", requestId: ID } }), { code: "SUBSCRIBER_STATION_LIMIT" });
  assert.equal(f2.d.channels.length, 0); assert.equal(f2.d.writes.length, 0);
});
test("foreign/multiple/archived planning inventory and changed station do not create more channels", async () => {
  for (const mutate of [d => { d.station.id = "foreign"; }, d => { d.station.productFamily = "ONLINE"; }, d => { d.station.publicPlayerEnabled = true; },
    d => { d.channels = [{ id: "c1", stationId: STATION, organisationId: "foreign", musicRightsUse: "RETAIL_RADIO", status: "DRAFT" }]; },
    d => { d.channels = [1, 2].map(n => ({ id: `c${n}`, stationId: STATION, organisationId: ORG, musicRightsUse: "RETAIL_RADIO", status: "DRAFT" })); },
    d => { d.channels = [{ id: "c1", stationId: STATION, organisationId: ORG, musicRightsUse: "RETAIL_RADIO", status: "ARCHIVED" }]; }]) {
    const f = await fixture(); mutate(f.d);
    await assert.rejects(retailSubscriberPrepareWorkspace(f.db, { ...f.options, input: { action: "prepare", requestId: ID } }), { code: "SUBSCRIBER_ACCESS_DENIED" }); assert.equal(f.d.writes.length, 0);
  }
});
test("playlist preview is metadata-only and save creates one immutable Retail DRAFT on retry", async () => {
  const f = await fixture(), original = clone(f.d.station);
  const preview = await retailSubscriberPreviewRecipe(f.db, { ...f.options, input: { ...recipe, seed: "example" } });
  assert.ok(preview.preview.items.length > 0); assert.equal(preview.preview.liveOrderFixed, false); assert.equal(f.d.writes.length, 0);
  const save = () => retailSubscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, requestId: ID } });
  const [a, b] = await Promise.all([save(), save()]); assert.equal(a.savedSourceId, b.savedSourceId); assert.equal(f.d.modes.length, 1);
  assert.equal(f.d.modes[0].status, "DRAFT"); assert.equal(f.d.modes[0].smartPlaylist.status, "DRAFT"); assert.equal(f.d.modes[0].smartPlaylist.rightsUse, "RETAIL_RADIO");
  assert.deepEqual(f.d.station, original); assert.doesNotMatch(JSON.stringify(a), /CIPHERTEXT|storageKey|radioca\.st|sourcePassword/);
  await assert.rejects(retailSubscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, name: "Changed", requestId: ID } }), { code: "SUBSCRIBER_RETRY_CHANGED" });
});
test("weekly drafts require a prepared Retail channel and current Retail playlist and never publish", async () => {
  const f = await fixture(); await retailSubscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, requestId: ID } });
  await retailSubscriberPrepareWorkspace(f.db, { ...f.options, input: { action: "prepare", requestId: ID } });
  const station = clone(f.d.station), audits = clone(f.d.audits);
  const [a, b] = await Promise.all([retailSubscriberSaveSchedule(f.db, { ...f.options, input: f.week() }), retailSubscriberSaveSchedule(f.db, { ...f.options, input: f.week() })]);
  assert.equal(a.savedVersionId, b.savedVersionId); assert.equal(f.d.versions.length, 1); assert.equal(a.canApprove, false); assert.equal(a.draftOnly, true);
  assert.equal(a.nowNext, null); assert.equal(a.approved, null); assert.ok(a.draft.preview.occurrences.length > 0);
  assert.equal(f.d.versions[0].status, "DRAFT"); assert.equal(f.d.versions[0].isActive, false);
  const previous = clone(f.d.versions[0]); f.d.versions[0].status = "PUBLISHED"; f.d.versions[0].isActive = true; const published = clone(f.d.versions[0]);
  await retailSubscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week(), requestId: OTHER, baseVersionId: previous.id } });
  assert.deepEqual(f.d.versions[0], published); assert.equal(f.d.versions[1].status, "DRAFT"); assert.equal(f.d.versions[1].isActive, false);
  assert.deepEqual(f.d.station, station); for (const [id, record] of audits) assert.deepEqual(f.d.audits.get(id), record);
  await assert.rejects(retailSubscriberSaveSchedule(f.db, { ...f.options, input: f.week() }), { code: "SUBSCRIBER_DRAFT_CHANGED" });
});
test("weekly drafts reject foreign channel/source and do not mutate published headers", async () => {
  const f = await fixture(); await retailSubscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, requestId: ID } });
  await retailSubscriberPrepareWorkspace(f.db, { ...f.options, input: { action: "prepare", requestId: ID } });
  await assert.rejects(retailSubscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week(), channelId: "c111111111111111111111111" } }), { code: "SCHEDULE_CHANNEL_INVALID" });
  await assert.rejects(retailSubscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week(), items: [{ ...f.week().items[0], sourceId: "foreign" }] } }), { code: "SCHEDULE_SOURCE_UNAVAILABLE" });
  const saved = await retailSubscriberSaveSchedule(f.db, { ...f.options, input: f.week() });
  await assert.rejects(retailSubscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week(), requestId: OTHER, baseVersionId: saved.draft.id, name: "Renamed header" } }), { code: "SCHEDULE_HEADER_IMMUTABLE" });
  assert.equal(f.d.schedule.name, "Retail week"); assert.equal(f.d.versions.length, 1);
});
test("copy-on-write leaves existing ACTIVE playlists, timestamps and live control records untouched", async () => {
  const f = await fixture(); await retailSubscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, requestId: ID } });
  const active = f.d.modes[0]; active.status = "ACTIVE"; active.updatedAt = BEFORE;
  active.smartPlaylist.status = "ACTIVE"; active.smartPlaylist.updatedAt = BEFORE;
  const original = clone(active), source = clone(f.d.station.streamConfig), audits = clone(f.d.audits);
  await retailSubscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, name: "Fresh private copy", requestId: OTHER } });
  await retailSubscriberPrepareWorkspace(f.db, { ...f.options, input: { action: "prepare", requestId: ID } });
  await retailSubscriberSaveSchedule(f.db, { ...f.options, input: f.week() });
  assert.deepEqual(f.d.modes[0], original); assert.equal(f.d.modes[1].status, "DRAFT"); assert.deepEqual(f.d.station.streamConfig, source);
  for (const [id, record] of audits) assert.deepEqual(f.d.audits.get(id), record);
});
test("successful save retries must still pass the current signed music permission", async () => {
  const f = await fixture(), input = { ...recipe, requestId: ID };
  await retailSubscriberCreateRecipe(f.db, { ...f.options, input }); const before = clone(f.d.writes);
  f.d.audits.get(`retail-pilot-access:${STATION}`).details.signature = "00".repeat(32);
  await assert.rejects(retailSubscriberCreateRecipe(f.db, { ...f.options, input }), { code: "SUBSCRIBER_MUSIC_ACCESS_REQUIRED" });
  assert.deepEqual(f.d.writes, before); assert.equal(f.d.modes.length, 1);
});
test("playlist count and ready source limits fail closed without creating more drafts", async () => {
  const f = await fixture(); await retailSubscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, requestId: ID } });
  const first = clone(f.d.modes[0]);
  for (let i = 1; i < 20; i++) { const mode = clone(first); mode.id = `mode-${i}`; mode.smartPlaylist.id = `playlist-${i}`; mode.smartPlaylist.musicModeId = mode.id; f.d.modes.push(mode); }
  const writes = clone(f.d.writes);
  await assert.rejects(retailSubscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, requestId: OTHER } }), { code: "LIBRARY_RECIPE_LIMIT" });
  assert.deepEqual(f.d.writes, writes); assert.equal(f.d.modes.length, 20);
  f.d.modes[0].smartPlaylist.rightsUse = "ONLINE_RADIO";
  assert.equal((await retailSubscriberLibrary(f.db, f.options)).recipes.length, 19);
});
test("strict same-origin command parsing rejects bypass fields, duplicate queries and oversized bodies", async () => {
  const request = (body, headers = {}) => new Request("https://www.ruvanas.com/api/programming/test-retail/library", { method: "POST",
    headers: { origin: "https://www.ruvanas.com", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.deepEqual(await retailSubscriberCommand(request({ action: "prepare", requestId: ID }), "workspace"), { action: "prepare", requestId: ID });
  for (const body of [{ action: "start" }, { action: "prepare", requestId: ID, stationId: STATION }, { action: "prepare", requestId: ID, isActive: true }])
    await assert.rejects(retailSubscriberCommand(request(body), "workspace"), { code: "SUBSCRIBER_BODY_INVALID" });
  for (const origin of ["https://ruvanas.com", "https://evil.example", "null"]) await assert.rejects(retailSubscriberCommand(request({ action: "prepare" }, { origin }), "workspace"), { code: "SUBSCRIBER_ORIGIN_INVALID" });
  await assert.rejects(retailSubscriberCommand(request({ action: "prepare" }, { "sec-fetch-site": "cross-site" }), "workspace"), { code: "SUBSCRIBER_ORIGIN_INVALID" });
  await assert.rejects(retailSubscriberCommand(request({ action: "preview", name: "x".repeat(5000) }), "library"), { code: "SUBSCRIBER_BODY_INVALID" });
  assert.throws(() => retailSubscriberQuery(new Request("https://www.ruvanas.com/x?q=a&q=b"), ["q"]), { code: "SUBSCRIBER_QUERY_INVALID" });
  assert.equal(retailSubscriberErrorStatus("SUBSCRIBER_ACCESS_DENIED"), 403); assert.equal(retailSubscriberErrorStatus("SUBSCRIBER_DRAFT_CHANGED"), 409);
});
test("unknown failures never reflect diagnostics, connection details or arbitrary error codes", () => {
  const safe = retailSubscriberPublicError({ code: "DATABASE_URL_PASSWORD", message: "SYNTHETIC_PRIVATE_CIPHERTEXT" });
  assert.equal(safe.code, "SUBSCRIBER_REQUEST_FAILED"); assert.doesNotMatch(JSON.stringify(safe), /DATABASE_URL|CIPHERTEXT/);
});
test("API routes bind only scoped services, safe error projection and private response headers", async () => {
  for (const route of ["catalogue", "library", "schedule", "workspace"]) {
    const source = await readFile(new URL(`../app/api/programming/test-retail/${route}/route.js`, import.meta.url), "utf8");
    assert.match(source, /getActiveOrganisationContext\(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE\)/);
    assert.match(source, /retailSubscriberPublicError/); assert.match(source, /PREVIEW_RESPONSE_HEADERS/);
    assert.doesNotMatch(source, /error\.message|error\.stack|startRetail|stopRetail|probe|encryptSecret|loadAuthorizedContinuous/);
  }
});
