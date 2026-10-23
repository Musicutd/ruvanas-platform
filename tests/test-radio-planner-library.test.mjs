import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN } from "../lib/private-preview-account-policy.mjs";
import { TEST_RADIO_CONTINUOUS as P, continuousSourceFingerprint, signContinuousCommand } from "../lib/test-radio-continuous-policy.mjs";
import { CONTINUOUS_CONTROL_ID, loadAuthorizedContinuousRadio } from "../lib/test-radio-continuous-service.mjs";
import { CONTINUOUS_SCHEDULE, parseContinuousSchedule } from "../lib/test-radio-continuous-schedule-policy.mjs";
import { continuousScheduleDashboard, approveContinuousSchedule, loadAuthorizedContinuousSchedule } from "../lib/test-radio-continuous-schedule-service.mjs";
import { parseTestRadioRecipe, testRadioPlannerLibrary, previewTestRadioRecipe, createTestRadioRecipe } from "../lib/test-radio-planner-library.mjs";

const NOW = new Date("2026-10-23T08:00:00Z"), BEFORE = new Date("2026-10-20T00:00:00Z");
const ENV = { SECRET_ENCRYPTION_KEY: "ad".repeat(32), RUVANAS_TEST_RADIO_CONTINUOUS_ENABLED: "true" };
const ORG = "cmtestorganisation00001", OWNER = "cmtestowner00000000001", MODE = "cmtestmusicmode0000001";
const NONCE = "31400821-cc19-4c1d-bd7a-c723b8d35415", clone = value => structuredClone(value);
const recipe = { name: "My reusable mix", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"], durationMinutes: 30 };
function track(i = 1, genreCode = "pop") {
  const assetId = `cmtestasset${String(i).padStart(10, "0")}`;
  return { id: `cmtesttrack${String(i).padStart(10, "0")}`, mediaAssetId: assetId, title: `Title ${i}`, artist: `Artist ${i}`, status: "READY",
    catalogueProvider: null, minimumCatalogueLevel: "FOCUSED", rightsHolder: "Owner", rightsReference: "Direct permission", rightsBasis: "OTHER",
    rightsReviewStatus: "APPROVED", rightsReviewedAt: BEFORE, rightsReviewedById: OWNER, rightsConfirmedAt: BEFORE, rightsConfirmedById: OWNER,
    permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"], licenceStartsAt: null, licenceExpiresAt: new Date("2026-12-01T00:00:00Z"), updatedAt: BEFORE, distributorItems: [],
    mediaAsset: { id: assetId, organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC", status: "READY", licensedCatalogue: true,
      storageKey: `catalogue/music/${i.toString(16).padStart(64, "0")}.mp3`, sizeBytes: 1000000n, durationSeconds: 180, mimeType: "audio/mpeg", updatedAt: BEFORE,
      genres: [{ mediaGenre: { id: `cmgenre${genreCode}`, slug: genreCode, name: genreCode, active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED" } }] } };
}
function fixture() {
  let next = 0, tail = Promise.resolve();
  const config = { stationId: P.stationId, providerKey: "CENTOVA_CAST", streamUrl: P.listenerUrl, serverHost: P.host, serverPort: P.port,
    sourcePort: P.port, sourceUsername: null, centovaUsername: P.account, bitrateKbps: 128, sourcePasswordEncrypted: "test-ciphertext", outboundAutoDjEnabled: false };
  const station = { id: P.stationId, organisationId: ORG, productFamily: "ONLINE", status: "DRAFT", publicPlayerEnabled: false, stationWebsiteEnabled: false,
    streamConfig: config, organisation: { id: ORG, subscription: { organisationId: ORG, plan: clone(PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN), status: "TRIAL",
      onlineRadioEnabled: true, currentPeriodEnd: new Date("2026-11-23T00:00:00Z"), billingContract: null } } };
  const modes = [{ id: MODE, organisationId: ORG, name: "Existing pop template", source: "SMART_PLAYLIST", status: "DRAFT", smartPlaylist: {
    id: "cmplaylist000000000001", musicModeId: MODE, organisationId: ORG, version: 1, status: "DRAFT", rightsUse: "ONLINE_RADIO", simpleBuildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"], durationMinutes: 60 } }];
  const d = { station, modes, tracks: [track(1), track(2), track(3, "rock")], audits: new Map(), writes: [], role: "SUPER_ADMIN" };
  const actorSession = { id: "cmownersession00000001", userId: OWNER, user: { id: OWNER, role: "SUPER_ADMIN", privatePreviewAccess: null },
    authMethod: "PASSWORD", activeOrganisationId: null, activeOrganisation: null, createdAt: BEFORE, lastSeenAt: NOW, revokedAt: null, expiresAt: new Date(NOW.getTime() + 3600000) };
  const grant = { kind: P.kind, action: "START", id: "fa633d3e-1bb3-4b01-ad45-7c73f48bc8ef", sequence: 1, stationId: P.stationId, organisationId: ORG,
    actorUserId: OWNER, sourceFingerprint: continuousSourceFingerprint(config), issuedAt: BEFORE.toISOString(), publicExposureAccepted: true, monthlyBudgetUsd: 15, bitrateKbps: 128, territory: "MT", catalogueLevel: "FOCUSED" };
  d.audits.set(CONTINUOUS_CONTROL_ID, { details: { command: grant, signature: signContinuousCommand(grant, ENV) } });
  d.audits.set(CONTINUOUS_SCHEDULE.controlId, { details: { command: { action: "APPROVE", fixture: "existing approval unchanged" } } });
  const matching = (mode, where) => mode.organisationId === where.organisationId && (!where.id || mode.id === where.id) && mode.source === where.source &&
    where.status.in.includes(mode.status) && mode.smartPlaylist?.organisationId === where.smartPlaylist.organisationId && where.smartPlaylist.status.in.includes(mode.smartPlaylist.status) &&
    mode.smartPlaylist.rightsUse === where.smartPlaylist.rightsUse && where.smartPlaylist.simpleBuildMode.in.includes(mode.smartPlaylist.simpleBuildMode);
  const db = {
    station: { findUnique: async ({ where }) => { assert.equal(where.id, P.stationId); return clone(d.station); } },
    mediaGenre: { findMany: async () => [track(1).mediaAsset.genres[0].mediaGenre, track(3, "rock").mediaAsset.genres[0].mediaGenre] },
    track: { findMany: async () => clone(d.tracks) }, user: { findUnique: async ({ where }) => where.id === OWNER ? { id: OWNER, role: d.role } : null },
    onlineRadioCatalogueTest: { findFirst: async () => null },
    musicMode: {
      findMany: async ({ where, take }) => { assert.equal(where.organisationId, ORG); return clone(d.modes.filter(mode => matching(mode, where)).slice(0, take)); },
      findFirst: async ({ where }) => clone(d.modes.find(mode => matching(mode, where)) || null),
      count: async ({ where }) => { assert.equal(where.organisationId, ORG); return d.modes.filter(mode => matching(mode, where)).length; },
      create: async ({ data }) => { assert.equal(data.organisationId, ORG); const row = { id: `cmmode${String(++next).padStart(18, "0")}`, ...clone(data), smartPlaylist: null }; d.modes.push(row); d.writes.push({ model: "MusicMode", data: clone(data) }); return clone(row); },
    },
    smartPlaylist: { create: async ({ data }) => {
      assert.equal(data.organisationId, ORG); assert.equal(Object.hasOwn(data, "name"), false); assert.equal(Object.hasOwn(data, "tracks"), false);
      const row = { id: `cmplaylist${String(++next).padStart(14, "0")}`, version: 1, ...clone(data) };
      const mode = d.modes.find(item => item.id === data.musicModeId); assert.equal(mode.organisationId, ORG); mode.smartPlaylist = row;
      d.writes.push({ model: "SmartPlaylist", data: clone(data) }); return clone(row);
    } },
    auditLog: {
      findUnique: async ({ where }) => clone(d.audits.get(where.id) || null),
      create: async ({ data }) => { assert.equal(d.audits.has(data.id), false); d.audits.set(data.id, clone(data)); d.writes.push({ model: "AuditLog", data: clone(data) }); return clone(data); },
    },
  };
  db.$transaction = async (action, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    let unlock; const gate = new Promise(resolve => { unlock = resolve; }), prior = tail; tail = prior.then(() => gate); await prior;
    const before = clone({ modes: d.modes, audits: d.audits, writes: d.writes });
    try { return await action(db); } catch (error) { Object.assign(d, before); throw error; } finally { unlock(); }
  };
  return { db, d, options: { actorSession, now: NOW, env: ENV }, input: { ...clone(recipe), requestId: NONCE } };
}
test("dashboard loads only Test Radio organisation recipes and current eligible genre counts without secrets", async () => {
  const f = fixture(); f.d.modes.push({ ...clone(f.d.modes[0]), id: "cmforeign", organisationId: "foreign" });
  const result = await testRadioPlannerLibrary(f.db, f.options);
  assert.equal(result.stationId, P.stationId); assert.equal(result.recipes.length, 1); assert.equal(result.recipes[0].sourceId, MODE);
  assert.equal(result.recipes[0].eligibleTrackCount, 2); assert.equal(result.recipes[0].readyForSchedule, true);
  assert.deepEqual(result.genres.map(g => [g.code, g.eligibleTrackCount]), [["POP", 2], ["ROCK", 1]]);
  assert.doesNotMatch(JSON.stringify(result), /storageKey|mediaAsset|fingerprint|password|secret|https?:/i);
  assert.equal(f.d.writes.length, 0);
});
test("generate returns deterministic bounded metadata-only example order and never writes", async () => {
  const f = fixture(), options = { ...f.options, input: { ...recipe, seed: "repeatable-preview" } };
  const a = await previewTestRadioRecipe(f.db, options), b = await previewTestRadioRecipe(f.db, options);
  assert.deepEqual(a, b); assert.equal(a.preview.items.length, 10); assert.equal(a.preview.totalDurationSeconds, 1800);
  assert.equal(a.preview.liveOrderFixed, false); assert.equal(a.preview.truncated, false);
  assert.ok(a.preview.warnings.some(w => w.includes("final song")));
  assert.doesNotMatch(JSON.stringify(a), /storageKey|mediaAsset|fingerprint|password|secret|https?:/i);
  assert.equal(f.d.writes.length, 0);
});
test("genre sequence repeats a deliberate pattern and excludes newly revoked recordings", async () => {
  const f = fixture(); f.d.tracks[0].rightsReviewStatus = "REJECTED";
  const result = await previewTestRadioRecipe(f.db, { ...f.options, input: { ...recipe, buildMode: "GENRE_SEQUENCE", genreCodes: ["POP", "ROCK", "POP"], seed: "sequence" } });
  assert.deepEqual(result.preview.items.slice(0, 3).map(item => item.genreCodes[0]), ["POP", "ROCK", "POP"]);
  assert.ok(result.preview.items.every(item => item.trackId !== f.d.tracks[0].id));
});
test("save-as-new creates worker-compatible DRAFT records only and preserves existing approval and recipes", async () => {
  const f = fixture(), existing = clone(f.d.modes[0]), controls = clone(f.d.audits);
  const result = await createTestRadioRecipe(f.db, { ...f.options, input: f.input });
  assert.ok(result.savedSourceId); assert.equal(result.recipes.length, 2); assert.deepEqual(f.d.modes[0], existing);
  const saved = f.d.modes.find(mode => mode.id === result.savedSourceId);
  assert.equal(saved.status, "DRAFT"); assert.equal(saved.source, "SMART_PLAYLIST"); assert.equal(saved.smartPlaylist.status, "DRAFT");
  assert.equal(saved.smartPlaylist.rightsUse, "ONLINE_RADIO"); assert.equal(saved.smartPlaylist.territory, "MT");
  assert.equal(saved.smartPlaylist.simpleBuildMode, "RANDOM_GENRE_POOL"); assert.deepEqual(saved.smartPlaylist.genreCodes, ["POP"]);
  for (const [id, row] of controls) assert.deepEqual(f.d.audits.get(id), row);
  assert.deepEqual(f.d.writes.map(row => row.model), ["MusicMode", "SmartPlaylist", "AuditLog"]);
  assert.equal(f.d.writes[2].data.details.stationId, P.stationId);
});

test("a newly saved genre sequence crosses the real schedule approval and worker runtime contract unchanged", async () => {
  const f = fixture(), continuousBefore = clone(f.d.audits.get(CONTINUOUS_CONTROL_ID));
  const saved = await createTestRadioRecipe(f.db, { ...f.options, input: { ...f.input,
    buildMode: "GENRE_SEQUENCE", genreCodes: ["POP", "POP", "ROCK"] } });
  const mode = f.d.modes.find(row => row.id === saved.savedSourceId);
  assert.ok(mode); assert.notEqual(saved.savedSourceId, mode.smartPlaylist.id);
  const channel = { id: "cmtestchannel000000001", stationId: P.stationId, organisationId: ORG, musicRightsUse: "ONLINE_RADIO", status: "DRAFT" };
  const parsed = parseContinuousSchedule({ channelId: channel.id, name: "New recipe contract week", timezone: "Europe/Malta", items: [
    { label: "Two pop then rock", recurrence: "WEEKLY", weekday: 5, startTime: "14:00", durationMinutes: 30,
      priority: 0, sourceType: "MUSIC_MODE", sourceId: saved.savedSourceId } ] });
  const version = { id: "cmtestversion000000001", scheduleId: "cmtestschedule00000001", organisationId: ORG, version: 1, status: "DRAFT", isActive: false,
    items: parsed.items.map((item, index) => ({ ...item, id: `cmtestitem${index}`, organisationId: ORG, versionId: "cmtestversion000000001" })) };
  const schedule = { id: version.scheduleId, organisationId: ORG, channelId: channel.id, name: parsed.name, timezone: parsed.timezone, versions: [version] };
  f.db.channel = {
    findMany: async ({ where }) => { assert.equal(where.stationId, P.stationId); assert.equal(where.organisationId, ORG); return [clone(channel)]; },
    findFirst: async ({ where }) => { assert.equal(where.id, channel.id); assert.equal(where.stationId, P.stationId); assert.equal(where.organisationId, ORG); return clone(channel); },
  };
  f.db.programmeSchedule = { findFirst: async ({ where }) => { assert.equal(where.channelId, channel.id); assert.equal(where.organisationId, ORG); return clone(schedule); } };
  f.db.programmeScheduleVersion = { findFirst: async ({ where }) => {
    assert.equal(where.id, version.id); assert.equal(where.scheduleId, schedule.id); assert.equal(where.organisationId, ORG);
    return clone(version);
  } };
  f.db.musicMode.findMany = async ({ where }) => {
    assert.equal(where.organisationId, ORG); assert.equal(where.source, "SMART_PLAYLIST");
    return clone(f.d.modes.filter(row => row.organisationId === ORG && where.status.in.includes(row.status) && (!where.id || where.id.in.includes(row.id))));
  };
  f.db.auditLog.upsert = async ({ where, create, update }) => {
    const row = f.d.audits.has(where.id) ? { ...f.d.audits.get(where.id), ...clone(update) } : clone(create);
    f.d.audits.set(where.id, row); return clone(row);
  };
  const screen = await continuousScheduleDashboard(f.db, { ...f.options, channelId: channel.id });
  assert.equal(screen.draft.readyToApprove, true, screen.warnings.join("; "));
  assert.equal(screen.draft.items[0].sourceId, saved.savedSourceId);
  await approveContinuousSchedule(f.db, { ...f.options, channelId: channel.id, versionId: version.id,
    reviewHash: screen.draft.reviewHash, overridesAcknowledged: true });
  const authorized = await loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV });
  const runtime = await loadAuthorizedContinuousSchedule(f.db, { authorized, now: NOW, env: ENV });
  assert.equal(runtime.enabled, true); assert.equal(runtime.revisionFingerprint, screen.draft.reviewHash);
  assert.equal(runtime.occurrences.length, 1);
  const occurrence = runtime.occurrences[0];
  assert.equal(occurrence.sourceId, mode.id); assert.equal(occurrence.startsAt, "2026-10-23T12:00:00.000Z");
  assert.equal(occurrence.endsAt, "2026-10-23T12:30:00.000Z");
  assert.deepEqual(occurrence.config, { buildMode: "GENRE_SEQUENCE", genreCodes: ["POP", "POP", "ROCK"] });
  assert.deepEqual(occurrence.tracks.map(row => row.trackId).sort(), f.d.tracks.map(row => row.id).sort());
  assert.ok(occurrence.tracks.every(row => row.fingerprint && row.mediaAssetId && row.durationSeconds === 180));
  assert.deepEqual(f.d.audits.get(CONTINUOUS_CONTROL_ID), continuousBefore);
  assert.equal(mode.status, "DRAFT"); assert.equal(version.isActive, false); assert.equal(channel.status, "DRAFT");
});
test("same nonce recovers an uncertain save exactly once and rejects changed retry payload", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([createTestRadioRecipe(f.db, { ...f.options, input: f.input }), createTestRadioRecipe(f.db, { ...f.options, input: f.input })]);
  assert.equal(a.savedSourceId, b.savedSourceId); assert.equal(f.d.modes.length, 2); assert.equal(f.d.writes.length, 3);
  await assert.rejects(createTestRadioRecipe(f.db, { ...f.options, input: { ...f.input, name: "Changed retry" } }), { code: "LIBRARY_RETRY_CHANGED" });
  assert.equal(f.d.modes.length, 2);
});
test("current source cap is serialized, allows existing loads, and never changes other organisation records", async () => {
  const f = fixture();
  for (let i = 1; i < 19; i++) { const mode = clone(f.d.modes[0]); mode.id = `mode-${i}`; mode.smartPlaylist.id = `playlist-${i}`; mode.smartPlaylist.musicModeId = mode.id; f.d.modes.push(mode); }
  const results = await Promise.allSettled([createTestRadioRecipe(f.db, { ...f.options, input: f.input }), createTestRadioRecipe(f.db, { ...f.options, input: { ...f.input, requestId: "31400821-cc19-4c1d-bd7a-c723b8d35416" } })]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.find(item => item.status === "rejected").reason.code, "LIBRARY_RECIPE_LIMIT");
  assert.equal((await testRadioPlannerLibrary(f.db, f.options)).recipes.length, 20);
});
test("invalid owner, unavailable grant, locked genres and unsupported recipe inputs cannot create or preview", async () => {
  const f = fixture(), wrong = clone(f.options); wrong.actorSession.user.role = "OWNER";
  await assert.rejects(testRadioPlannerLibrary(f.db, wrong), { code: "LIBRARY_OWNER_REQUIRED" });
  await assert.rejects(previewTestRadioRecipe(f.db, { ...f.options, input: { ...recipe, genreCodes: ["COUNTRY"] } }), { code: "LIBRARY_GENRE_UNAVAILABLE" });
  for (const change of [{ durationMinutes: 181 }, { durationMinutes: 0 }, { buildMode: "FIXED_ORDER" }, { genreCodes: ["POP", "POP"] }, { name: "x" }, { name: "bad\nname" }])
    assert.throws(() => parseTestRadioRecipe({ ...recipe, ...change }), { code: "LIBRARY_RECIPE_INVALID" });
  await assert.rejects(createTestRadioRecipe(f.db, { ...f.options, input: { ...f.input, requestId: "not-uuid" } }), { code: "LIBRARY_REQUEST_ID_REQUIRED" });
  f.d.audits.delete(CONTINUOUS_CONTROL_ID);
  await assert.rejects(createTestRadioRecipe(f.db, { ...f.options, input: f.input }), { code: "CONTINUOUS_NOT_ENABLED" });
  assert.equal(f.d.writes.length, 0);
});
test("unique matching pool is capped at64 regardless of preview length; pathological short music cannot overfill a programme", async () => {
  const f = fixture(); f.d.tracks = Array.from({ length: 65 }, (_, i) => track(i + 1));
  await assert.rejects(previewTestRadioRecipe(f.db, { ...f.options, input: { ...recipe, durationMinutes: 1 } }), { code: "LIBRARY_RECIPE_TOO_LARGE" });
  await assert.rejects(createTestRadioRecipe(f.db, { ...f.options, input: f.input }), { code: "LIBRARY_RECIPE_TOO_LARGE" });
  assert.equal((await testRadioPlannerLibrary(f.db, f.options)).recipes[0].readyForSchedule, false);
  f.d.tracks = [track(1), track(2)]; for (const t of f.d.tracks) t.mediaAsset.durationSeconds = 3;
  await assert.rejects(previewTestRadioRecipe(f.db, { ...f.options, input: { ...recipe, durationMinutes: 180 } }), { code: "LIBRARY_PROGRAMME_TOO_DENSE" });
  assert.equal(f.d.writes.length, 0);
});
test("preview caps metadata rows honestly and preserves existing long-duration template metadata", async () => {
  const f = fixture(); f.d.modes[0].smartPlaylist.durationMinutes = 1440;
  assert.equal((await testRadioPlannerLibrary(f.db, f.options)).recipes[0].durationMinutes, 1440);
  for (const t of f.d.tracks) t.mediaAsset.durationSeconds = 3;
  const result = await previewTestRadioRecipe(f.db, { ...f.options, input: { ...recipe, durationMinutes: 30 } });
  assert.equal(result.preview.items.length, 200); assert.equal(result.preview.truncated, true); assert.equal(result.preview.totalDurationSeconds, 600);
});
test("real generated Prisma create inputs support both separate records without invented fields", async () => {
  const declarations = await readFile(new URL("../node_modules/.prisma/client/index.d.ts", import.meta.url), "utf8");
  const modeShape = declarations.match(/export type MusicModeUncheckedCreateInput = \{([\s\S]*?)\n  \}/)?.[1];
  const playlistShape = declarations.match(/export type SmartPlaylistUncheckedCreateInput = \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(modeShape); assert.ok(playlistShape);
  const f = fixture(); await createTestRadioRecipe(f.db, { ...f.options, input: f.input });
  for (const [shape, model] of [[modeShape, "MusicMode"], [playlistShape, "SmartPlaylist"]]) {
    const fields = new Set([...shape.matchAll(/^    ([a-zA-Z0-9_]+)\??:/gm)].map(match => match[1]));
    for (const key of Object.keys(f.d.writes.find(write => write.model === model).data)) assert.ok(fields.has(key), `${model}.${key} must be a real generated Prisma field`);
  }
});
test("real route limits requests to canonical-origin owner Test Radio preview/save and blocks extra mutations", async () => {
  const require = createRequire(import.meta.url), babel = require("next/dist/compiled/babel/core");
  const filename = "app/api/admin/stations/[stationId]/continuous-playlists/route.js";
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  const code = babel.transformSync(source, { filename, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
  const module = { exports: {} }, calls = [], actor = { userId: OWNER }; let owner = true;
  const { readPrivatePreviewBody } = await import("../lib/private-preview-request.mjs");
  const services = { testRadioPlannerLibrary: async () => ({ stationId: P.stationId }), testRadioLibraryMessage: () => "Safe error",
    previewTestRadioRecipe: async (_db, args) => { calls.push(args); return { stationId: P.stationId }; },
    createTestRadioRecipe: async (_db, args) => { calls.push(args); return { stationId: P.stationId }; } };
  vm.runInNewContext(code, { module, exports: module.exports, Date, require: name => {
    if (name === "next/server") return { NextResponse: { json: (body, options) => ({ body, ...options }) } };
    if (name === "@/lib/prisma") return { prisma: {} };
    if (name === "@/lib/auth") return { getCurrentSession: async () => owner ? actor : null };
    if (name === "@/lib/catalogue-test-service.mjs") return { catalogueTestOwnerSessionValid: session => session === actor };
    if (name === "@/lib/test-radio-continuous-policy.mjs") return { TEST_RADIO_CONTINUOUS: P };
    if (name === "@/lib/private-preview-request.mjs") return { readPrivatePreviewBody };
    if (name === "@/lib/test-radio-planner-library.mjs") return services;
    return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
  } });
  const params = { params: Promise.resolve({ stationId: P.stationId }) };
  const request = (body, origin = P.origin) => new Request(`${P.origin}/api/admin/stations/${P.stationId}/continuous-playlists`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await module.exports.POST(request({ action: "preview", ...recipe }), params)).status, 200);
  assert.equal((await module.exports.POST(request({ action: "save", ...recipe, requestId: NONCE }), params)).status, 200);
  const before = calls.length;
  for (const body of [{ action: "publish" }, { action: "save", ...recipe, enabled: true }, { action: "save", ...recipe, seed: "bad" },
    { action: "preview", ...recipe, requestId: NONCE }, { action: "preview", ...recipe, name: "x".repeat(5000) }])
    assert.equal((await module.exports.POST(request(body), params)).status, 400);
  assert.equal((await module.exports.POST(request({ action: "preview", ...recipe }, "https://evil.example"), params)).status, 403);
  assert.equal((await module.exports.POST(request({ action: "preview", ...recipe }), { params: Promise.resolve({ stationId: "other" }) })).status, 404);
  owner = false; assert.equal((await module.exports.POST(request({ action: "preview", ...recipe }), params)).status, 403);
  assert.equal(calls.length, before);
});
