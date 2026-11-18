import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { PREVIEW_ONLINE_DRAFT_PLAN, PREVIEW_TESTER_PLAN } from "../lib/private-preview-account-policy.mjs";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";
import { ONLINE_DRAFT_LIMITS, onlineDraftSubscription, onlineDraftChannelWhere, onlineDraftMusicModeWhere, lockOnlineDraftOrganisation } from "../lib/private-preview-online-draft.mjs";
import { resolveEntitlements, isWithinLimit } from "../lib/entitlements.mjs";
import { isOrganisationRoleAllowed, ORGANISATION_MANAGER_ROLES } from "../lib/permissions.mjs";
import { normaliseGenreCode } from "../lib/autodj-genre-entitlements.mjs";
import { parseSimplePlaylist } from "../lib/subscriber-playlists.mjs";
import { safeSimplePlaylist, rightsUseForChannel } from "../lib/subscriber-playlist-service.mjs";
import { smartPlaylistSlug, canAuthorSmartPlaylist } from "../lib/smart-playlists.mjs";
import * as scheduler from "../lib/advanced-scheduler.mjs";

const NOW = new Date("2026-10-17T12:00:00Z");
const id = (n) => `c${String(n).padStart(24, "0")}`;
const ORG = id(1), FOREIGN = id(2), USER = id(3), CHANNEL = id(4), STATION = id(5);
const failUnexpected = (label) => { throw new Error(`Unexpected side effect: ${label}`); };
const NextResponse = { json: (body, options) => Response.json(body, options) };

async function loadActual(relative, exports, dependencies) {
  const original = await readFile(new URL(`../${relative}`, import.meta.url), "utf8");
  const executable = original.replace(/import[\s\S]*?from ["'][^"']+["'];\r?\n/g, "").replace(/^export /gm, "");
  return new Function(...Object.keys(dependencies), `${executable}\nreturn { ${exports.join(", ")} };`)(...Object.values(dependencies));
}

function subscription(plan = PREVIEW_ONLINE_DRAFT_PLAN) {
  return { organisationId: ORG, plan: { ...plan }, status: "TRIAL", billingContract: null,
    currentPeriodEnd: new Date("2026-10-18T12:00:00Z"), complimentaryAccessActive: false,
    retailRadioEnabled: false, schoolRadioEnabled: false, onlineRadioEnabled: true, healthRadioEnabled: false,
    faithRadioEnabled: false, organisationsEnabled: false, correctionsRadioEnabled: false,
    schoolPublicPublishingEnabled: false, retailMediaEnabled: false, digitalSignageEnabled: false };
}

function actor(plan = PREVIEW_ONLINE_DRAFT_PLAN) {
  return { authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG, revokedAt: null,
    user: { id: USER, role: "OWNER", email: "synthetic@example.test",
      privatePreviewAccess: { userId: USER, organisationId: ORG, enabled: true, passwordEnabled: true, pillars: ["ONLINE"], expiresAt: new Date("2026-10-18T12:00:00Z") },
      memberships: [{ organisationId: ORG, role: "OWNER", organisation: { subscription: subscription(plan) } }] } };
}

function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, wanted]) => {
    if (key === "OR") return wanted.some((clause) => matches(row, clause));
    if (key === "AND") return wanted.every((clause) => matches(row, clause));
    const actual = row[key];
    if (wanted && typeof wanted === "object" && !(wanted instanceof Date)) {
      if (Object.hasOwn(wanted, "in")) return wanted.in.includes(actual);
      if (Object.hasOwn(wanted, "not")) return actual !== wanted.not;
      if (Object.hasOwn(wanted, "gt")) return actual > wanted.gt;
      if (Object.hasOwn(wanted, "lt")) return actual < wanted.lt;
      return matches(actual, wanted);
    }
    return wanted instanceof Date ? actual?.getTime?.() === wanted.getTime() : actual === wanted;
  });
}

function memory() {
  let state = { organisation: [{ id: ORG }, { id: FOREIGN }], subscription: [], station: [], channel: [], musicMode: [], smartPlaylist: [],
    programmeSchedule: [], programmeScheduleVersion: [], auditLog: [], subscriberPlaylistEvent: [], channelAssignment: [], mediaGenre: [{ id: id(8), name: "Pop", slug: "pop", active: true }] };
  let sequence = 20;
  let queue = Promise.resolve();
  const calls = { transactions: 0, locks: 0, reads: [] };
  function tables(rows) {
    const decorate = (name, row) => {
      if (!row) return null;
      if (name === "channel") return { ...row, station: rows.station.find((entry) => entry.id === row.stationId), zoneAssignments: [], autoDjPolicy: null,
        programmeSchedule: rows.programmeSchedule.find((entry) => entry.channelId === row.id) || null };
      if (name === "musicMode") return { ...row, tracks: [], smartPlaylist: rows.smartPlaylist.find((entry) => entry.musicModeId === row.id) || null };
      if (name === "smartPlaylist") return { ...row, musicMode: rows.musicMode.find((entry) => entry.id === row.musicModeId) };
      if (name === "programmeScheduleVersion") return { ...row, createdBy: { id: USER, name: "Synthetic" }, publishedBy: null,
        schedule: { ...rows.programmeSchedule.find((entry) => entry.id === row.scheduleId), channel: decorate("channel", rows.channel.find((entry) => entry.id === rows.programmeSchedule.find((schedule) => schedule.id === row.scheduleId)?.channelId)) },
        items: row.items.map((item) => ({ ...item, musicMode: rows.musicMode.find((entry) => entry.id === item.musicModeId) || null })) };
      if (name === "programmeSchedule") return { ...row, channel: decorate("channel", rows.channel.find((entry) => entry.id === row.channelId)), createdBy: { id: USER, name: "Synthetic" },
        versions: rows.programmeScheduleVersion.filter((entry) => entry.scheduleId === row.id).sort((a, b) => b.version - a.version).map((entry) => decorate("programmeScheduleVersion", entry)) };
      return row;
    };
    const selectRows = (name, { where = {}, orderBy, take } = {}) => {
      calls.reads.push({ model: name, where: structuredClone(where) });
      const result = rows[name].map((row) => decorate(name, row)).filter((row) => matches(row, where));
      if (orderBy && !Array.isArray(orderBy)) {
        const [key, direction] = Object.entries(orderBy)[0];
        result.sort((a, b) => a[key] < b[key] ? (direction === "desc" ? 1 : -1) : a[key] > b[key] ? (direction === "desc" ? -1 : 1) : 0);
      }
      return take === undefined ? result : result.slice(0, take);
    };
    const clients = {};
    for (const name of Object.keys(rows)) {
      clients[name] = {
        findFirst: async (args) => selectRows(name, args)[0] || null,
        findUnique: async (args) => selectRows(name, args)[0] || null,
        findMany: async (args) => selectRows(name, args),
        count: async (args) => selectRows(name, args).length,
        create: async ({ data }) => {
          const record = { id: id(sequence++), createdAt: NOW, updatedAt: NOW, version: 1, ...structuredClone(data) };
          if (name === "station") {
            record.publicPlayerEnabled ??= false; record.stationWebsiteEnabled ??= false; record.streamConfig = null;
            const channelData = record.channels.create; delete record.channels;
            rows.station.push(record);
            rows.channel.push({ id: id(sequence++), ...channelData, organisationId: channelData.organisation.connect.id, stationId: record.id });
          } else if (name === "programmeSchedule") {
            const version = record.versions.create; delete record.versions; rows[name].push(record);
            await clients.programmeScheduleVersion.create({ data: { ...version, scheduleId: record.id, organisationId: record.organisationId } });
          } else if (name === "programmeScheduleVersion") {
            record.items = record.items.create; rows[name].push(record);
          } else rows[name].push(record);
          return decorate(name, record);
        },
        update: async ({ where, data }) => {
          const record = rows[name].find((row) => matches(row, where));
          if (!record) throw new Error("Synthetic record missing");
          for (const [key, value] of Object.entries(data)) record[key] = value && typeof value === "object" && Object.hasOwn(value, "increment") ? record[key] + value.increment : structuredClone(value);
          return decorate(name, record);
        },
        updateMany: () => failUnexpected(`${name}.updateMany`), deleteMany: () => failUnexpected(`${name}.deleteMany`)
      };
    }
    clients.$queryRaw = async (template, organisationId) => {
      assert.match(template.join("?"), /^SELECT "id" FROM "Organisation" WHERE "id" = \? FOR UPDATE$/);
      calls.locks += 1;
      return rows.organisation.filter((entry) => entry.id === organisationId).map(({ id }) => ({ id }));
    };
    for (const name of ["track", "mediaAsset", "radioClock", "schoolRundown", "autoDjPolicy", "job", "playoutIntent", "outgoingWebhookEvent"]) {
      clients[name] = new Proxy({}, { get: (_target, method) => () => failUnexpected(`${name}.${String(method)}`) });
    }
    return clients;
  }
  const prisma = { get state() { return state; }, calls,
    $transaction(operation) {
      calls.transactions += 1;
      const pending = queue.then(async () => { const next = structuredClone(state); const result = await operation(tables(next)); state = next; return result; });
      queue = pending.catch(() => {}); return pending;
    }
  };
  for (const model of Object.keys(tables(state))) prisma[model] = new Proxy({}, { get: (_target, method) => (...args) => tables(state)[model][method](...args) });
  return prisma;
}

function request(pathname, method, body) {
  return new Request(`https://preview.example.test${pathname}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
}

async function setup({ role = "OWNER", plan = PREVIEW_ONLINE_DRAFT_PLAN } = {}) {
  const prisma = memory();
  const sub = subscription(plan);
  prisma.state.subscription.push(sub);
  const context = () => ({ user: { id: USER }, membership: { organisationId: ORG, role, organisation: { id: ORG, subscription: sub, stations: prisma.state.station.filter((row) => row.organisationId === ORG) } } });
  prisma.organisationMember = { findUnique: async ({ where }) => {
    const scope = where.userId_organisationId;
    return scope?.userId === USER && scope.organisationId === ORG ? context().membership : null;
  } };
  const base = { NextResponse, prisma, getActiveOrganisationContext: async () => context(), getCurrentUser: async () => ({ id: USER }),
    resolveEntitlements, onlineDraftSubscription, onlineDraftChannelWhere, onlineDraftMusicModeWhere, lockOnlineDraftOrganisation, ONLINE_DRAFT_LIMITS };
  const { simplePlaylistAccess } = await loadActual("lib/simple-playlist-access.js", ["simplePlaylistAccess"], { ...base, canAuthorSmartPlaylist });
  const { contextForAdvancedScheduler } = await loadActual("lib/advanced-scheduler-access.js", ["contextForAdvancedScheduler"], base);
  const services = await loadActual("lib/advanced-scheduler-service.js", ["programmeSchedulerSources", "validateProgrammeScheduleSources", "programmeScheduleInclude", "listProgrammeSchedules", "safeProgrammeSchedule", "previewProgrammeSchedule", "publishProgrammeScheduleVersion"], {
    ...base, ...scheduler, cataloguePlaybackTrackInclude: {}, catalogueLevelForOrganisation: () => failUnexpected("catalogue entitlement query"),
    musicModeIsPlayable: () => failUnexpected("playable audio query"), assertCorrectionsSchedulingAllowed: () => failUnexpected("scheduling activation")
  });
  const common = { ...base, ...scheduler, ...services, simplePlaylistAccess, contextForAdvancedScheduler, randomUUID, z, normaliseGenreCode,
    parseSimplePlaylist, safeSimplePlaylist, rightsUseForChannel, smartPlaylistSlug, isOrganisationRoleAllowed, ORGANISATION_MANAGER_ROLES, isWithinLimit,
    slugify: (name) => name.toLowerCase().replaceAll(" ", "-") };
  const station = await loadActual("app/api/stations/route.js", ["POST"], common);
  const playlists = await loadActual("app/api/programming/simple/route.js", ["GET", "POST"], common);
  const playlist = await loadActual("app/api/programming/simple/[playlistId]/route.js", ["POST", "PATCH", "DELETE"], common);
  const schedules = await loadActual("app/api/programming/advanced-scheduler/route.js", ["GET", "POST"], common);
  const schedule = await loadActual("app/api/programming/advanced-scheduler/[scheduleId]/route.js", ["PUT"], common);
  const preview = await loadActual("app/api/programming/advanced-scheduler/[scheduleId]/preview/route.js", ["GET"], common);
  const deny = {};
  for (const [name, relative, method] of [
    ["event", "app/api/programming/simple/events/route.js", "POST"],
    ["nonstop", "app/api/programming/simple/nonstop/route.js", "PUT"],
    ["publish", "app/api/programming/advanced-scheduler/[scheduleId]/versions/[versionId]/publish/route.js", "POST"],
    ["archive", "app/api/programming/advanced-scheduler/[scheduleId]/archive/route.js", "POST"]
  ]) deny[name] = (await loadActual(relative, [method], { ...common, Prisma: {}, publishProgrammeScheduleVersion: () => failUnexpected("publish"), archiveProgrammeSchedule: () => failUnexpected("archive") }))[method];
  return { prisma, sub, services, station, playlists, playlist, schedules, schedule, preview, deny, simplePlaylistAccess, contextForAdvancedScheduler };
}

async function makeStation(h) {
  const response = await h.station.POST(request("/api/stations", "POST", { name: "Synthetic test station" }));
  assert.equal(response.status, 200);
  return h.prisma.state.channel[0];
}
const playlistBody = (channelId, extra = {}) => ({ channelId, name: "Synthetic Pop", durationValue: 1, durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["POP"], ...extra });
async function makePlaylist(h, channel) {
  const response = await h.playlists.POST(request("/api/programming/simple", "POST", playlistBody(channel.id)));
  assert.equal(response.status, 201);
  return (await response.json()).playlist;
}
const weekBody = (channelId, modeId, extra = {}) => ({ channelId, name: "Synthetic week", timezone: "Europe/Malta",
  items: [{ label: "Monday draft", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", weekday: 1, startTime: "09:00", durationMinutes: 60, priority: 50, sourceId: modeId }], ...extra });

test("draft policy allows only six exact write shapes and never static events, nonstop, publication or media", () => {
  const current = actor();
  for (const [method, pathname] of [["POST", "/api/stations"], ["POST", "/api/programming/simple"], ["POST", `/api/programming/simple/${id(20)}`], ["PATCH", `/api/programming/simple/${id(20)}`], ["POST", "/api/programming/advanced-scheduler"], ["PUT", `/api/programming/advanced-scheduler/${id(30)}`]]) {
    assert.equal(privatePreviewTesterRequestAllowed({ session: current, pathname, method, now: NOW }), true, `${method} ${pathname}`);
    assert.equal(privatePreviewTesterRequestAllowed({ session: actor(PREVIEW_TESTER_PLAN), pathname, method, now: NOW }), false);
  }
  for (const pathname of ["/api/programming/simple/events", "/api/programming/simple/nonstop", `/api/programming/simple/events/${id(21)}`, `/api/programming/simple/${id(21)}/publish`, `/api/programming/advanced-scheduler/${id(30)}/versions/${id(31)}/publish`, `/api/programming/advanced-scheduler/${id(30)}/archive`, `/api/stations/${id(5)}/setup`, `/api/admin/stations/${id(5)}/activate`, "/api/media/upload", "/api/programming/autodj", "/api/school-radio/audio-lab/uploads"]) {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) assert.equal(privatePreviewTesterRequestAllowed({ session: current, pathname, method, now: NOW }), false, `${method} ${pathname}`);
  }
});

test("station handler creates one pending station and unconnected draft channel, ignoring activation payloads", async () => {
  const h = await setup();
  const responses = await Promise.all([0, 1].map(() => h.station.POST(request("/api/stations", "POST", { name: "Synthetic", status: "ACTIVE", publicPlayerEnabled: true, stationWebsiteEnabled: true, streamUrl: "https://forbidden.example.test", storageLimitGb: 100 }))));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(h.prisma.state.station.length, 1);
  assert.equal(h.prisma.state.station[0].status, "PENDING_SETUP");
  assert.equal(h.prisma.state.station[0].storageLimitGb, 0);
  assert.equal(h.prisma.state.station[0].publicPlayerEnabled, false);
  assert.equal(h.prisma.state.station[0].streamConfig, null);
  assert.equal(h.prisma.state.channel.length, 1);
  assert.equal(h.prisma.state.channel[0].status, "DRAFT");
  assert.equal(h.prisma.state.channel[0].musicRightsUse, "ONLINE_RADIO");
  assert.equal(h.prisma.calls.locks, 2);
});

test("station route refuses foreign organisation selection, non-manager roles and missing Online entitlement", async () => {
  const foreign = await setup();
  assert.equal((await foreign.station.POST(request("/", "POST", { name: "Foreign station", organisationId: FOREIGN }))).status, 403);
  assert.equal(foreign.prisma.calls.transactions, 0);
  const viewer = await setup({ role: "VIEWER" });
  assert.equal((await viewer.station.POST(request("/", "POST", { name: "Viewer station" }))).status, 403);
  assert.equal(viewer.prisma.calls.transactions, 0);
  const excluded = await setup(); excluded.sub.onlineRadioEnabled = false;
  assert.equal((await excluded.station.POST(request("/", "POST", { name: "Excluded station" }))).status, 403);
  assert.equal(excluded.prisma.calls.transactions, 0);
});

test("playlist create/update/duplicate persist draft-only metadata and cannot mutate a foreign or active playlist", async () => {
  const h = await setup(); const channel = await makeStation(h); const saved = await makePlaylist(h, channel);
  assert.equal(saved.status, "DRAFT");
  assert.equal(h.prisma.state.musicMode[0].status, "DRAFT");
  const updated = await h.playlist.PATCH(request(`/api/programming/simple/${saved.id}`, "PATCH", playlistBody(channel.id, { name: "Edited draft", status: "ACTIVE" })), { params: { playlistId: saved.id } });
  assert.equal(updated.status, 200);
  assert.equal(h.prisma.state.smartPlaylist[0].status, "DRAFT");
  assert.equal(h.prisma.state.smartPlaylist[0].version, 2);
  const copied = await h.playlist.POST(request(`/api/programming/simple/${saved.id}`, "POST", { action: "duplicate" }), { params: { playlistId: saved.id } });
  assert.equal(copied.status, 201);
  assert.ok(h.prisma.state.musicMode.every((mode) => mode.status === "DRAFT"));
  h.prisma.state.smartPlaylist[0].organisationId = FOREIGN;
  assert.equal((await h.playlist.PATCH(request("/", "PATCH", playlistBody(channel.id)), { params: { playlistId: saved.id } })).status, 404);
  h.prisma.state.smartPlaylist[0].organisationId = ORG;
  h.prisma.state.smartPlaylist[0].status = "ACTIVE";
  assert.equal((await h.playlist.PATCH(request("/", "PATCH", playlistBody(channel.id)), { params: { playlistId: saved.id } })).status, 403);
  assert.equal((await h.playlist.POST(request("/", "POST", { action: "duplicate" }), { params: { playlistId: saved.id } })).status, 403);
});

test("playlist channel selection fails closed for foreign, active, connected or public station resources", async () => {
  for (const mutate of [
    (h) => { h.prisma.state.channel[0].organisationId = FOREIGN; },
    (h) => { h.prisma.state.channel[0].status = "ACTIVE"; },
    (h) => { h.prisma.state.station[0].streamConfig = { streamUrl: "https://not-fetched.example.test" }; },
    (h) => { h.prisma.state.station[0].publicPlayerEnabled = true; },
    (h) => { h.prisma.state.station[0].stationWebsiteEnabled = true; }
  ]) {
    const h = await setup(); const channel = await makeStation(h); mutate(h);
    assert.equal((await h.playlists.POST(request("/", "POST", playlistBody(channel.id)))).status, 404);
    assert.equal(h.prisma.state.smartPlaylist.length, 0);
  }
});

test("playlist create and duplicate caps count under the shared organisation row lock", async () => {
  const h = await setup(); const channel = await makeStation(h); const saved = await makePlaylist(h, channel);
  while (h.prisma.state.smartPlaylist.length < ONLINE_DRAFT_LIMITS.playlists) h.prisma.state.smartPlaylist.push({ ...h.prisma.state.smartPlaylist[0], id: id(500 + h.prisma.state.smartPlaylist.length) });
  const before = h.prisma.state.musicMode.length;
  assert.equal((await h.playlists.POST(request("/", "POST", playlistBody(channel.id)))).status, 409);
  assert.equal((await h.playlist.POST(request("/", "POST", { action: "duplicate" }), { params: { playlistId: saved.id } })).status, 409);
  assert.equal(h.prisma.state.smartPlaylist.length, ONLINE_DRAFT_LIMITS.playlists);
  assert.equal(h.prisma.state.musicMode.length, before);
});

test("weekly draft source listing and validation never fetch audio/catalogue or offer foreign/live modes", async () => {
  const h = await setup(); const channel = await makeStation(h); await makePlaylist(h, channel);
  h.prisma.state.musicMode.push({ ...h.prisma.state.musicMode[0], id: id(600), organisationId: FOREIGN, name: "Foreign" });
  h.prisma.state.musicMode.push({ ...h.prisma.state.musicMode[0], id: id(601), status: "ACTIVE", name: "Active" });
  const response = await h.schedules.GET(); assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.canPublish, false); assert.equal(payload.sandboxDraftOnly, true);
  assert.equal(payload.sources.channels.length, 1); assert.equal(payload.sources.musicModes.length, 1);
  assert.match(payload.sources.musicModes[0].name, /test draft \(no audio\)/);
  assert.deepEqual(payload.sources.radioClocks, []); assert.deepEqual(payload.sources.rundowns, []);
  await assert.rejects(h.services.validateProgrammeScheduleSources(h.prisma, ORG, [{ sourceType: "MUSIC_MODE", musicModeId: id(600) }], { sandboxDraftOnly: true }), /owned by this test workspace/);
  await assert.rejects(h.services.validateProgrammeScheduleSources(h.prisma, ORG, [{ sourceType: "RADIO_CLOCK", radioClockId: id(602) }], { sandboxDraftOnly: true }), /private draft playlists only/);
});

test("actual weekly create/version/preview paths keep all versions inactive and compile owned draft sources", async () => {
  const h = await setup(); const channel = await makeStation(h); await makePlaylist(h, channel);
  const body = weekBody(channel.id, h.prisma.state.musicMode[0].id);
  const created = await h.schedules.POST(request("/", "POST", { ...body, publish: true, isActive: true }));
  assert.equal(created.status, 201); const first = (await created.json()).schedule;
  assert.equal(first.activeVersion, null);
  assert.equal(h.prisma.state.programmeScheduleVersion[0].status, "DRAFT"); assert.equal(h.prisma.state.programmeScheduleVersion[0].isActive, false);
  const updated = await h.schedule.PUT(request("/", "PUT", { ...body, name: "Next draft" }), { params: { scheduleId: first.id } });
  assert.equal(updated.status, 200); assert.equal(h.prisma.state.programmeScheduleVersion.length, 2);
  assert.ok(h.prisma.state.programmeScheduleVersion.every((version) => version.status === "DRAFT" && version.isActive === false));
  const versionId = h.prisma.state.programmeScheduleVersion[1].id;
  const preview = await h.preview.GET(request(`/?versionId=${versionId}&days=7`, "GET"), { params: { scheduleId: first.id } });
  assert.equal(preview.status, 200, await preview.clone().text()); const payload = await preview.json();
  assert.equal(payload.preview.readyToPublish, false); assert.equal(payload.preview.schedule.timezone, "Europe/Malta");
  assert.equal(payload.preview.occurrences.length, 1); assert.equal(payload.preview.occurrences[0].label, "Monday draft");
  const before = h.prisma.state.programmeScheduleVersion.length;
  assert.equal((await h.schedule.PUT(request("/", "PUT", { ...body, timezone: "UTC" }), { params: { scheduleId: first.id } })).status, 409);
  h.prisma.state.programmeSchedule[0].organisationId = FOREIGN;
  assert.equal((await h.schedule.PUT(request("/", "PUT", body), { params: { scheduleId: first.id } })).status, 404);
  assert.equal(h.prisma.state.programmeScheduleVersion.length, before);
  assert.equal((await h.preview.GET(request(`/?versionId=${id(999)}`, "GET"), { params: { scheduleId: first.id } })).status, 404);
});

test("weekly version cap refuses additional draft writes without changing the saved schedule", async () => {
  const h = await setup(); const channel = await makeStation(h); await makePlaylist(h, channel);
  const body = weekBody(channel.id, h.prisma.state.musicMode[0].id);
  const created = await h.schedules.POST(request("/", "POST", body)); const scheduleId = (await created.json()).schedule.id;
  while (h.prisma.state.programmeScheduleVersion.length < ONLINE_DRAFT_LIMITS.scheduleVersions) h.prisma.state.programmeScheduleVersion.push({ ...h.prisma.state.programmeScheduleVersion[0], id: id(700 + h.prisma.state.programmeScheduleVersion.length), version: h.prisma.state.programmeScheduleVersion.length + 1 });
  assert.equal((await h.schedule.PUT(request("/", "PUT", { ...body, name: "Should not save" }), { params: { scheduleId } })).status, 409);
  assert.equal(h.prisma.state.programmeScheduleVersion.length, ONLINE_DRAFT_LIMITS.scheduleVersions);
  assert.equal(h.prisma.state.programmeSchedule[0].name, body.name);
});

test("actual event/nonstop/delete/publish/archive handlers deny draft accounts before body reads or mutation", async () => {
  const h = await setup();
  const unreadable = { json: () => failUnexpected("forbidden request body"), url: "https://preview.example.test/" };
  for (const handler of Object.values(h.deny)) {
    const response = await handler(unreadable, { params: { scheduleId: id(50), versionId: id(51) } });
    assert.equal(response.status, 403);
  }
  assert.equal((await h.playlist.DELETE(unreadable, { params: { playlistId: id(52) } })).status, 403);
  assert.equal(h.prisma.calls.transactions, 0);
  assert.deepEqual(h.prisma.state.auditLog, []);
});

test("direct schedule publication service also blocks the exact draft-only subscription", async () => {
  const h = await setup();
  await assert.rejects(h.services.publishProgrammeScheduleVersion({ organisationId: ORG, scheduleId: id(90), versionId: id(91), actorUserId: USER }), /cannot publish programmes/);
  assert.equal(h.prisma.calls.transactions, 1);
  assert.equal(h.prisma.calls.reads.some((read) => read.model === "programmeScheduleVersion"), false);
  assert.deepEqual(h.prisma.state.auditLog, []);
});
