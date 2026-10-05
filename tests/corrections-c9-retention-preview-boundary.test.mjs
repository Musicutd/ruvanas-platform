import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = await readFile(new URL("../lib/compliance-service.js", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/admin/compliance/route.js", import.meta.url), "utf8");
const control = await readFile(new URL("../app/admin/compliance/ComplianceOperations.js", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("generic retention refuses Inside evidence before writing any preview job", () => {
  const preview = service.slice(service.indexOf("export async function createRetentionPreview"));
  assert.match(preview, /database\.\$transaction\(async \(tx\) =>/);
  assert.match(preview, /"Organisation"[^\n]+FOR UPDATE[\s\S]*"Subscription"[^\n]+FOR UPDATE/);
  assert.match(preview, /hasCorrectionsEvidence\(database, initial\)/);
  const countsAt = preview.indexOf("database.proofOfPlayEvent.count");
  const transactionAt = preview.indexOf("return database.$transaction");
  const lockAt = preview.indexOf("FOR UPDATE");
  const finalCheckAt = preview.indexOf("hasCorrectionsEvidence(tx, organisation)");
  const jobAt = preview.indexOf("retentionJob.create");
  assert.ok(countsAt > 0 && countsAt < transactionAt, "age counts must not hold the parent lock");
  assert.ok(transactionAt < lockAt && lockAt < finalCheckAt && finalCheckAt < jobAt,
    "only the locked evidence recheck may permit a preview job");
  assert.match(preview, /isolationLevel: "ReadCommitted"/);
  assert.match(route, /CORRECTIONS_RETENTION_PREVIEW_BLOCKED[\s\S]*status: 409/);
});

test("Super Admin sees age-based-only caveat and the new disposable DB test runs in CI", () => {
  assert.match(control, /Older previews may include Inside records/);
  assert.match(control, /not approved deletion candidates/);
  assert.match(workflow, /Validate generic retention preview rejects Inside evidence and lock races[\s\S]*node --test tests\/integration\/corrections-c9-retention-preview-boundary\.test\.mjs/);
});
