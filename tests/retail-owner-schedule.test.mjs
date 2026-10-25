import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRetailOwnerScheduleService, retailOwnerScheduleError } from "../lib/retail-owner-schedule-service.mjs";
import { createRetailOwnerScheduleHandlers } from "../lib/retail-owner-schedule-http.mjs";
import { loadRetailStreamSchedule } from "../lib/retail-stream-schedule.mjs";
import { retailDiagnosticAuditId, retailNormalPlanningVersion } from "../lib/retail-schedule-draft-policy.mjs";
import { retailScheduleReviewView } from "../lib/retail-schedule-review-ui.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";

const NOW = new Date("2026-10-25T09:00:00.000Z"), BEFORE = new Date("2026-10-25T08:00:00.000Z");
const ADMIN = "owner-admin", CHANNEL = "c111111111111111111111111", MODE = "c222222222222222222222222", SCHEDULE = "c333333333333333333333333";
const WORKER = "running-retail-worker", LEASE = `retail-playout:${STATION}:${WORKER}:instance-123`;
const REQ = "31400821-cc19-4c1d-bd7a-c723b8d35415", REQ2 = "31400821-cc19-4c1d-bd7a-c723b8d35416";
const clone = value => structuredClone(value);
function match(row, where = {}) { return Object.entries(where).every(([key, value]) => {
  if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
  if (value && typeof value === "object") { if ("not" in value) return row[key] !== value.not; if ("in" in value) return value.in.includes(row[key]); }
  return row[key] === value;
}); }
function fixture() {
  let next = 10, tail = Promise.resolve();
  const mode = { id: MODE, organisationId: ORG, name: "Shop mix", source: "SMART_PLAYLIST", status: "DRAFT", updatedAt: BEFORE,
    smartPlaylist: { id: "playlist", organisationId: ORG, musicModeId: MODE, status: "DRAFT", rightsUse: "RETAIL_RADIO", territory: "MT",
      simpleBuildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"], version: 1, updatedAt: BEFORE, publishedAt: null, publishedByUserId: null } };
  const version = { id: "version-1", organisationId: ORG, scheduleId: SCHEDULE, version: 1, status: "DRAFT", isActive: false,
    createdByUserId: "subscriber", publishedAt: null, publishedByUserId: null, updatedAt: BEFORE,
    items: [{ id: "item-1", organisationId: ORG, versionId: "version-1", position: 0, label: "Monday unapproved mix", sourceType: "MUSIC_MODE",
      recurrence: "WEEKLY", weekday: 1, startMinute: 600, startsAt: null, durationMinutes: 60, priority: 0,
      musicModeId: MODE, radioClockId: null, schoolRundownId: null, updatedAt: BEFORE }] };
  const station = { id: STATION, organisationId: ORG, productFamily: "RETAIL", status: "DRAFT", publicPlayerEnabled: false,
    stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL" };
  const d = { role: "SUPER_ADMIN", channels: [{ id: CHANNEL, stationId: STATION, organisationId: ORG, name: "Planning", status: "DRAFT", musicRightsUse: "RETAIL_RADIO" }],
    modes: [mode], versions: [version], schedule: { id: SCHEDULE, organisationId: ORG, channelId: CHANNEL, name: "Retail week", timezone: "Europe/Malta" },
    authorized: { station, grant: { id: "existing-start", stationId: STATION, organisationId: ORG, issuedAt: BEFORE.toISOString() },
      entitlements: { streamLimit: 1 }, pilotAccess: { approved: true, fingerprint: "permission-v1" },
      assignment: { workerId: WORKER },
      source: { sourcePasswordEncrypted: "PRIVATE_SOURCE_CIPHERTEXT", encoderLeaseOwner: LEASE, encoderLeaseUntil: new Date(NOW.getTime() + 45000) },
      tracks: [1, 2].map(n => ({ track: { id: `track-${n}`, title: `Song ${n}`, artist: "Artist", mediaAssetId: `asset-${n}`,
        mediaAsset: { genres: [{ mediaGenre: { slug: "pop" } }] } }, fingerprint: `fp${n}`, durationSeconds: 180 })) },
    audits: new Map([[`retail-playout:control:${STATION}`, { id: `retail-playout:control:${STATION}`, details: { command: { action: "START", id: "existing-start" } } }]]),
    writes: [], loads: 0, denied: false };
  const expandVersion = row => ({ ...clone(row), publishedBy: row.publishedByUserId ? { id: row.publishedByUserId, role: d.role } : null,
    items: row.items.map(item => ({ ...clone(item), musicMode: clone(d.modes.find(m => m.id === item.musicModeId)) })) });
  const write = (model, where, data) => { d.writes.push({ model, where: clone(where), data: clone(data) }); };
  const db = {
    $executeRaw: async (_strings, ...values) => { assert.equal(values[0], `retail-subscriber-planning:${ORG}`); return 1; },
    user: { findUnique: async ({ where }) => where.id === ADMIN ? { id: ADMIN, role: d.role } : null },
    channel: { findMany: async ({ where, take }) => clone(d.channels.filter(row => match(row, where)).slice(0, take)),
      count: async ({ where }) => d.channels.filter(row => match(row, where)).length,
      updateMany: async ({ where, data }) => { const rows = d.channels.filter(row => match(row, where)); rows.forEach(row => Object.assign(row, clone(data))); write("Channel", where, data); return { count: rows.length }; } },
    musicMode: { findMany: async ({ where, take }) => clone(d.modes.filter(row => row.organisationId === where.organisationId).slice(0, take)),
      updateMany: async ({ where, data }) => { const rows = d.modes.filter(row => match(row, where)); rows.forEach(row => Object.assign(row, clone(data))); write("MusicMode", where, data); return { count: rows.length }; } },
    smartPlaylist: { updateMany: async ({ where, data }) => { const rows = d.modes.map(row => row.smartPlaylist).filter(row => match(row, where)); rows.forEach(row => Object.assign(row, clone(data))); write("SmartPlaylist", where, data); return { count: rows.length }; } },
    programmeSchedule: {
      findFirst: async ({ where, include }) => d.schedule && match(d.schedule, where) ? { ...clone(d.schedule), versions: [...d.versions].filter(row => match(row, include.versions.where)).sort((a, b) => b.version - a.version).slice(0, include.versions.take).map(expandVersion) } : null,
      create: async ({ data }) => { d.schedule = { id: SCHEDULE, ...clone(data) }; write("ProgrammeSchedule", {}, data); return clone(d.schedule); }
    },
    programmeScheduleVersion: {
      create: async ({ data }) => { const id = `version-${++next}`, row = { ...clone(data), id, updatedAt: NOW,
        items: data.items.create.map((item, index) => ({ ...clone(item), id: `${id}-item-${index}`, versionId: id, organisationId: ORG, updatedAt: NOW })) };
        d.versions.push(row); write("ProgrammeScheduleVersion", {}, data); return clone(row); },
      updateMany: async ({ where, data }) => { const rows = d.versions.filter(row => match(row, where)); rows.forEach(row => Object.assign(row, clone(data))); write("ProgrammeScheduleVersion", where, data); return { count: rows.length }; }
    },
    auditLog: { findUnique: async ({ where }) => clone(d.audits.get(where.id) || null),
      create: async ({ data }) => { assert.equal(d.audits.has(data.id), false); d.audits.set(data.id, clone(data)); write("AuditLog", {}, data); return clone(data); } }
  };
  db.$transaction = (operation, options) => { assert.equal(options.isolationLevel, "Serializable"); const result = tail.then(async () => {
    const previous = clone(d); try { return await operation(db); } catch (error) { Object.assign(d, previous); throw error; }
  }); tail = result.catch(() => {}); return result; };
  const service = createRetailOwnerScheduleService({ loadAuthorized: async (_db, options) => {
    assert.equal(options.organisationId, ORG); assert.equal(options.stationId, STATION); d.loads++;
    if (d.denied) throw Object.assign(new Error("PRIVATE_ERROR"), { code: "RETAIL_PLAYOUT_PILOT_ACCESS_CHANGED" });
    return clone(d.authorized);
  } });
  const options = { actorUserId: ADMIN, organisationId: ORG, now: NOW, env: {} };
  const view = () => service.dashboard(db, options);
  const approve = async (overrides = {}) => { const v = await view(); return service.approve(db, { ...options,
    versionId: v.draft?.id, reviewHash: v.draft?.reviewHash, requestId: REQ, overridesAcknowledged: true, ...overrides }); };
  const prepare = (overrides = {}) => service.prepareTest(db, { ...options, sourceId: MODE, startsAt: "2026-10-25T09:05:00.000Z",
    durationMinutes: 2, requestId: REQ2, baseVersionId: d.versions.at(-1)?.id || null, ...overrides });
  return { d, db, service, options, view, approve, prepare };
}

test("owner review is read-only, redacted and exact Retail scoped", async () => {
  const f = fixture(), before = clone(f.d); const view = await f.view();
  assert.equal(view.stationId, STATION); assert.equal(view.draft.readyToApprove, true); assert.match(view.draft.reviewHash, /^[a-f0-9]{64}$/);
  assert.equal(retailScheduleReviewView(JSON.parse(JSON.stringify(view)), ORG).stationId, STATION);
  assert.equal(view.observation.phase, "UNKNOWN"); assert.equal(view.approved, null); assert.equal(f.d.writes.length, 0);
  assert.deepEqual(f.d.authorized, before.authorized); assert.deepEqual(f.d.audits, before.audits);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_SOURCE|running-retail-worker|existing-start|permission-v1|fingerprint|storageKey/);
  await assert.rejects(f.service.dashboard(f.db, { ...f.options, organisationId: "other" }), { code: "RETAIL_SCHEDULE_SCOPE_INVALID" });
  for (const role of ["ADMIN", "OWNER", "MANAGER"]) { f.d.role = role; await assert.rejects(f.view(), { code: "RETAIL_SCHEDULE_OWNER_REQUIRED" }); }
});
test("approval atomically promotes only referenced drafts and is readable by the existing worker without restart", async () => {
  const f = fixture(), before = clone(f.d.authorized), control = clone(f.d.audits.get(`retail-playout:control:${STATION}`));
  const v = await f.view(), command = { ...f.options, versionId: v.draft.id, reviewHash: v.draft.reviewHash, requestId: REQ, overridesAcknowledged: true };
  const [a, b] = await Promise.all([f.service.approve(f.db, command), f.service.approve(f.db, command)]);
  assert.equal(a.approvedVersionId, b.approvedVersionId); assert.equal(a.approved.enabled, true);
  assert.equal(f.d.channels[0].status, "ACTIVE"); assert.equal(f.d.modes[0].status, "ACTIVE"); assert.equal(f.d.modes[0].smartPlaylist.status, "ACTIVE");
  assert.equal(f.d.versions[0].publishedByUserId, ADMIN); assert.equal(f.d.versions[0].isActive, true);
  assert.equal(f.d.modes[0].updatedAt.getTime(), f.d.versions[0].publishedAt.getTime());
  assert.equal((await loadRetailStreamSchedule(f.db, { authorized: f.d.authorized, now: NOW })).enabled, true);
  assert.deepEqual(f.d.authorized, before); assert.deepEqual(f.d.audits.get(`retail-playout:control:${STATION}`), control);
  assert.ok(f.d.writes.every(row => ["Channel", "MusicMode", "SmartPlaylist", "ProgrammeScheduleVersion", "AuditLog"].includes(row.model)));
  assert.equal(f.d.writes.filter(row => row.model === "AuditLog" && row.data.action === "RETAIL_SCHEDULE_APPROVED").length, 1);
});
test("stale hashes, different recipes, expired rights, wrong tenants and foreign sources reject without live mutation", async () => {
  for (const mutate of [f => { f.d.versions[0].items[0].label = "changed"; }, f => { f.d.modes[0].smartPlaylist.genreCodes = ["ROCK"]; },
    f => { f.d.authorized.tracks[0].fingerprint = "new-recording"; }, f => { f.d.authorized.pilotAccess.fingerprint = "renewed"; },
    f => { f.d.authorized.grant.id = "new-start"; }, f => { f.d.denied = true; }, f => { f.d.versions[0].items[0].organisationId = "foreign"; },
    f => { f.d.modes[0].organisationId = "foreign"; }, f => { f.d.channels[0].musicRightsUse = "ONLINE_RADIO"; }]) {
    const f = fixture(), v = await f.view(); mutate(f); const before = clone(f.d);
    await assert.rejects(f.service.approve(f.db, { ...f.options, versionId: v.draft.id, reviewHash: v.draft.reviewHash, requestId: REQ, overridesAcknowledged: true }));
    assert.deepEqual(f.d.authorized, before.authorized); assert.equal(f.d.writes.length, 0);
  }
});
test("another active output and ambiguous planning channel fail closed without changing limits", async () => {
  const f = fixture(); f.d.channels.push({ id: "other-channel", organisationId: ORG, stationId: "other-station", status: "ACTIVE" });
  assert.equal((await f.view()).draft.readyToApprove, false); await assert.rejects(f.approve()); assert.equal(f.d.writes.length, 0);
  f.d.channels[1].stationId = STATION; await assert.rejects(f.view(), { code: "RETAIL_SCHEDULE_CHANNEL_REQUIRED" });
});
test("new and existing programmes require a quiet minute and expired one-off tests cannot be approved", async () => {
  for (const delta of [-30000, 0, 59000]) {
    const f = fixture(); Object.assign(f.d.versions[0].items[0], { recurrence: "ONE_OFF", weekday: null, startMinute: null, startsAt: new Date(NOW.getTime() + delta) });
    assert.equal((await f.view()).draft.readyToApprove, false); await assert.rejects(f.approve()); assert.equal(f.d.writes.length, 0);
  }
});
test("short test preserves the unapproved subscriber week and never includes it in the approved test", async () => {
  const f = fixture(), original = clone(f.d.versions[0]); const prepared = await f.prepare();
  assert.equal(retailScheduleReviewView(JSON.parse(JSON.stringify(prepared)), ORG).draft.id, prepared.draft.id);
  assert.equal(prepared.draft.diagnostic, true); assert.equal(prepared.draft.preservedDraftVersionId, original.id);
  assert.equal(prepared.draft.items.length, 1); assert.equal(prepared.draft.items[0].recurrence, "ONE_OFF");
  assert.equal(prepared.draft.items[0].durationMinutes, 2); assert.equal(f.d.channels[0].status, "DRAFT");
  const selected = await retailNormalPlanningVersion(f.db, [...f.d.versions].reverse()); assert.equal(selected.id, original.id);
  const approved = await f.approve(); assert.equal(approved.approved.diagnostic, true); assert.equal(approved.approved.enabled, true);
  assert.equal(retailScheduleReviewView(JSON.parse(JSON.stringify(approved)), ORG).approved.versionId, approved.approved.versionId);
  assert.deepEqual(f.d.versions[0], original); assert.equal((await retailNormalPlanningVersion(f.db, [...f.d.versions].reverse())).id, original.id);
  const runtime = await loadRetailStreamSchedule(f.db, { authorized: f.d.authorized, now: NOW });
  assert.equal(runtime.occurrences.length, 1); assert.equal(runtime.occurrences[0].startsAt, "2026-10-25T09:05:00.000Z");
  assert.equal(runtime.occurrences[0].endsAt, "2026-10-25T09:07:00.000Z");
  const after = await loadRetailStreamSchedule(f.db, { authorized: f.d.authorized, now: new Date("2026-10-25T09:07:01.000Z") });
  assert.equal(after.occurrences.length, 0); assert.equal(after.enabled, true);
  const laterOptions = { ...f.options, now: new Date("2026-10-25T09:08:00.000Z") };
  const later = await f.service.dashboard(f.db, laterOptions);
  assert.equal(later.draft.id, original.id); assert.equal(later.draft.readyToApprove, true);
  const normal = await f.service.approve(f.db, { ...laterOptions, versionId: original.id, reviewHash: later.draft.reviewHash,
    requestId: REQ2, overridesAcknowledged: true });
  assert.equal(normal.approved.versionId, original.id); assert.equal(normal.approved.diagnostic, false); assert.equal(normal.approved.enabled, true);
  assert.equal(f.d.versions.find(row => row.id === prepared.savedVersionId).status, "ARCHIVED");
  const normalRuntime = await loadRetailStreamSchedule(f.db, { authorized: f.d.authorized, now: laterOptions.now });
  assert.equal(normalRuntime.occurrences.some(row => row.label === "Monday unapproved mix"), true);
});
test("test preparation copies only the approved schedule and never changes active playlist timestamps", async () => {
  const f = fixture(); await f.approve(); const active = clone(f.d.modes[0]), published = clone(f.d.versions[0]);
  const newDraft = clone(published); newDraft.id = "version-2"; newDraft.version = 2; newDraft.status = "DRAFT"; newDraft.isActive = false;
  newDraft.items = [{ ...clone(published.items[0]), id: "pending-item", versionId: newDraft.id, label: "Unapproved Wednesday", weekday: 3 }]; f.d.versions.push(newDraft);
  const result = await f.prepare(); assert.equal(result.draft.items.length, 2); assert.ok(result.draft.items.some(row => row.label === "Monday unapproved mix"));
  assert.equal(result.draft.items.some(row => row.label === "Unapproved Wednesday"), false);
  await f.approve({ requestId: REQ2 }); assert.deepEqual(f.d.modes[0], active); assert.equal(f.d.versions[0].status, "ARCHIVED");
  assert.deepEqual(f.d.versions[1], newDraft);
});
test("diagnostic bounds, overlap and stale base reject; duplicate preparation recovers the same draft", async () => {
  for (const overrides of [{ durationMinutes: 0 }, { durationMinutes: 6 }, { startsAt: "2026-10-25T09:01:00.000Z" },
    { startsAt: "2026-10-25T11:00:00.000Z" }, { sourceId: "foreign" }, { baseVersionId: "wrong" }]) {
    const f = fixture(); await assert.rejects(f.prepare(overrides)); assert.equal(f.d.writes.length, 0);
  }
  const f = fixture(), baseVersionId = f.d.versions[0].id;
  const [a, b] = await Promise.all([f.prepare({ baseVersionId }), f.prepare({ baseVersionId })]);
  assert.equal(a.savedVersionId, b.savedVersionId); assert.equal(f.d.versions.length, 2);
  await assert.rejects(f.prepare({ baseVersionId, durationMinutes: 3 }), { code: "RETAIL_SCHEDULE_REVIEW_CHANGED" });
  const expired = await f.service.dashboard(f.db, { ...f.options, now: new Date("2026-10-25T09:08:00.000Z") });
  assert.equal(expired.draft.readyToApprove, false);
  const overlapping = fixture(); Object.assign(overlapping.d.versions[0].items[0], { recurrence: "ONE_OFF", weekday: null, startMinute: null,
    startsAt: new Date("2026-10-25T09:04:00.000Z"), durationMinutes: 10 });
  await overlapping.approve(); const previous = clone(overlapping.d.versions);
  await assert.rejects(overlapping.prepare(), { code: "RETAIL_SCHEDULE_OVERLAP" }); assert.deepEqual(overlapping.d.versions, previous);
});
test("publication rejects mid-programme replacement and transactional CAS failure leaves active state unchanged", async () => {
  const f = fixture(); await f.approve(); const active = f.d.versions[0];
  Object.assign(active.items[0], { recurrence: "ONE_OFF", weekday: null, startMinute: null, startsAt: new Date("2026-10-25T08:59:00.000Z"), durationMinutes: 10 });
  const next = clone(active); next.id = "v2"; next.version = 2; next.status = "DRAFT"; next.isActive = false;
  next.items = next.items.map(row => ({ ...row, id: "item2", versionId: next.id, startsAt: new Date("2026-10-25T10:00:00.000Z") })); f.d.versions.push(next);
  assert.equal((await f.view()).draft.readyToApprove, false);
  const g = fixture(), view = await g.view(), before = clone(g.d);
  g.db.programmeScheduleVersion.updateMany = async () => ({ count: 0 });
  await assert.rejects(g.service.approve(g.db, { ...g.options, versionId: view.draft.id, reviewHash: view.draft.reviewHash, requestId: REQ, overridesAcknowledged: true }), { code: "RETAIL_SCHEDULE_REVIEW_CHANGED" });
  assert.deepEqual(g.d.channels, before.channels); assert.deepEqual(g.d.modes, before.modes); assert.deepEqual(g.d.audits, before.audits);
});
test("fresh worker phase is scoped to current lease and revision, and stale evidence is never called live", async () => {
  const f = fixture(); await f.prepare(); await f.approve(); const runtime = await loadRetailStreamSchedule(f.db, { authorized: f.d.authorized, now: NOW });
  const checked = new Date("2026-10-25T09:05:02.000Z");
  f.d.authorized.source.encoderLeaseUntil = new Date(checked.getTime() + 45000);
  const view = (now = checked) => f.service.dashboard(f.db, { ...f.options, now });
  const p = runtime.occurrences[0], record = { organisationId: ORG, entityId: STATION, entityType: "RetailSharedPlayout", action: "RETAIL_PLAYOUT_OBSERVATION",
    details: { grantId: "existing-start", leaseOwner: LEASE,
    observedAt: checked.toISOString(), state: "STREAMING", phase: "SCHEDULED", trackId: "track-1", presentationAt: p.startsAt, sourceLatenessMs: 0,
    programme: { occurrenceId: p.id, scheduleRevision: runtime.revisionFingerprint } } };
  f.d.audits.set(`retail-playout:observation:${STATION}`, record);
  const v = await view(); assert.equal(v.observation.phase, "SCHEDULED"); assert.equal(v.observation.senderEvidenceOnly, true);
  assert.equal(v.observation.presentationAt, p.startsAt);
  for (const wrong of ["2026-10-25T09:00:00.000Z", "2026-10-25T09:05:03.000Z", p.endsAt]) {
    record.details.presentationAt = wrong; assert.equal((await view()).observation.phase, "UNKNOWN");
  }
  record.details.observedAt = NOW.toISOString(); record.details.presentationAt = NOW.toISOString();
  assert.equal((await view(NOW)).observation.phase, "UNKNOWN");
  record.details.presentationAt = p.startsAt; assert.equal((await view(NOW)).observation.phase, "UNKNOWN");
  const ended = new Date(p.endsAt); f.d.authorized.source.encoderLeaseUntil = new Date(ended.getTime() + 45000);
  record.details.observedAt = ended.toISOString(); assert.equal((await view(ended)).observation.phase, "UNKNOWN");
  record.details.observedAt = checked.toISOString();
  record.details.leaseOwner = "foreign"; assert.equal((await view()).observation.phase, "UNKNOWN"); record.details.leaseOwner = LEASE;
  for (const field of ["action", "entityType"]) { const previous = record[field]; record[field] = "foreign"; assert.equal((await view()).observation.fresh, false); record[field] = previous; }
  f.d.authorized.assignment.workerId = "another-worker"; assert.equal((await view()).observation.fresh, false); f.d.authorized.assignment.workerId = WORKER;
  record.details.observedAt = BEFORE.toISOString(); assert.equal((await view()).observation.fresh, false);
});
test("HTTP enforces SuperAdmin, exact organisation, origin and bounded allowed actions", async () => {
  const calls = [], getAdmin = async () => ({ ok: true, user: { id: ADMIN, role: "SUPER_ADMIN" } });
  const handler = createRetailOwnerScheduleHandlers({ getAdmin, canonicalOrigin: "https://www.ruvanas.com",
    dashboard: async input => { calls.push(input); return { stationId: STATION }; }, approve: async input => { calls.push(input); return { approvedVersionId: "v" }; },
    prepareTest: async input => { calls.push(input); return { savedVersionId: "v" }; } });
  const ctx = { params: Promise.resolve({ organisationId: ORG }) }, url = `https://www.ruvanas.com/api/admin/organisations/${ORG}/retail-schedule`;
  const post = (body, headers = {}) => new Request(url, { method: "POST", headers: { origin: "https://www.ruvanas.com", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await handler.GET(new Request(url), ctx)).status, 200);
  for (const body of [{ action: "start" }, { action: "approve", organisationId: "other" }, { action: "prepare-test", stationId: STATION }, { action: "approve", secret: "x".repeat(5000) }]) assert.equal((await handler.POST(post(body), ctx)).status, 400);
  assert.equal((await handler.POST(post({ action: "approve" }, { origin: "https://attacker.invalid" }), ctx)).status, 403);
  assert.equal((await handler.GET(new Request(url), { params: { organisationId: "other" } })).status, 404);
  assert.equal((await handler.GET(new Request(`${url}?stationId=other`), ctx)).status, 400);
  const denied = createRetailOwnerScheduleHandlers({ getAdmin: async () => ({ ok: true, user: { id: ADMIN, role: "ADMIN" } }) });
  assert.equal((await denied.GET(new Request(url), ctx)).status, 403);
  assert.equal(calls.length, 1); assert.doesNotMatch(JSON.stringify(retailOwnerScheduleError(new Error("SECRET"))), /SECRET/);
});
test("production handler uses existing authorization and never writes source, grant, plan, worker or another tenant", async () => {
  const source = await readFile(new URL("../lib/retail-owner-schedule-service.mjs", import.meta.url), "utf8");
  assert.match(source, /loadAuthorized = loadOwnerAuthorizedRetailPlayout/);
  assert.doesNotMatch(source, /stationStreamConfig\.(update|upsert)|subscription\.(update|upsert)|startRetailPlayout|stopRetailPlayout|signRetailPlayoutCommand|claimRetailPlayoutLease/);
});
