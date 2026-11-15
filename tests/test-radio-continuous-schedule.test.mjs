import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN } from "../lib/private-preview-account-policy.mjs";
import { TEST_RADIO_CONTINUOUS as P, continuousSourceFingerprint, signContinuousCommand } from "../lib/test-radio-continuous-policy.mjs";
import { CONTINUOUS_CONTROL_ID, loadAuthorizedContinuousRadio } from "../lib/test-radio-continuous-service.mjs";
import { CONTINUOUS_SCHEDULE as S, parseContinuousSchedule, compileContinuousSchedule, scheduleHash, simpleScheduleSource } from "../lib/test-radio-continuous-schedule-policy.mjs";
import { continuousScheduleDashboard, saveContinuousScheduleDraft, approveContinuousSchedule, disableContinuousSchedule, loadAuthorizedContinuousSchedule } from "../lib/test-radio-continuous-schedule-service.mjs";

const NOW = new Date("2026-10-23T08:00:00Z"), BEFORE = new Date("2026-10-20T00:00:00Z");
const ENV = { SECRET_ENCRYPTION_KEY: "ad".repeat(32), RUVANAS_TEST_RADIO_CONTINUOUS_ENABLED: "true" };
const ORG = "cmtestorganisation00001", OWNER = "cmtestowner00000000001", CHANNEL = "cmtestchannel000000001", MODE = "cmtestmusicmode0000001";
const clone = value => structuredClone(value);
function fixture() {
  let next = 0;
  const audits = new Map(), writes = [];
  const genre = { id: "cmtestgenrepop00000001", slug: "pop", name: "Pop", active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED" };
  const tracks = [1, 2, 3].map(i => ({ id: `cmtesttrack${String(i).padStart(10, "0")}`, mediaAssetId: `cmtestasset${String(i).padStart(10, "0")}`,
    title: `Track ${i}`, artist: "Artist", status: "READY", catalogueProvider: null, minimumCatalogueLevel: "FOCUSED", rightsHolder: "Owner",
    rightsReference: "Direct permission", rightsBasis: "OTHER", rightsReviewStatus: "APPROVED", rightsReviewedAt: BEFORE, rightsReviewedById: OWNER,
    rightsConfirmedAt: BEFORE, rightsConfirmedById: OWNER, permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"],
    licenceStartsAt: null, licenceExpiresAt: new Date("2026-12-01T00:00:00Z"), updatedAt: BEFORE, distributorItems: [],
    mediaAsset: { id: `cmtestasset${String(i).padStart(10, "0")}`, organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC", status: "READY",
      licensedCatalogue: true, storageKey: `catalogue/music/${i.toString(16).padStart(64, "0")}.mp3`, sizeBytes: 1000000n,
      durationSeconds: 180, mimeType: "audio/mpeg", updatedAt: BEFORE, genres: [{ mediaGenre: genre }] } }));
  const config = { stationId: P.stationId, providerKey: "CENTOVA_CAST", streamUrl: P.listenerUrl, serverHost: P.host, serverPort: P.port,
    sourcePort: P.port, sourceUsername: null, centovaUsername: P.account, bitrateKbps: 128, sourcePasswordEncrypted: "fixture-ciphertext", outboundAutoDjEnabled: false };
  const station = { id: P.stationId, organisationId: ORG, productFamily: "ONLINE", status: "DRAFT", publicPlayerEnabled: false, stationWebsiteEnabled: false,
    streamConfig: config, organisation: { id: ORG, subscription: { organisationId: ORG, plan: clone(PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN), status: "TRIAL",
      onlineRadioEnabled: true, currentPeriodEnd: new Date("2026-11-23T00:00:00Z"), billingContract: null } } };
  const channels = [{ id: CHANNEL, stationId: P.stationId, organisationId: ORG, musicRightsUse: "ONLINE_RADIO", name: "Test Radio", status: "DRAFT" }];
  const modes = [{ id: MODE, organisationId: ORG, name: "Pop mix", source: "SMART_PLAYLIST", status: "DRAFT", smartPlaylist: {
    id: "cmtestplaylist00000001", musicModeId: MODE, organisationId: ORG, status: "DRAFT", rightsUse: "ONLINE_RADIO", simpleBuildMode: "RANDOM_GENRE_POOL", genreCodes: ["pop"] } }];
  const data = { station, channels, modes, tracks, schedules: [], versions: [], ownerRole: "SUPER_ADMIN" };
  const actorSession = { id: "cmownersession00000001", userId: OWNER, user: { id: OWNER, role: "SUPER_ADMIN", privatePreviewAccess: null },
    authMethod: "PASSWORD", activeOrganisationId: null, activeOrganisation: null, createdAt: BEFORE, lastSeenAt: NOW, revokedAt: null, expiresAt: new Date(NOW.getTime() + 3600000) };
  const grant = { kind: P.kind, action: "START", id: "fa633d3e-1bb3-4b01-ad45-7c73f48bc8ef", sequence: 1, stationId: P.stationId,
    organisationId: ORG, actorUserId: OWNER, sourceFingerprint: continuousSourceFingerprint(config), issuedAt: BEFORE.toISOString(), publicExposureAccepted: true,
    monthlyBudgetUsd: 15, bitrateKbps: 128, territory: "MT", catalogueLevel: "FOCUSED" };
  audits.set(CONTINUOUS_CONTROL_ID, { details: { command: grant, signature: signContinuousCommand(grant, ENV) } });
  const fullSchedule = row => row ? { ...row, versions: data.versions.filter(v => v.scheduleId === row.id).sort((a, b) => b.version - a.version).slice(0, 1) } : null;
  const db = {
    auditLog: { findUnique: async ({ where }) => clone(audits.get(where.id) || null),
      create: async ({ data: row }) => { writes.push(clone(row)); audits.set(`audit-${++next}`, clone(row)); return row; },
      upsert: async ({ where, create, update }) => { const row = audits.has(where.id) ? { ...audits.get(where.id), ...clone(update) } : clone(create);
        writes.push(row); audits.set(where.id, row); return clone(row); } },
    station: { findUnique: async ({ where }) => { assert.equal(where.id, P.stationId); return clone(data.station); } },
    channel: {
      findMany: async ({ where }) => { assert.equal(where.stationId, P.stationId); assert.equal(where.organisationId, ORG);
        return clone(channels.filter(c => c.stationId === where.stationId && c.organisationId === where.organisationId && ["DRAFT", "ACTIVE"].includes(c.status))); },
      findFirst: async ({ where }) => clone(channels.find(c => c.id === where.id && c.stationId === where.stationId && c.organisationId === where.organisationId && ["DRAFT", "ACTIVE"].includes(c.status)) || null),
    },
    musicMode: { findMany: async ({ where }) => { assert.equal(where.organisationId, ORG);
      return clone(modes.filter(m => m.organisationId === where.organisationId && ["DRAFT", "ACTIVE"].includes(m.status) && (!where.id || where.id.in.includes(m.id)))); } },
    programmeSchedule: {
      findFirst: async ({ where }) => clone(fullSchedule(data.schedules.find(s => s.organisationId === where.organisationId && s.channelId === where.channelId))),
      create: async ({ data: row }) => { const created = { id: `cmschedule${String(++next).padStart(13, "0")}`, ...clone(row) }; data.schedules.push(created); writes.push(created); return clone(created); },
      update: async ({ where, data: changes }) => { const row = data.schedules.find(s => s.id === where.id); Object.assign(row, clone(changes)); writes.push(clone(row)); return clone(row); },
    },
    programmeScheduleVersion: {
      create: async ({ data: row }) => { const id = `cmversion${String(++next).padStart(14, "0")}`;
        for (const item of row.items.create) {
          assert.equal(Object.hasOwn(item, "organisationId"), false, "Prisma nested items inherit organisationId from their parent version");
          assert.equal(Object.hasOwn(item, "versionId"), false, "Prisma nested items inherit versionId from their parent version");
        }
        const created = { ...clone(row), id, items: row.items.create.map((item, i) => ({ ...clone(item), organisationId: row.organisationId, id: `${id}item${i}`, versionId: id })) };
        data.versions.push(created); writes.push(clone(created)); return clone(created); },
      findFirst: async ({ where }) => clone(data.versions.find(v => v.id === where.id && v.organisationId === where.organisationId && v.scheduleId === where.scheduleId && where.status.in.includes(v.status) &&
        data.schedules.some(s => s.id === v.scheduleId && s.channelId === where.schedule.channelId && s.organisationId === where.organisationId)) || null),
    },
    user: { findUnique: async ({ where }) => where.id === OWNER ? { id: OWNER, role: data.ownerRole } : null },
    mediaGenre: { findMany: async () => [clone(genre)] }, track: { findMany: async () => clone(data.tracks) },
    onlineRadioCatalogueTest: { findFirst: async () => null },
  };
  db.$transaction = async action => action(db);
  const options = { actorSession, now: NOW, env: ENV };
  const input = { channelId: CHANNEL, name: "Test Radio week", timezone: "Europe/Malta", items: [
    { label: "Afternoon pop", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId: MODE, weekday: 5, startTime: "14:00", durationMinutes: 60, priority: 0 } ] };
  return { db, data, audits, writes, options, input };
}
async function approved(f) {
  const saved = await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  assert.equal(saved.draft.readyToApprove, true, saved.warnings.join(";"));
  await approveContinuousSchedule(f.db, { ...f.options, channelId: CHANNEL, versionId: saved.draft.id, reviewHash: saved.draft.reviewHash, overridesAcknowledged: true });
  return saved;
}
async function load(f, now = NOW) {
  return loadAuthorizedContinuousSchedule(f.db, { authorized: await loadAuthorizedContinuousRadio(f.db, { now, env: ENV }), now, env: ENV });
}
test("owner saves canonical drafts, reviews and separately approves only Test Radio without publishing or activating", async () => {
  const f = fixture(), grantBefore = clone(f.audits.get(CONTINUOUS_CONTROL_ID));
  const saved = await approved(f);
  const result = await load(f);
  assert.equal(result.enabled, true); assert.equal(result.revisionFingerprint, saved.draft.reviewHash);
  assert.equal(result.occurrences[0].startsAt, "2026-10-23T12:00:00.000Z");
  assert.equal(result.occurrences[0].tracks.length, 3);
  assert.equal(f.data.versions[0].status, "DRAFT"); assert.equal(f.data.versions[0].isActive, false);
  assert.equal(f.data.channels[0].status, "DRAFT"); assert.equal(f.data.station.streamConfig.outboundAutoDjEnabled, false);
  assert.deepEqual(f.audits.get(CONTINUOUS_CONTROL_ID), grantBefore);
  assert.ok(f.writes.every(row => !row.organisationId || row.organisationId === ORG));
});
test("subsequent grid and playlist drafts do not change the immutable approved snapshot", async () => {
  const f = fixture(); await approved(f); const before = await load(f);
  f.input.items[0].startTime = "16:00";
  await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  f.data.modes[0].smartPlaylist.genreCodes = ["rock"];
  const after = await load(f);
  assert.equal(after.revisionFingerprint, before.revisionFingerprint);
  assert.deepEqual(after.occurrences, before.occurrences);
  const screen = await continuousScheduleDashboard(f.db, f.options);
  assert.equal(screen.draft.version, 2); assert.equal(screen.approved.version, 1);
});
test("review hashes change with music eligibility and reject stale approval", async () => {
  const f = fixture(); const saved = await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  f.data.tracks[0].rightsReviewStatus = "REJECTED";
  await assert.rejects(approveContinuousSchedule(f.db, { ...f.options, channelId: CHANNEL, versionId: saved.draft.id,
    reviewHash: saved.draft.reviewHash, overridesAcknowledged: true }), { code: "SCHEDULE_REVIEW_CHANGED" });
  assert.equal((await load(f)).enabled, false);
});
test("current rights intersect frozen recordings; newly imported music cannot enter an approved week", async () => {
  const f = fixture(); await approved(f);
  f.data.tracks[0].rightsReviewStatus = "REJECTED";
  const result = await load(f); assert.equal(result.occurrences[0].tracks.length, 2);
  assert.ok(result.occurrences[0].tracks.every(t => t.trackId !== f.data.tracks[0].id));
});
test("tampered canonical version, archived playlist, changed grant and invalid signatures cannot run", async () => {
  const f = fixture(); await approved(f);
  f.data.versions[0].items[0].label = "Unreviewed edit";
  assert.equal((await load(f)).reasonCode, "SCHEDULE_VERSION_CHANGED");
  f.data.versions[0].items[0].label = "Afternoon pop";
  f.data.modes[0].status = "ARCHIVED";
  assert.equal((await load(f)).occurrences.length, 0);
  f.data.modes[0].status = "DRAFT";
  const auth = await loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV }); auth.grant.id = "new-grant";
  assert.equal((await loadAuthorizedContinuousSchedule(f.db, { authorized: auth, now: NOW, env: ENV })).reasonCode, "SCHEDULE_GRANT_CHANGED");
  f.audits.get(S.controlId).details.signature = "0".repeat(64);
  assert.equal((await load(f)).enabled, false);
});
test("disable is durable without eligible music or signing key and never stops continuous random grant", async () => {
  const f = fixture(); await approved(f); const controlBefore = clone(f.audits.get(CONTINUOUS_CONTROL_ID));
  f.data.tracks.length = 0;
  await disableContinuousSchedule(f.db, { ...f.options, env: {} });
  assert.equal(f.audits.get(S.controlId).details.command.action, "DISABLE");
  assert.deepEqual(f.audits.get(CONTINUOUS_CONTROL_ID), controlBefore);
  assert.equal((await loadAuthorizedContinuousSchedule(f.db, { authorized: { station: f.data.station, grant: controlBefore.details.command, tracks: [] }, now: NOW, env: ENV })).enabled, false);
});
test("no channel is created; multiple channels need explicit choice and foreign channels are rejected", async () => {
  const f = fixture(); f.data.channels.push({ ...f.data.channels[0], id: "cmsecondchannel0000001" });
  assert.equal((await continuousScheduleDashboard(f.db, f.options)).canEdit, false);
  await assert.rejects(saveContinuousScheduleDraft(f.db, { ...f.options, input: { ...f.input, channelId: "cmforeignchannel00001" } }), { code: "SCHEDULE_CHANNEL_INVALID" });
  f.data.channels.length = 0;
  assert.equal((await continuousScheduleDashboard(f.db, f.options)).channels.length, 0);
  assert.equal(f.writes.length, 0);
});
test("owner role and review acknowledgement are required and unsupported sources are refused", async () => {
  const f = fixture(); const bad = clone(f.options); bad.actorSession.user.role = "OWNER";
  await assert.rejects(continuousScheduleDashboard(f.db, bad), { code: "SCHEDULE_OWNER_REQUIRED" });
  assert.throws(() => parseContinuousSchedule({ ...f.input, items: [{ ...f.input.items[0], sourceType: "RADIO_CLOCK" }] }), { code: "SCHEDULE_INPUT_INVALID" });
  const saved = await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  await assert.rejects(approveContinuousSchedule(f.db, { ...f.options, channelId: CHANNEL, versionId: saved.draft.id, reviewHash: saved.draft.reviewHash }), { code: "SCHEDULE_REVIEW_REQUIRED" });
});
test("equal priority overlaps block approval; controlled priority requires reviewed acknowledgement", async () => {
  const f = fixture(); f.input.items.push({ ...f.input.items[0], label: "Second programme", startTime: "14:30" });
  let saved = await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  assert.equal(saved.draft.readyToApprove, false); assert.equal(saved.draft.reviewHash, null);
  f.input.items[1].priority = 1;
  saved = await approved(f);
  assert.equal((await load(f)).occurrences.length, 2);
  assert.ok(saved.warnings.some(warning => warning.includes("priority")));
});
test("approval refuses programmes already in progress or starting without a full minute lead", async () => {
  const f = fixture(); f.input.items[0].startTime = "10:00";
  const saved = await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  await assert.rejects(approveContinuousSchedule(f.db, { ...f.options, channelId: CHANNEL, versionId: saved.draft.id,
    reviewHash: saved.draft.reviewHash, overridesAcknowledged: true }), { code: "SCHEDULE_LEAD_TIME_REQUIRED" });
});
test("DST gap skips only its nonexistent occurrence and autumn repeated hour is compiled once", () => {
  const f = fixture(); f.input.items[0] = { ...f.input.items[0], weekday: 0, startTime: "02:30" };
  const parsed = parseContinuousSchedule(f.input);
  const spring = compileContinuousSchedule({ items: parsed.items }, { timezone: "Europe/Malta", startsAt: new Date("2027-03-27T12:00:00Z"), days: 10 });
  assert.equal(spring.occurrences.length, 1); assert.ok(spring.warnings.some(w => w.includes("daylight-saving")));
  const autumn = compileContinuousSchedule({ items: parsed.items }, { timezone: "Europe/Malta", startsAt: new Date("2026-10-25T00:00:00Z"), days: 1 });
  assert.equal(autumn.occurrences.length, 1); assert.equal(autumn.occurrences[0].startsAt.toISOString(), "2026-10-25T01:30:00.000Z");
});
test("recipe scope rejects foreign playlist backing and hashes canonical data deterministically", () => {
  const f = fixture(); f.data.modes[0].smartPlaylist.organisationId = "foreign";
  assert.equal(simpleScheduleSource(f.data.modes[0]), null);
  assert.equal(scheduleHash({ b: 2, a: 1 }), scheduleHash({ a: 1, b: 2 }));
});
test("DST gap fallback keeps valid same-day programmes for a late-night preview start", () => {
  const f = fixture();
  f.input.items = [{ ...f.input.items[0], weekday: 0, startTime: "02:30" },
    { ...f.input.items[0], label: "Valid Sunday show", weekday: 0, startTime: "10:00" }];
  const parsed = parseContinuousSchedule(f.input);
  const result = compileContinuousSchedule({ items: parsed.items }, { timezone: "Europe/Malta", startsAt: new Date("2027-03-27T22:30:00Z"), days: 2 });
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].label, "Valid Sunday show");
  assert.equal(result.occurrences[0].startsAt.toISOString(), "2027-03-28T08:00:00.000Z");
  assert.ok(result.warnings.some(warning => warning.includes("daylight-saving")));
});
test("canonical timezone stays immutable and archived versions cannot be approved", async () => {
  const f = fixture(); await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  await assert.rejects(saveContinuousScheduleDraft(f.db, { ...f.options, input: { ...f.input, timezone: "UTC" } }), { code: "SCHEDULE_TIMEZONE_IMMUTABLE" });
  assert.equal(f.data.schedules[0].timezone, "Europe/Malta"); assert.equal(f.data.versions.length, 1);
  f.data.versions[0].status = "ARCHIVED";
  const screen = await continuousScheduleDashboard(f.db, f.options);
  assert.equal(screen.draft.readyToApprove, false); assert.equal(screen.draft.reviewHash, null);
});
test("dashboard does not claim a revoked, archived or old-grant approval is enabled", async () => {
  const f = fixture(); await approved(f);
  const original = clone(f.audits.get(CONTINUOUS_CONTROL_ID));
  const nextGrant = { ...original.details.command, id: "fa633d3e-1bb3-4b01-ad45-7c73f48bc8ee" };
  f.audits.set(CONTINUOUS_CONTROL_ID, { details: { command: nextGrant, signature: signContinuousCommand(nextGrant, ENV) } });
  let screen = await continuousScheduleDashboard(f.db, f.options);
  assert.equal(screen.approved.enabled, false); assert.equal(screen.approved.reasonCode, "SCHEDULE_GRANT_CHANGED");
  f.audits.set(CONTINUOUS_CONTROL_ID, original);
  f.data.modes[0].status = "ARCHIVED";
  screen = await continuousScheduleDashboard(f.db, f.options);
  assert.equal(screen.approved.enabled, false); assert.equal(screen.approved.reasonCode, "SCHEDULE_SOURCE_UNAVAILABLE");
});
test("a replacement approval cannot silently interrupt the previously approved programme", async () => {
  const f = fixture(); await approved(f);
  f.input.items[0].startTime = "16:00";
  const now = new Date("2026-10-23T12:30:00Z"), actorSession = clone(f.options.actorSession);
  actorSession.expiresAt = new Date("2026-10-24T00:00:00Z"); actorSession.lastSeenAt = now;
  const options = { ...f.options, actorSession, now };
  const saved = await saveContinuousScheduleDraft(f.db, { ...options, input: f.input });
  await assert.rejects(approveContinuousSchedule(f.db, { ...options, channelId: CHANNEL, versionId: saved.draft.id,
    reviewHash: saved.draft.reviewHash, overridesAcknowledged: true }), { code: "SCHEDULE_LEAD_TIME_REQUIRED" });
  assert.equal((await load(f, now)).versionId, f.data.versions[0].id);
});
test("review refuses scheduled pools exceeding the worker's64-recording preparation bound", async () => {
  const f = fixture();
  for (let i = 4; i <= 65; i++) {
    const track = clone(f.data.tracks[0]);
    track.id = `cmtesttrack${String(i).padStart(10, "0")}`; track.mediaAssetId = `cmtestasset${String(i).padStart(10, "0")}`;
    track.mediaAsset.id = track.mediaAssetId; track.mediaAsset.storageKey = `catalogue/music/${i.toString(16).padStart(64, "0")}.mp3`;
    f.data.tracks.push(track);
  }
  const screen = await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  assert.equal(screen.draft.readyToApprove, false); assert.equal(screen.draft.reviewHash, null);
  assert.ok(screen.warnings.some(warning => warning.includes("more than 64 recordings")));
  assert.equal((await loadAuthorizedContinuousRadio(f.db, { now: NOW, env: ENV })).tracks.length, 65);
});
test("nested schedule item create matches the generated Prisma composite-relation input", async () => {
  const declarations = await readFile(new URL("../node_modules/.prisma/client/index.d.ts", import.meta.url), "utf8");
  const shape = declarations.match(/export type ProgrammeScheduleItemUncheckedCreateWithoutVersionInput = \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(shape, "Generated Prisma nested item input must be available");
  assert.doesNotMatch(shape, /\b(?:organisationId|versionId)\??:/);
  assert.match(shape, /\bmusicModeId\??:/);
  const f = fixture(); await saveContinuousScheduleDraft(f.db, { ...f.options, input: f.input });
  assert.equal(f.data.versions[0].organisationId, ORG);
  assert.equal(f.data.versions[0].items[0].organisationId, ORG);
});
