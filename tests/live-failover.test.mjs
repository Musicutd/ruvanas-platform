import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decideLiveFailover,
  failoverSourceAvailability,
  liveFailoverCandidate,
  parseLiveFailoverAction,
  parseLiveFailoverPolicyInput
} from "../lib/live-failover.mjs";

const now = new Date("2026-09-05T10:00:00.000Z");
const source = (id, overrides = {}) => ({
  id,
  organisationId: "org-1",
  channelId: "channel-1",
  name: id === "primary" ? "Main studio" : "Backup studio",
  providerKey: "GENERIC_HTTP",
  streamUrl: `https://${id}.example/live`,
  status: id === "primary" ? "ACTIVE" : "READY",
  healthStatus: "HEALTHY",
  lastHealthCheckedAt: new Date(now.getTime() - 10_000),
  consecutiveFailures: 0,
  updatedAt: new Date(now.getTime() - 20_000),
  ...overrides
});
const policy = (overrides = {}) => ({
  id: "policy-1",
  organisationId: "org-1",
  channelId: "channel-1",
  primarySourceId: "primary",
  backupSourceId: "backup",
  effectiveSourceId: "primary",
  manualSourceId: null,
  manualOverrideUntil: null,
  enabled: true,
  state: "PRIMARY",
  failureThreshold: 2,
  recoveryThreshold: 3,
  recoveryHoldSeconds: 60,
  recoveryHealthyProbes: 0,
  primaryHealthySince: null,
  updatedAt: now,
  ...overrides
});

test("failover inputs are bounded and cannot assign one source twice", () => {
  assert.deepEqual(parseLiveFailoverPolicyInput({ channelId: " channel-1 ", primarySourceId: "primary", backupSourceId: "backup", failureThreshold: 99, recoveryThreshold: 0, recoveryHoldSeconds: 5 }), {
    channelId: "channel-1", primarySourceId: "primary", backupSourceId: "backup", enabled: true,
    failureThreshold: 5, recoveryThreshold: 1, recoveryHoldSeconds: 30
  });
  assert.throws(() => parseLiveFailoverPolicyInput({ channelId: "channel-1", primarySourceId: "same", backupSourceId: "same" }), /different/i);
  assert.deepEqual(parseLiveFailoverAction({ action: "override", policyId: "policy-1", sourceId: "backup", durationMinutes: 999 }), { action: "OVERRIDE", policyId: "policy-1", sourceId: "backup", durationMinutes: 240 });
});

test("only ready, healthy, fresh and in-window sources can carry failover audio", () => {
  assert.equal(failoverSourceAvailability(source("backup"), now).available, true);
  assert.equal(failoverSourceAvailability(source("backup", { healthStatus: "UNREACHABLE" }), now).reason, "SOURCE_UNREACHABLE");
  assert.equal(failoverSourceAvailability(source("backup", { lastHealthCheckedAt: new Date(now.getTime() - 151_000) }), now).reason, "SOURCE_HEALTH_STALE");
  assert.equal(failoverSourceAvailability(source("backup", { endsAt: new Date(now.getTime() - 1) }), now).reason, "SOURCE_WINDOW_ENDED");
  assert.equal(failoverSourceAvailability(source("backup", { status: "SUSPENDED" }), now).reason, "SOURCE_NOT_READY");
});

test("confirmed primary failure selects a healthy backup with evidence semantics", () => {
  const primary = source("primary", { healthStatus: "UNREACHABLE", consecutiveFailures: 2 });
  const decision = decideLiveFailover(policy(), { primary, backup: source("backup") }, now);
  assert.equal(decision.state, "BACKUP");
  assert.equal(decision.effectiveSourceId, "backup");
  assert.equal(decision.kind, "BACKUP_SELECTED");
  assert.match(decision.lastTransitionReason, /PRIMARY_FAILED/);
});

test("unconfirmed or dual failure fails safely to shared schedule and AutoDJ", () => {
  const firstFailure = decideLiveFailover(policy(), { primary: source("primary", { healthStatus: "DEGRADED", consecutiveFailures: 1 }), backup: source("backup") }, now);
  assert.equal(firstFailure.state, "SCHEDULED_FALLBACK");
  assert.equal(firstFailure.effectiveSourceId, null);
  const dualFailure = decideLiveFailover(policy({ state: "BACKUP", effectiveSourceId: "backup" }), {
    primary: source("primary", { healthStatus: "UNREACHABLE", consecutiveFailures: 4 }),
    backup: source("backup", { healthStatus: "UNREACHABLE", consecutiveFailures: 2 })
  }, now);
  assert.equal(dualFailure.state, "SCHEDULED_FALLBACK");
  assert.equal(dualFailure.kind, "PROGRAMMING_FALLBACK_SELECTED");
});

test("primary recovery waits for both healthy probes and the recovery hold", () => {
  const pending = decideLiveFailover(policy({ state: "BACKUP", effectiveSourceId: "backup" }), { primary: source("primary"), backup: source("backup") }, now);
  assert.equal(pending.state, "RECOVERY_PENDING");
  assert.equal(pending.effectiveSourceId, "backup");
  assert.equal(pending.recoveryHealthyProbes, 1);
  const recovered = decideLiveFailover(policy({ state: "RECOVERY_PENDING", effectiveSourceId: "backup", primaryHealthySince: new Date(now.getTime() - 61_000), recoveryHealthyProbes: 2 }), { primary: source("primary"), backup: source("backup") }, now);
  assert.equal(recovered.state, "PRIMARY");
  assert.equal(recovered.effectiveSourceId, "primary");
  assert.equal(recovered.kind, "PRIMARY_RECOVERED");
});

test("a healthy time-limited manual override wins without weakening automatic expiry", () => {
  const active = decideLiveFailover(policy({ manualSourceId: "backup", manualOverrideUntil: new Date(now.getTime() + 60_000) }), { primary: source("primary"), backup: source("backup"), manual: source("backup") }, now);
  assert.equal(active.state, "MANUAL_OVERRIDE");
  assert.equal(active.effectiveSourceId, "backup");
  const expired = decideLiveFailover(policy({ state: "MANUAL_OVERRIDE", effectiveSourceId: "backup", manualSourceId: "backup", manualOverrideUntil: new Date(now.getTime() - 1) }), { primary: source("primary"), backup: source("backup"), manual: source("backup") }, now);
  assert.equal(expired.state, "RECOVERY_PENDING");
  assert.equal(expired.manualSourceId, null);
  assert.equal(expired.kind, "MANUAL_OVERRIDE_CLEARED");
});

test("the selected failover source feeds the unified live candidate without exposing endpoints", () => {
  const candidate = liveFailoverCandidate({ ...policy({ state: "BACKUP", effectiveSourceId: "backup", lastTransitionAt: now, lastTransitionReason: "PRIMARY_FAILED" }), effectiveSource: source("backup") }, { organisationId: "org-1", channelId: "channel-1", instant: now });
  assert.equal(candidate.available, true);
  assert.equal(candidate.sourceId, "backup");
  assert.equal(candidate.payload.resolution.liveSource.failoverState, "BACKUP");
  assert.equal(JSON.stringify(candidate).includes("backup.example"), false);
});

test("Stage 19.9 is wired through the shared worker, resolver, protected relay and manager route", async () => {
  const [worker, programming, relay, route, schema, migration, roadmap] = await Promise.all([
    readFile(new URL("../scripts/operations-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/player-programming.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/player/live/[sourceId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/programming/live-failover/route.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261010000000_stage_19_9_live_failover/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-online-radio-index.md", import.meta.url), "utf8")
  ]);
  assert.match(worker, /scanLiveFailoverPolicies/);
  assert.match(programming, /liveFailoverCandidate/);
  assert.match(relay, /status: \{ in: \["ACTIVE", "READY"\] \}/);
  assert.match(route, /OWNER.*MANAGER/);
  assert.match(schema, /model LiveFailoverPolicy/);
  assert.match(schema, /model LiveFailoverEvent/);
  assert.match(migration, /LiveFailoverPolicy_distinct_sources_check/);
  assert.match(roadmap, /19\.9 \| Live Failover \| IN DEVELOPMENT/);
});
