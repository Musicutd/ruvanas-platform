import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { normaliseSchedulePayload, resolveMusicSchedule } from "../lib/music-scheduling.mjs";
import { percentile } from "../lib/performance-readiness.mjs";

test("maximum weekly schedule validation remains bounded", () => {
  const slots = Array.from({ length: 168 }, (_, index) => ({
    weekday: Math.floor(index / 24), startsAt: `${String(index % 24).padStart(2, "0")}:00`, endsAt: `${String((index % 24) + 1).padStart(2, "0")}:00`, musicModeId: `mode-${index}`, priority: 10
  }));
  slots.filter((slot) => slot.endsAt === "24:00").forEach((slot) => { slot.endsAt = "00:00"; });
  const samples = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const startedAt = performance.now();
    const normalized = normaliseSchedulePayload({ timezone: "Europe/Malta", slots });
    samples.push(performance.now() - startedAt);
    assert.equal(normalized.slots.length, 168);
  }
  assert.ok(percentile(samples, 95) < 100, `weekly schedule validation p95 exceeded 100ms: ${percentile(samples, 95)}ms`);
});

test("schedule resolution remains bounded across two hundred candidates", () => {
  const schedules = Array.from({ length: 200 }, (_, index) => ({
    id: `schedule-${index}`, status: "PUBLISHED", version: index + 1, zoneId: index === 199 ? "zone-1" : null,
    slots: [{ id: `slot-${index}`, weekday: 1, startMinute: 0, endMinute: 1439, priority: index % 100, musicMode: { id: `mode-${index}`, status: "ACTIVE" } }]
  }));
  const samples = [];
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const startedAt = performance.now();
    const result = resolveMusicSchedule({ schedules, instant: new Date("2026-08-31T10:00:00.000Z"), timezone: "Europe/Malta" });
    samples.push(performance.now() - startedAt);
    assert.equal(result.musicMode.id, "mode-199");
  }
  assert.ok(percentile(samples, 95) < 50, `schedule resolution p95 exceeded 50ms: ${percentile(samples, 95)}ms`);
});
