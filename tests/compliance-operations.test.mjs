import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSupportTransition,
  auditExportSealHash,
  auditLogCsv,
  dataRequestCompletion,
  generateOperationalReference,
  normalizeDataRequest,
  normalizeRetentionPolicy,
  redactAuditDetails,
  retentionCutoffs
} from "../lib/compliance-operations.mjs";

test("retention policies are bounded and produce deterministic UTC cutoffs", () => {
  const policy = normalizeRetentionPolicy({ rawPlaybackDays: 30, auditDays: 365 });
  assert.equal(policy.rawPlaybackDays, 30);
  assert.equal(policy.playerHeartbeatDays, 90);
  assert.equal(policy.auditDays, 365);
  assert.equal(retentionCutoffs(policy, new Date("2026-08-28T12:00:00.000Z")).rawPlaybackDays, "2026-07-29T12:00:00.000Z");
  assert.throws(() => normalizeRetentionPolicy({ auditDays: 30 }), /between 365 and 3650/);
});

test("data requests require a subject and track terminal completion", () => {
  const request = normalizeDataRequest({ type: "export", subjectEmail: " PERSON@Example.com " }, new Date("2026-08-28T00:00:00.000Z"));
  assert.equal(request.type, "EXPORT");
  assert.equal(request.subjectEmail, "person@example.com");
  assert.equal(request.dueAt.toISOString(), "2026-09-27T00:00:00.000Z");
  assert.throws(() => normalizeDataRequest({ type: "DELETION" }), /subject/);
  assert.equal(dataRequestCompletion("COMPLETED", "user-1", new Date("2026-09-01T00:00:00.000Z")).completedByUserId, "user-1");
  assert.equal(dataRequestCompletion("IN_REVIEW", "user-1").completedAt, null);
});

test("support tickets use explicit, reversible operational transitions", () => {
  assert.equal(assertSupportTransition("OPEN", "IN_PROGRESS"), "IN_PROGRESS");
  assert.equal(assertSupportTransition("CLOSED", "OPEN"), "OPEN");
  assert.throws(() => assertSupportTransition("CLOSED", "RESOLVED"), /cannot move/);
});

test("operational references are non-secret and date scoped", () => {
  const reference = generateOperationalReference("DR", new Date("2026-08-28T00:00:00.000Z"), () => Buffer.from("01020304", "hex"));
  assert.equal(reference, "DR-20260828-01020304");
});

test("audit exports redact secrets and neutralize spreadsheet formulas", () => {
  const redacted = redactAuditDetails({ password: "never", nested: { apiKey: "never", safe: "yes" } });
  assert.deepEqual(redacted, { password: "[REDACTED]", nested: { apiKey: "[REDACTED]", safe: "yes" } });
  const csv = auditLogCsv([{ createdAt: "2026-08-28T00:00:00.000Z", action: "=DANGEROUS", entityType: "User", entityId: "u1", actorUserId: "admin", details: { token: "secret", requestId: "req-1" } }]);
  assert.match(csv, /'\=DANGEROUS/);
  assert.doesNotMatch(csv, /secret/);
  assert.match(csv, /\[REDACTED\]/);
});

test("audit export seals chain content and scope deterministically", () => {
  const input = { organisationId: "org-1", exportJobId: "job-1", contentSha256: "a".repeat(64), rowCount: 2, fromAt: "2026-08-01T00:00:00.000Z", untilAt: "2026-09-01T00:00:00.000Z" };
  const first = auditExportSealHash(input);
  const second = auditExportSealHash({ ...input, exportJobId: "job-2", previousSealHash: first });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(first, auditExportSealHash(input));
});

