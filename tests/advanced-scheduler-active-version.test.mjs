import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../lib/advanced-scheduler-service.js", import.meta.url), "utf8");
const instant = new Date("2026-10-18T12:00:00.000Z");

function fixture(version, isActive = false) {
  return {
    id: `version-${version}`, version, isActive, status: isActive ? "PUBLISHED" : "DRAFT",
    createdAt: instant, updatedAt: instant, publishedAt: isActive ? instant : null,
    items: []
  };
}

function loadService({ versions = [] } = {}) {
  const calls = [];
  const schedule = {
    id: "schedule-a", name: "Station week", timezone: "Europe/Malta",
    channel: { id: "channel-a", name: "Test Radio" },
    createdAt: instant, updatedAt: instant
  };
  const sandbox = {
    cataloguePlaybackTrackInclude: {},
    prisma: { programmeSchedule: { findMany: async (args) => {
      calls.push(args);
      const ordering = Array.isArray(args.include.versions.orderBy) ? args.include.versions.orderBy : [args.include.versions.orderBy];
      const selected = [...versions].sort((left, right) => {
        for (const order of ordering) {
          const [field, direction] = Object.entries(order)[0];
          const comparison = Number(left[field]) - Number(right[field]);
          if (comparison) return direction === "desc" ? -comparison : comparison;
        }
        return 0;
      }).slice(0, args.include.versions.take);
      return [{ ...schedule, versions: selected }];
    } } }
  };
  const runnable = source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/\bexport /g, "")
    + "\nglobalThis.service = { listProgrammeSchedules, safeProgrammeSchedule, programmeScheduleInclude };";
  vm.runInNewContext(runnable, sandbox);
  return { ...sandbox.service, calls, schedule };
}

test("active schedule survives more than 20 newer drafts while latest remains first for editing", async () => {
  const service = loadService({ versions: Array.from({ length: 41 }, (_, index) => fixture(index + 1, index === 0)) });
  const [result] = await service.listProgrammeSchedules("org-a");

  assert.equal(result.activeVersion?.version, 1);
  assert.equal(result.activeVersion?.status, "PUBLISHED");
  assert.equal(result.versions[0].version, 41);
  assert.equal(result.latestVersion, 41);
  assert.deepEqual(Array.from(result.versions, (version) => version.version), [41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 1]);
  assert.equal(service.calls[0].where.organisationId, "org-a");
  assert.equal(service.calls[0].take, 100);
  assert.equal(service.calls[0].include.versions.take, 21);
});

test("serializer restores newest-first order without mutating the active-first database result", () => {
  const service = loadService();
  const versions = [fixture(1, true), fixture(9), fixture(8)];
  const result = service.safeProgrammeSchedule({ ...service.schedule, versions });

  assert.deepEqual(versions.map((version) => version.version), [1, 9, 8]);
  assert.deepEqual(Array.from(result.versions, (version) => version.version), [9, 8, 1]);
  assert.equal(result.activeVersion.version, 1);
  assert.equal(result.latestVersion, 9);
});

test("draft-only and empty schedules retain their correct state and bounded history", async () => {
  const drafts = loadService({ versions: Array.from({ length: 50 }, (_, index) => fixture(index + 1)) });
  const [result] = await drafts.listProgrammeSchedules("org-a");
  assert.equal(result.activeVersion, null);
  assert.equal(result.versions.length, 21);
  assert.equal(result.versions[0].version, 50);
  assert.equal(result.latestVersion, 50);

  const empty = drafts.safeProgrammeSchedule({ ...drafts.schedule, versions: [] });
  assert.equal(empty.activeVersion, null);
  assert.equal(empty.latestVersion, 0);
  assert.equal(empty.versions.length, 0);
});
