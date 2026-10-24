import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { TEST_RADIO_CONTINUOUS as P, continuousSourceFingerprint, signContinuousCommand } from "../lib/test-radio-continuous-policy.mjs";
import { CONTINUOUS_CONTROL_ID, CONTINUOUS_OBSERVATION_ID, loadAuthorizedContinuousRadio } from "../lib/test-radio-continuous-service.mjs";
import { CONTINUOUS_SCHEDULE as S, parseContinuousSchedule } from "../lib/test-radio-continuous-schedule-policy.mjs";
import { continuousScheduleDashboard, approveContinuousSchedule, loadAuthorizedContinuousSchedule } from "../lib/test-radio-continuous-schedule-service.mjs";
import { TEST_RADIO_SUBSCRIBER_STATION_ID, isTestRadioSubscriberSession, isTestRadioSubscriberContext, resolveTestRadioSubscriberWorkspace } from "../lib/test-radio-subscriber-access.mjs";
import { subscriberCatalogue, subscriberLibrary, subscriberPreviewRecipe, subscriberCreateRecipe, subscriberSchedule, subscriberSaveSchedule } from "../lib/test-radio-subscriber-service.mjs";
import { subscriberCommand, subscriberQuery, subscriberErrorStatus } from "../lib/test-radio-subscriber-request.mjs";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";

const NOW = new Date("2026-10-23T08:00:00Z"), BEFORE = new Date("2026-10-20T00:00:00Z"), EXPIRES = new Date("2026-11-23T00:00:00Z");
const ENV = { SECRET_ENCRYPTION_KEY: "ad".repeat(32), RUVANAS_TEST_RADIO_CONTINUOUS_ENABLED: "true" };
const ORG = "cmtestorganisation00001", OWNER = "cmtestowner00000000001", USER = "cmtestradiouser0000001", MODE = "cmtestmusicmode0000001", CHANNEL = "cmtestchannel000000001";
const NONCE = "31400821-cc19-4c1d-bd7a-c723b8d35415", SECOND = "31400821-cc19-4c1d-bd7a-c723b8d35416", clone = value => structuredClone(value);
const recipe = { name: "My reusable mix", buildMode: "GENRE_SEQUENCE", genreCodes: ["POP", "POP", "ROCK"], durationMinutes: 30 };
function track(i = 1, genre = "pop") {
  const assetId = `cmtestasset${String(i).padStart(10, "0")}`;
  return { id: `cmtesttrack${String(i).padStart(10, "0")}`, mediaAssetId: assetId, title: `Title ${i}`, artist: `Artist ${i}`,
    mixName: i === 1 ? "Extended mix" : "", isExplicit: i === 1, bpm: 123, album: "Album", status: "READY",
    catalogueProvider: null, minimumCatalogueLevel: "FOCUSED", rightsHolder: "Owner", rightsReference: "Direct permission", rightsBasis: "OTHER",
    rightsReviewStatus: "APPROVED", rightsReviewedAt: BEFORE, rightsReviewedById: OWNER, rightsConfirmedAt: BEFORE, rightsConfirmedById: OWNER,
    permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"], licenceStartsAt: null, licenceExpiresAt: EXPIRES, updatedAt: BEFORE, distributorItems: [],
    mediaAsset: { id: assetId, organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC", status: "READY", licensedCatalogue: true,
      storageKey: `catalogue/music/${i.toString(16).padStart(64, "0")}.mp3`, sizeBytes: 1000000n, durationSeconds: 180, mimeType: "audio/mpeg", updatedAt: BEFORE,
      genres: [{ mediaGenre: { id: `cmgenre${genre}`, slug: genre, name: genre, active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED" } }] } };
}
function fixture() {
  let next = 0, tail = Promise.resolve();
  const subscription = { organisationId: ORG, plan: clone(PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN), status: "TRIAL", billingContract: null,
    currentPeriodEnd: EXPIRES, complimentaryAccessActive: false, schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false,
    ...previewTesterOverrides(["ONLINE"]) };
  const membership = { organisationId: ORG, role: "OWNER", organisation: { id: ORG, subscription, enterpriseSecurityPolicy: null } };
  const user = { id: USER, role: "OWNER", email: "radio@manuelchircop.com", memberships: [membership],
    privatePreviewAccess: { userId: USER, organisationId: ORG, pillars: ["ONLINE"], enabled: true, passwordEnabled: true, expiresAt: EXPIRES } };
  const session = { id: "cmtestradiosession001", userId: USER, user, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG, expiresAt: EXPIRES, revokedAt: null };
  const context = { session, user, membership, memberships: [membership] };
  const config = { stationId: P.stationId, providerKey: "CENTOVA_CAST", streamUrl: P.listenerUrl, serverHost: P.host, serverPort: P.port,
    sourcePort: P.port, sourceUsername: null, centovaUsername: P.account, bitrateKbps: 128, sourcePasswordEncrypted: "test-ciphertext", outboundAutoDjEnabled: false };
  const station = { id: P.stationId, name: "Test Radio", organisationId: ORG, productFamily: "ONLINE", status: "ACTIVE",
    publicPlayerEnabled: false, stationWebsiteEnabled: false, streamConfig: config, organisation: membership.organisation };
  const channel = { id: CHANNEL, name: "Test Radio channel", status: "ACTIVE", organisationId: ORG, stationId: P.stationId, musicRightsUse: "ONLINE_RADIO" };
  const modes = [{ id: MODE, organisationId: ORG, name: "Existing pop template", source: "SMART_PLAYLIST", status: "DRAFT", smartPlaylist: {
    id: "cmplaylist000000000001", musicModeId: MODE, organisationId: ORG, version: 1, status: "DRAFT", rightsUse: "ONLINE_RADIO", simpleBuildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"], durationMinutes: 60 } }];
  const d = { station, channel, modes, tracks: [track(1), track(2), track(3, "rock")], audits: new Map(), writes: [], schedule: null, versions: [] };
  const ownerSession = { id: "cmownersession00000001", userId: OWNER, user: { id: OWNER, role: "SUPER_ADMIN", privatePreviewAccess: null },
    authMethod: "PASSWORD", activeOrganisationId: null, activeOrganisation: null, createdAt: BEFORE, lastSeenAt: NOW, revokedAt: null, expiresAt: EXPIRES };
  const grant = { kind: P.kind, action: "START", id: "fa633d3e-1bb3-4b01-ad45-7c73f48bc8ef", sequence: 1, stationId: P.stationId, organisationId: ORG,
    actorUserId: OWNER, sourceFingerprint: continuousSourceFingerprint(config), issuedAt: BEFORE.toISOString(), publicExposureAccepted: true,
    monthlyBudgetUsd: 15, bitrateKbps: 128, territory: "MT", catalogueLevel: "FOCUSED" };
  d.audits.set(CONTINUOUS_CONTROL_ID, { details: { command: grant, signature: signContinuousCommand(grant, ENV) } });
  const matching = (m, w) => m.organisationId === w.organisationId && (!w.id || typeof w.id === "string" ? !w.id || m.id === w.id : w.id.in.includes(m.id)) &&
    m.source === w.source && w.status.in.includes(m.status) && (!w.smartPlaylist || m.smartPlaylist?.organisationId === w.smartPlaylist.organisationId &&
      w.smartPlaylist.status.in.includes(m.smartPlaylist.status) && m.smartPlaylist.rightsUse === w.smartPlaylist.rightsUse &&
      (!w.smartPlaylist.simpleBuildMode.in || w.smartPlaylist.simpleBuildMode.in.includes(m.smartPlaylist.simpleBuildMode)));
  const db = {
    station: { findUnique: async ({ where }) => { assert.equal(where.id, P.stationId); return clone(d.station); },
      findFirst: async ({ where }) => { assert.deepEqual(where, { id: P.stationId, organisationId: ORG }); return clone(d.station); } },
    channel: { findMany: async ({ where }) => { assert.equal(where.stationId, P.stationId); assert.equal(where.organisationId, ORG); return [clone(d.channel)]; },
      findFirst: async ({ where }) => { assert.equal(where.stationId, P.stationId); assert.equal(where.organisationId, ORG); return where.id === d.channel.id ? clone(d.channel) : null; } },
    mediaGenre: { findMany: async () => [track(1).mediaAsset.genres[0].mediaGenre, track(3, "rock").mediaAsset.genres[0].mediaGenre] },
    track: { findMany: async () => clone(d.tracks) }, user: { findUnique: async ({ where }) => where.id === OWNER ? { id: OWNER, role: "SUPER_ADMIN" } : null },
    onlineRadioCatalogueTest: { findFirst: async () => null },
    musicMode: {
      findMany: async ({ where, take }) => clone(d.modes.filter(mode => matching(mode, where)).slice(0, take)),
      findFirst: async ({ where }) => clone(d.modes.find(mode => matching(mode, where)) || null),
      count: async ({ where }) => d.modes.filter(mode => matching(mode, where)).length,
      create: async ({ data }) => { assert.equal(data.organisationId, ORG); const row = { id: `cmmode${String(++next).padStart(18, "0")}`, ...clone(data), smartPlaylist: null };
        d.modes.push(row); d.writes.push({ model: "MusicMode", data: clone(data) }); return clone(row); }
    },
    smartPlaylist: { create: async ({ data }) => {
      assert.equal(data.organisationId, ORG); const row = { id: `cmplaylist${String(++next).padStart(14, "0")}`, version: 1, ...clone(data) };
      d.modes.find(m => m.id === data.musicModeId).smartPlaylist = row; d.writes.push({ model: "SmartPlaylist", data: clone(data) }); return clone(row);
    } },
    programmeSchedule: {
      findFirst: async ({ where }) => { assert.equal(where.organisationId, ORG); assert.equal(where.channelId, CHANNEL);
        return d.schedule ? clone({ ...d.schedule, versions: d.versions.slice(-1) }) : null; },
      create: async ({ data }) => { d.schedule = { id: "cmtestschedule00000001", ...clone(data) }; d.writes.push({ model: "ProgrammeSchedule", data: clone(data) }); return clone(d.schedule); },
      update: async ({ where, data }) => { assert.equal(where.id, d.schedule.id); assert.deepEqual(Object.keys(data), ["name"]); Object.assign(d.schedule, data); d.writes.push({ model: "ProgrammeSchedule", data: clone(data) }); return clone(d.schedule); }
    },
    programmeScheduleVersion: {
      create: async ({ data }) => { assert.equal(data.status, "DRAFT"); assert.equal(data.isActive, false);
        for (const item of data.items.create) { assert.equal(Object.hasOwn(item, "organisationId"), false); assert.equal(Object.hasOwn(item, "versionId"), false); }
        const id = `cmversion${String(++next).padStart(15, "0")}`, row = { ...clone(data), id,
          items: data.items.create.map((item, i) => ({ ...clone(item), id: `${id}item${i}`, organisationId: ORG, versionId: id })) };
        d.versions.push(row); d.writes.push({ model: "ProgrammeScheduleVersion", data: clone(data) }); return clone(row); },
      findFirst: async ({ where }) => { assert.equal(where.organisationId, ORG); return clone(d.versions.find(v => v.id === where.id) || null); }
    },
    auditLog: {
      findUnique: async ({ where }) => clone(d.audits.get(where.id) || null),
      create: async ({ data }) => { if (data.id) assert.equal(d.audits.has(data.id), false); d.audits.set(data.id || `audit-${++next}`, clone(data)); d.writes.push({ model: "AuditLog", data: clone(data) }); return clone(data); },
      upsert: async ({ where, create, update }) => { const row = d.audits.has(where.id) ? { ...d.audits.get(where.id), ...clone(update) } : clone(create); d.audits.set(where.id, row); return clone(row); }
    }
  };
  db.$transaction = async (action, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    let unlock; const gate = new Promise(resolve => { unlock = resolve; }), prior = tail; tail = prior.then(() => gate); await prior;
    const before = clone({ modes: d.modes, audits: d.audits, writes: d.writes, schedule: d.schedule, versions: d.versions });
    try { return await action(db); } catch (error) { Object.assign(d, before); throw error; } finally { unlock(); }
  };
  const week = { channelId: CHANNEL, name: "Subscriber week", timezone: "Europe/Malta", requestId: NONCE, baseVersionId: null,
    items: [{ label: "Afternoon", recurrence: "WEEKLY", weekday: 5, startTime: "14:00", durationMinutes: 30, priority: 0, sourceType: "MUSIC_MODE", sourceId: MODE }] };
  return { db, d, context, options: { context, now: NOW, env: ENV }, ownerOptions: { actorSession: ownerSession, now: NOW, env: ENV }, week };
}

test("exact preview account, session, plan and current membership are required before any database lookup", async () => {
  const f = fixture(); assert.equal(TEST_RADIO_SUBSCRIBER_STATION_ID, P.stationId); assert.equal(isTestRadioSubscriberContext(f.context, NOW), true);
  assert.equal(isTestRadioSubscriberSession(f.context.session, NOW), true);
  const changes = [c => { c.session.authMethod = "PASSWORD"; }, c => { c.user.email = "other@example.com"; },
    c => { c.user.role = "SUPER_ADMIN"; }, c => { c.session.expiresAt = NOW; }, c => { c.session.revokedAt = NOW; },
    c => { c.user.privatePreviewAccess.expiresAt = NOW; }, c => { c.user.privatePreviewAccess.enabled = false; },
    c => { c.membership.organisation.subscription.plan.includesRuvanasCatalogue = true; }, c => { c.session.activeOrganisationId = "foreign"; },
    c => { c.memberships.push(clone(c.membership)); }, c => { c.membership.organisation.enterpriseSecurityPolicy = { ssoRequired: true, passwordFallback: false }; }];
  for (const change of changes) {
    const c = clone(f.context); change(c); assert.equal(isTestRadioSubscriberContext(c, NOW), false);
    assert.equal(await resolveTestRadioSubscriberWorkspace({}, c, { now: NOW }), null);
  }
  assert.equal(await resolveTestRadioSubscriberWorkspace({}, null, { now: NOW }), null);
});
test("only exact connected Test Radio active channel is resolved, never another tenant or station", async () => {
  const f = fixture(); assert.equal((await resolveTestRadioSubscriberWorkspace(f.db, f.context, { now: NOW })).channelId, CHANNEL);
  for (const [key, value] of [["organisationId", "foreign"], ["id", "foreign"], ["productFamily", "RETAIL"], ["publicPlayerEnabled", true]]) {
    const g = fixture(); g.d.station[key] = value; assert.equal(await resolveTestRadioSubscriberWorkspace(g.db, g.context, { now: NOW }), null);
  }
  f.d.channel.stationId = "foreign"; assert.equal(await resolveTestRadioSubscriberWorkspace(f.db, f.context, { now: NOW }), null);
});
test("middleware allows only reviewed exact subscriber endpoints and verbs, not owner or streaming controls", () => {
  const f = fixture(), allowed = (path, method = "GET", session = f.context.session) => privatePreviewTesterRequestAllowed({ session, pathname: path, method, now: NOW });
  for (const suffix of ["catalogue", "library", "schedule"]) {
    assert.equal(allowed(`/api/programming/test-radio/${suffix}`), true);
    assert.equal(allowed(`/api/programming/test-radio/${suffix}`, "POST"), suffix !== "catalogue");
    assert.equal(allowed(`/api/programming/test-radio/${suffix}`, "DELETE"), false);
  }
  for (const path of ["/api/programming/test-radio/start", "/api/programming/test-radio/schedule/approve", "/api/programming/simple/nonstop",
    `/api/admin/stations/${P.stationId}/continuous-autodj`, "/api/programming/test-radio/library/", "/api/programming/test-radio/%6cibrary"]) assert.equal(allowed(path, "POST"), false);
  const wrong = clone(f.context.session); wrong.user.email = "other@example.com";
  assert.equal(allowed("/api/programming/test-radio/library", "POST", wrong), false);
});
test("catalogue and recipe preview expose only real approved metadata, with accurate mix and explicit flags, no audio or writes", async () => {
  const f = fixture(), result = await subscriberCatalogue(f.db, { ...f.options, query: { q: "Extended", limit: "10", offset: "0" } });
  assert.equal(result.metadataOnly, true); assert.equal(result.total, 1); assert.equal(result.tracks[0].mix, "Extended mix"); assert.equal(result.tracks[0].explicit, true);
  const preview = await subscriberPreviewRecipe(f.db, { ...f.options, input: { ...recipe, seed: "example" } });
  assert.deepEqual(preview.preview.items.slice(0, 3).map(t => t.genreCodes[0]), ["POP", "POP", "ROCK"]); assert.equal(preview.preview.liveOrderFixed, false);
  const library = await subscriberLibrary(f.db, f.options); assert.equal(library.recipes[0].sourceId, MODE);
  for (const dto of [result, preview, library]) assert.doesNotMatch(JSON.stringify(dto), /storageKey|mediaAsset|fingerprint|password|secret|https?:/i);
  assert.equal(f.d.writes.length, 0);
  f.d.tracks[0].rightsReviewStatus = "REJECTED";
  assert.equal((await subscriberCatalogue(f.db, f.options)).total, 2);
});

test("subscriber status exposes only allowlisted source metadata without writes or playback permissions", async () => {
  const f = fixture(), grant = f.d.audits.get(CONTINUOUS_CONTROL_ID).details.command;
  Object.assign(f.d.station.streamConfig, { encoderLeaseOwner: `${P.leasePrefix}fixture`, encoderLeaseUntil: new Date(NOW.getTime() + 30_000) });
  f.d.audits.set(CONTINUOUS_OBSERVATION_ID, { details: { grantId: grant.id, leaseOwner: f.d.station.streamConfig.encoderLeaseOwner,
    state: "STREAMING", phase: "RANDOM", trackId: f.d.tracks[0].id, title: "Title 1", artist: "Artist 1", audioBytesSent: 128,
    observedAt: NOW.toISOString(), sourceStartedAt: NOW.toISOString(), secret: "DO_NOT_LEAK" } });
  const before = clone(f.d.audits), result = await subscriberSchedule(f.db, f.options);
  assert.equal(result.nowNext.source.confirmed, true);
  assert.equal(result.nowNext.source.phase, "RANDOM");
  assert.equal(result.canApprove, false);
  assert.equal(result.sources[0].eligibleTrackCount, 2);
  assert.equal(result.sources[0].eligibleDurationSeconds, 360);
  assert.deepEqual(result.sources[0].unavailableGenreCodes, []);
  assert.doesNotMatch(JSON.stringify(result.nowNext), /DO_NOT_LEAK|grantId|leaseOwner|storageKey|sourcePassword|listenerUrl|https?:/);
  assert.deepEqual(f.d.audits, before); assert.equal(f.d.writes.length, 0);
  const stale = await subscriberSchedule(f.db, { ...f.options, now: new Date(NOW.getTime() + 16_000) });
  assert.equal(stale.nowNext.source.confirmed, false); assert.equal(stale.nowNext.source.track, null);
});
test("recipe save creates isolated canonical draft records once and never changes controls or existing templates", async () => {
  const f = fixture(), controls = clone(f.d.audits), original = clone(f.d.modes[0]);
  const input = { ...recipe, requestId: NONCE };
  const [a, b] = await Promise.all([subscriberCreateRecipe(f.db, { ...f.options, input }), subscriberCreateRecipe(f.db, { ...f.options, input })]);
  assert.equal(a.savedSourceId, b.savedSourceId); assert.equal(f.d.modes.length, 2); assert.deepEqual(f.d.modes[0], original);
  const mode = f.d.modes[1]; assert.equal(mode.status, "DRAFT"); assert.equal(mode.smartPlaylist.status, "DRAFT"); assert.equal(mode.smartPlaylist.createdByUserId, USER);
  assert.deepEqual(mode.smartPlaylist.genreCodes, ["POP", "POP", "ROCK"]); assert.equal(mode.smartPlaylist.musicModeId, mode.id);
  for (const [id, value] of controls) assert.deepEqual(f.d.audits.get(id), value);
  assert.deepEqual(f.d.writes.map(w => w.model), ["MusicMode", "SmartPlaylist", "AuditLog"]);
  await assert.rejects(subscriberCreateRecipe(f.db, { ...f.options, input: { ...input, name: "Other" } }), { code: "SUBSCRIBER_RETRY_CHANGED" });
});
test("recipe pools, durations and total recipe count retain existing worker safety bounds", async () => {
  const f = fixture(); f.d.tracks = Array.from({ length: 65 }, (_, i) => track(i + 1));
  await assert.rejects(subscriberPreviewRecipe(f.db, { ...f.options, input: { ...recipe, genreCodes: ["POP"] } }), { code: "LIBRARY_RECIPE_TOO_LARGE" });
  const g = fixture(); for (let i = 1; i < 20; i++) { const mode = clone(g.d.modes[0]); mode.id += i; mode.smartPlaylist.id += i; mode.smartPlaylist.musicModeId = mode.id; g.d.modes.push(mode); }
  await assert.rejects(subscriberCreateRecipe(g.db, { ...g.options, input: { ...recipe, requestId: NONCE } }), { code: "LIBRARY_RECIPE_LIMIT" });
  await assert.rejects(subscriberPreviewRecipe(g.db, { ...g.options, input: { ...recipe, durationMinutes: 181 } }), { code: "LIBRARY_RECIPE_INVALID" });
  assert.equal(g.d.writes.length, 0);
});
test("weekly save appends draft only, retries exactly once and detects stale windows without mutating prior versions", async () => {
  const f = fixture(), controls = clone(f.d.audits);
  const a = await subscriberSaveSchedule(f.db, { ...f.options, input: f.week });
  assert.equal(a.savedVersionId, a.draft.id); assert.equal(a.canApprove, false); assert.equal(a.draft.readyToApprove, false); assert.equal(a.draft.reviewHash, null);
  const b = await subscriberSaveSchedule(f.db, { ...f.options, input: f.week }); assert.equal(b.savedVersionId, a.savedVersionId); assert.equal(f.d.versions.length, 1);
  const original = clone(f.d.versions[0]);
  const c = await subscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week, baseVersionId: a.draft.id, requestId: SECOND, name: "Later week" } });
  assert.equal(c.draft.version, 2); assert.deepEqual(f.d.versions[0], original);
  await assert.rejects(subscriberSaveSchedule(f.db, { ...f.options, input: f.week }), { code: "SUBSCRIBER_DRAFT_CHANGED" });
  await assert.rejects(subscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week, requestId: "31400821-cc19-4c1d-bd7a-c723b8d35417" } }), { code: "SUBSCRIBER_DRAFT_CHANGED" });
  for (const [id, value] of controls) assert.deepEqual(f.d.audits.get(id), value);
  assert.ok(f.d.versions.every(v => v.status === "DRAFT" && v.isActive === false));
});
test("subscriber drafts remain separate from the actual signed owner-approved on-air week", async () => {
  const f = fixture();
  await subscriberSaveSchedule(f.db, { ...f.options, input: f.week });
  const reviewed = await continuousScheduleDashboard(f.db, { ...f.ownerOptions, channelId: CHANNEL });
  assert.equal(reviewed.draft.readyToApprove, true, reviewed.warnings.join("; "));
  await approveContinuousSchedule(f.db, { ...f.ownerOptions, channelId: CHANNEL, versionId: reviewed.draft.id,
    reviewHash: reviewed.draft.reviewHash, overridesAcknowledged: true });
  const signed = clone(f.d.audits.get(S.controlId)), current = clone(f.d.versions[0]), stream = clone(f.d.audits.get(CONTINUOUS_CONTROL_ID));
  const updated = await subscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week, requestId: SECOND, baseVersionId: current.id,
    items: f.week.items.map(item => ({ ...item, startTime: "16:00" })) } });
  assert.equal(updated.draft.version, 2); assert.equal(updated.approved.version, 1); assert.equal(updated.approved.enabled, true);
  assert.deepEqual(f.d.audits.get(S.controlId), signed); assert.deepEqual(f.d.audits.get(CONTINUOUS_CONTROL_ID), stream); assert.deepEqual(f.d.versions[0], current);
  const authorized = await loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV });
  const runtime = await loadAuthorizedContinuousSchedule(f.db, { authorized, now: NOW, env: ENV });
  assert.equal(runtime.enabled, true); assert.equal(runtime.versionId, current.id); assert.equal(runtime.occurrences[0].startsAt, "2026-10-23T12:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(updated), /storageKey|mediaAsset|fingerprint|password|secret|https?:/i);
});
test("foreign channels/sources, changed timezone, revoked grant and missing revision token fail closed", async () => {
  const f = fixture();
  await assert.rejects(subscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week, channelId: "cmforeignchannel00001" } }), { code: "SCHEDULE_CHANNEL_INVALID" });
  await assert.rejects(subscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week, baseVersionId: undefined } }), { code: "SUBSCRIBER_BASE_VERSION_REQUIRED" });
  await assert.rejects(subscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week, items: f.week.items.map(item => ({ ...item, sourceId: "cmforeignmusicmode001" })) } }), { code: "SCHEDULE_SOURCE_UNAVAILABLE" });
  const saved = await subscriberSaveSchedule(f.db, { ...f.options, input: f.week });
  await assert.rejects(subscriberSaveSchedule(f.db, { ...f.options, input: { ...f.week, requestId: SECOND, baseVersionId: saved.draft.id, timezone: "UTC" } }), { code: "SCHEDULE_TIMEZONE_IMMUTABLE" });
  f.d.audits.delete(CONTINUOUS_CONTROL_ID);
  await assert.rejects(subscriberLibrary(f.db, f.options), { code: "CONTINUOUS_NOT_ENABLED" });
});
test("actual Prisma generated nested items and separate recipe inputs match all new write shapes", async () => {
  const f = fixture(); await subscriberCreateRecipe(f.db, { ...f.options, input: { ...recipe, requestId: NONCE } }); await subscriberSaveSchedule(f.db, { ...f.options, input: f.week });
  const declarations = await readFile(new URL("../node_modules/.prisma/client/index.d.ts", import.meta.url), "utf8");
  for (const model of ["MusicMode", "SmartPlaylist", "ProgrammeSchedule", "ProgrammeScheduleVersion"]) {
    const shape = declarations.match(new RegExp(`export type ${model}UncheckedCreateInput = \\{([\\s\\S]*?)\\n  \\}`))?.[1]; assert.ok(shape);
    const fields = new Set([...shape.matchAll(/^    ([a-zA-Z0-9_]+)\??:/gm)].map(m => m[1]));
    for (const key of Object.keys(f.d.writes.find(w => w.model === model).data)) assert.ok(fields.has(key), `${model}.${key}`);
  }
  const shape = declarations.match(/export type ProgrammeScheduleItemUncheckedCreateWithoutVersionInput = \{([\s\S]*?)\n  \}/)?.[1]; assert.ok(shape);
  const fields = new Set([...shape.matchAll(/^    ([a-zA-Z0-9_]+)\??:/gm)].map(m => m[1]));
  for (const item of f.d.writes.find(w => w.model === "ProgrammeScheduleVersion").data.items.create)
    for (const key of Object.keys(item)) assert.ok(fields.has(key), `ProgrammeScheduleItem.${key}`);
});
test("bounded command reader accepts only same-origin metadata/draft actions and explicit fields", async () => {
  const request = (input, origin = P.origin) => new Request(`${P.origin}/api/programming/test-radio/library`, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal((await subscriberCommand(request({ action: "preview", ...recipe }), "library")).action, "preview");
  for (const input of [{ action: "start" }, { action: "approve" }, { action: "disable" }, { action: "save", ...recipe, enabled: true },
    { action: "save", ...recipe, organisationId: ORG }, { action: "save", ...recipe, seed: "x" }, { action: "preview", ...recipe, name: "x".repeat(5000) }])
    await assert.rejects(subscriberCommand(request(input), "library"), { code: "SUBSCRIBER_BODY_INVALID" });
  await assert.rejects(subscriberCommand(request({ action: "preview", ...recipe }, "https://foreign.example"), "library"), { code: "SUBSCRIBER_ORIGIN_INVALID" });
  await assert.rejects(subscriberCommand(request({ action: "approve", channelId: CHANNEL }), "schedule"), { code: "SUBSCRIBER_BODY_INVALID" });
  assert.throws(() => subscriberQuery(new Request(`${P.origin}/?q=one&q=two`), ["q"]), { code: "SUBSCRIBER_QUERY_INVALID" });
  assert.throws(() => subscriberQuery(new Request(`${P.origin}/?stationId=foreign`), ["q"]), { code: "SUBSCRIBER_QUERY_INVALID" });
  assert.equal(subscriberErrorStatus("SUBSCRIBER_DRAFT_CHANGED"), 409);
});
test("all real new routes bind fresh organisation context and cannot dispatch streaming or owner actions", async () => {
  const require = createRequire(import.meta.url), babel = require("next/dist/compiled/babel/core");
  const services = await import("../lib/test-radio-subscriber-service.mjs"), requestTools = await import("../lib/test-radio-subscriber-request.mjs");
  for (const kind of ["catalogue", "library", "schedule"]) {
    const filename = `app/api/programming/test-radio/${kind}/route.js`, source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
    const module = { exports: {} }, calls = [], context = {};
    vm.runInNewContext(code, { module, exports: module.exports, Date, require: name => {
      if (name === "next/server") return { NextResponse: { json: (body, options) => ({ body, ...options }) } };
      if (name === "@/lib/prisma") return { prisma: {} };
      if (name === "@/lib/auth") return { getActiveOrganisationContext: async include => { assert.ok(include.subscription.include.plan); return context; } };
      if (name === "@/lib/test-radio-subscriber-access.mjs") return { TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE: { subscription: { include: { plan: true } } } };
      if (name === "@/lib/private-preview-request.mjs") return { PREVIEW_RESPONSE_HEADERS: { "cache-control": "private, no-store" } };
      if (name === "@/lib/test-radio-subscriber-request.mjs") return requestTools;
      if (name === "@/lib/test-radio-subscriber-service.mjs") return { ...services, ...Object.fromEntries(["subscriberCatalogue", "subscriberLibrary", "subscriberPreviewRecipe", "subscriberCreateRecipe", "subscriberSchedule", "subscriberSaveSchedule"].map(fn => [fn, async (_db, args) => { assert.equal(args.context, context); calls.push(fn); return { stationId: P.stationId }; }])) };
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    } });
    assert.equal((await module.exports.GET(new Request(`${P.origin}/api/programming/test-radio/${kind}`))).status, 200);
    assert.equal(module.exports.DELETE, undefined); assert.equal(module.exports.PUT, undefined);
    if (kind === "catalogue") assert.equal(module.exports.POST, undefined);
    else {
      const before = calls.length;
      for (const action of ["start", "stop", "approve", "disable", "publish"]) {
        const response = await module.exports.POST(new Request(`${P.origin}/api/programming/test-radio/${kind}`, { method: "POST", headers: { origin: P.origin, "content-type": "application/json" }, body: JSON.stringify({ action }) }));
        assert.equal(response.status, 400);
      }
      assert.equal(calls.length, before);
    }
  }
});
