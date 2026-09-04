import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContinuousProgrammingWeek,
  normalizeAutoDjPolicyInput,
  resolveAutoDjFallback
} from "../lib/autodj-policy.mjs";

const active = (id) => ({ id, name: id, status: "ACTIVE" });

test("enabled AutoDJ requires a default and keeps backup distinct", () => {
  assert.throws(() => normalizeAutoDjPolicyInput({ enabled: true }), /default music mode/i);
  assert.throws(() => normalizeAutoDjPolicyInput({
    enabled: true,
    defaultMusicModeId: "mode-1",
    backupMusicModeId: "mode-1"
  }), /different backup/i);
  assert.deepEqual(normalizeAutoDjPolicyInput({
    enabled: true,
    defaultMusicModeId: " mode-1 ",
    playbackPolicy: "run_24_7"
  }), {
    enabled: true,
    defaultMusicModeId: "mode-1",
    backupMusicModeId: null,
    playbackPolicy: "RUN_24_7"
  });
});

test("default and backup AutoDJ follow the explicit failover order", () => {
  const defaultMusicMode = active("default");
  const backupMusicMode = active("backup");
  const defaultResult = resolveAutoDjFallback({
    policy: { enabled: true, defaultMusicMode, backupMusicMode }
  });
  assert.equal(defaultResult.reason, "DEFAULT_AUTODJ");
  assert.equal(defaultResult.alert, null);

  const backupResult = resolveAutoDjFallback({
    policy: { enabled: true, defaultMusicMode, backupMusicMode },
    musicModeAvailable: (mode) => mode?.id === "backup"
  });
  assert.equal(backupResult.reason, "BACKUP_AUTODJ");
  assert.equal(backupResult.alert.code, "DEFAULT_AUTODJ_UNAVAILABLE");

  const failed = resolveAutoDjFallback({
    policy: { enabled: true, defaultMusicMode, backupMusicMode },
    musicModeAvailable: () => false
  });
  assert.equal(failed.reason, "NO_PROGRAMMING");
  assert.equal(failed.alert.severity, "CRITICAL");
});

test("weekly preview visibly fills only schedule gaps with AutoDJ", () => {
  const week = buildContinuousProgrammingWeek([
    { id: "slot", weekday: 1, startMinute: 540, endMinute: 1020, musicModeName: "Day programme" }
  ], { enabled: true, defaultMusicMode: active("Always on") });
  assert.deepEqual(week[1].segments.map((segment) => [segment.startMinute, segment.endMinute, segment.source]), [
    [0, 540, "DEFAULT_AUTODJ"],
    [540, 1020, "SCHEDULED"],
    [1020, 1440, "DEFAULT_AUTODJ"]
  ]);
  assert.deepEqual(week[0].segments.map((segment) => segment.source), ["DEFAULT_AUTODJ"]);
});

test("overnight programmes stay scheduled and AutoDJ covers the surrounding time", () => {
  const week = buildContinuousProgrammingWeek([
    { id: "late", weekday: 5, startMinute: 1320, endMinute: 120 }
  ], { enabled: true, defaultMusicMode: active("fallback") });
  assert.deepEqual(week[5].segments.map((segment) => [segment.startMinute, segment.endMinute, segment.source]), [
    [0, 1320, "DEFAULT_AUTODJ"],
    [1320, 1440, "SCHEDULED"]
  ]);
  assert.deepEqual(week[6].segments.map((segment) => [segment.startMinute, segment.endMinute, segment.source]), [
    [0, 120, "SCHEDULED"],
    [120, 1440, "DEFAULT_AUTODJ"]
  ]);
});
