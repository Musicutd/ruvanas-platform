import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { canAuthorProgrammeSchedule, compileProgrammeScheduleHorizon, parseProgrammeScheduleInput } from "../lib/advanced-scheduler.mjs";

const channelId = "cm12345678901234567890123";
const body = { channelId, name: "Station week", timezone: "Europe/Malta", items: [{ label: "Music programme", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", weekday: 5, startTime: "23:00", durationMinutes: 120, priority: 50, sourceId: "mode-a" }] };
const source = await readFile(new URL("../app/api/programming/advanced-scheduler/[scheduleId]/route.js", import.meta.url), "utf8");

async function draftRequest(input, { role = "OWNER", found = true } = {}) {
  const calls = [];
  const transaction = {
    programmeScheduleVersion: { findFirst: async () => ({ version: 1 }), create: async (args) => { calls.push(["version", args]); } },
    programmeSchedule: { update: async (args) => { calls.push(["schedule", args]); } },
    auditLog: { create: async () => {} }
  };
  const sandbox = {
    NextResponse: { json: (payload, options) => ({ payload, status: options?.status || 200 }) },
    contextForAdvancedScheduler: async () => ({ context: { user: { id: "user-a" }, membership: { organisationId: "org-a", role } } }),
    canAuthorProgrammeSchedule, parseProgrammeScheduleInput,
    validateProgrammeScheduleSources: async () => { calls.push(["validate"]); },
    programmeScheduleInclude: {}, safeProgrammeSchedule: (value) => value,
    prisma: {
      programmeSchedule: { findFirst: async (args) => { calls.push(["lookup", args]); return found ? { id: "schedule-a", channelId, timezone: "Europe/Malta" } : null; }, findUnique: async () => ({ id: "schedule-a" }) },
      $transaction: async (callback) => { calls.push(["transaction"]); return callback(transaction); }
    }, console
  };
  const runnable = source.replace(/^import .*;\r?$/gm, "").replace("export async function PUT", "async function PUT") + "\nglobalThis.testPut = PUT;";
  vm.runInNewContext(runnable, sandbox);
  return { result: await sandbox.testPut({ json: async () => input }, { params: Promise.resolve({ scheduleId: "schedule-a" }) }), calls };
}

test("draft route rejects a changed shared timezone before validation or database writes", async () => {
  const { result, calls } = await draftRequest({ ...body, timezone: "America/New_York" });
  assert.equal(result.status, 409);
  assert.match(result.payload.error, /cannot retime/);
  assert.deepEqual(calls.map(([type]) => type), ["lookup"]);
  assert.equal(calls[0][1].where.organisationId, "org-a");
});

test("same-zone draft creates a new version without updating shared timezone or publishing", async () => {
  const { result, calls } = await draftRequest(body);
  assert.equal(result.status, 200);
  const update = calls.find(([type]) => type === "schedule")[1];
  assert.deepEqual(Object.keys(update.data), ["name"]);
  const version = calls.find(([type]) => type === "version")[1];
  assert.equal(version.data.organisationId, "org-a");
  assert.equal(version.data.version, 2);
  assert.equal("isActive" in version.data, false);
  assert.equal("publishedAt" in version.data, false);
});

test("draft route retains role, tenant not-found and immutable-channel safeguards", async () => {
  assert.equal((await draftRequest(body, { role: "VIEWER" })).result.status, 403);
  assert.equal((await draftRequest(body, { found: false })).result.status, 404);
  assert.equal((await draftRequest({ ...body, channelId: "cm22345678901234567890123" })).result.status, 409);
});

test("weekly compiler includes previous-day overnight programme and its first-day conflicts", () => {
  const parsed = parseProgrammeScheduleInput(body);
  assert.equal(parsed.ok, true);
  const overnight = parsed.data.items[0];
  const firstDay = { ...overnight, position: 1, label: "Saturday show", weekday: 6, startMinute: 30, durationMinutes: 60 };
  const preview = compileProgrammeScheduleHorizon({ items: [overnight, firstDay] }, { timezone: "Europe/Malta", startsAt: new Date("2026-10-16T22:30:00Z"), days: 7 });
  assert.equal(preview.occurrences[0].startsAt.toISOString(), "2026-10-16T21:00:00.000Z");
  assert.equal(preview.occurrences[0].endsAt.toISOString(), "2026-10-16T23:00:00.000Z");
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].severity, "BLOCKING");
});

test("carry-in excludes ended programmes and includes a spring-forward 24-hour spill", () => {
  const ended = { position: 0, label: "Ended", recurrence: "WEEKLY", sourceType: "MUSIC_MODE", weekday: 5, startMinute: 22 * 60, durationMinutes: 120, priority: 50 };
  const options = { timezone: "Europe/Malta", startsAt: new Date("2026-10-16T22:30:00Z"), days: 1 };
  assert.equal(compileProgrammeScheduleHorizon({ items: [ended] }, options).occurrences.length, 0);
  const spill = { ...ended, weekday: 0, startMinute: 0, durationMinutes: 1440 };
  const preview = compileProgrammeScheduleHorizon({ items: [spill] }, { timezone: "Europe/Malta", startsAt: new Date("2026-03-30T00:00:00Z"), days: 1 });
  assert.equal(preview.occurrences.length, 1);
  assert.equal(preview.occurrences[0].endsAt.toISOString(), "2026-03-29T23:00:00.000Z");
  const twoMidnights = compileProgrammeScheduleHorizon({ items: [{ ...spill, weekday: 6, startMinute: 23 * 60 + 30 }] }, { timezone: "Europe/Malta", startsAt: new Date("2026-03-29T22:00:00Z"), days: 1 });
  assert.equal(twoMidnights.occurrences.length, 1);
  assert.equal(twoMidnights.occurrences[0].startsAt.toISOString(), "2026-03-28T22:30:00.000Z");
  assert.equal(twoMidnights.occurrences[0].endsAt.toISOString(), "2026-03-29T22:30:00.000Z");
});
