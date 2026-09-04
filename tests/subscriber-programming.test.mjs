import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildProgrammingWeek,
  canManageSubscriberProgramming,
  formatProgrammingTime,
  previousProgrammingDate,
  publishedScheduleTransition,
  requirePublishPreview
} from "../lib/subscriber-programming.mjs";
import { buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";

test("only organisation owners and managers can edit subscriber programming", () => {
  assert.equal(canManageSubscriberProgramming("OWNER"), true);
  assert.equal(canManageSubscriberProgramming("MANAGER"), true);
  assert.equal(canManageSubscriberProgramming("CONTENT_EDITOR"), false);
  assert.equal(canManageSubscriberProgramming("VIEWER"), false);
});

test("weekly preview groups approved modes by local day and marks overnight programmes", () => {
  const week = buildProgrammingWeek([
    { id: "morning", weekday: 1, startMinute: 540, endMinute: 720, musicModeId: "mode-1", musicMode: { name: "Morning energy" } },
    { id: "late", weekday: 5, startMinute: 1320, endMinute: 120, musicModeId: "mode-2", musicModeName: "Late service" }
  ]);
  assert.equal(week[1].slots[0].startsAt, "09:00");
  assert.equal(week[1].slots[0].musicModeName, "Morning energy");
  assert.equal(week[5].slots[0].overnight, true);
  assert.equal(formatProgrammingTime(1439), "23:59");
});

test("publishing requires a confirmed preview while draft saving does not", () => {
  assert.equal(requirePublishPreview({ publish: false, previewAcknowledged: false }), true);
  assert.equal(requirePublishPreview({ publish: true, previewAcknowledged: true }), true);
  assert.throws(() => requirePublishPreview({ publish: true, previewAcknowledged: false }), /preview/i);
});

test("future programming keeps the current plan live and closes it the day before", () => {
  assert.equal(publishedScheduleTransition({ effectiveFrom: null, effectiveTo: null }, "2026-10-01"), "END_BEFORE");
  assert.equal(publishedScheduleTransition({ effectiveFrom: "2026-11-01", effectiveTo: null }, "2026-10-01"), "ARCHIVE");
  assert.equal(publishedScheduleTransition({ effectiveFrom: null, effectiveTo: "2026-09-20" }, "2026-10-01"), "KEEP");
  assert.equal(publishedScheduleTransition({ effectiveFrom: null, effectiveTo: null }, null), "ARCHIVE");
  assert.equal(previousProgrammingDate("2026-10-01"), "2026-09-30");
});

test("subscriber navigation exposes programming only when radio service is enabled", () => {
  const enabled = buildSubscriberNavigation({ entitlements: { serviceEnabled: true } }).flatMap((section) => section.items);
  const disabled = buildSubscriberNavigation({ entitlements: { serviceEnabled: false } }).flatMap((section) => section.items);
  assert.ok(enabled.some((item) => item.href === "/dashboard/programming"));
  assert.ok(!disabled.some((item) => item.href === "/dashboard/programming"));
});

test("subscriber programming API is tenant-derived, role-controlled and catalogue-safe", async () => {
  const [route, autoDjRoute, page] = await Promise.all([
    readFile(new URL("../app/api/programming/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/autodj/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/page.js", import.meta.url), "utf8")
  ]);
  assert.match(route, /organisationId = context\.membership\.organisationId/);
  assert.match(route, /canManageSubscriberProgramming\(context\.membership\.role\)/);
  assert.match(route, /status: "ACTIVE"/);
  assert.match(route, /requirePublishPreview\(data\)/);
  assert.doesNotMatch(route, /data\.organisationId/);
  assert.match(autoDjRoute, /organisationId = context\.membership\.organisationId/);
  assert.match(autoDjRoute, /canManageSubscriberProgramming\(context\.membership\.role\)/);
  assert.match(autoDjRoute, /musicModeIsPlayable/);
  assert.doesNotMatch(autoDjRoute, /parsed\.data\.organisationId/);
  assert.match(page, /Catalogue protected/);
});

