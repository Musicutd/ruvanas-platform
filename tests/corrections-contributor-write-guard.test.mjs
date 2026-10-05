import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("supervised contributor writes recheck the current session and mutable facility authority", async () => {
  const service = await source("lib/corrections-studio-service.js");
  const guard = service.slice(service.indexOf("export async function assertCurrentCorrectionsContributorWrite"),
    service.indexOf("export function safeCorrectionsStudioSession"));
  assert.match(guard, /"CorrectionsStudioSession" WHERE "id" = \$\{expected\.id\} FOR UPDATE/);
  for (const table of ["CorrectionsContributor", "CorrectionsProgramme", "Location", "CorrectionsFacility", "OrganisationMember", "CorrectionsFacilityGrant", "Subscription", "Plan", "BillingContract"]) {
    assert.match(guard, new RegExp(`FROM "${table}"`));
  }
  assert.match(guard, /correctionsStudioSessionAvailable\(session\)/);
  assert.match(guard, /correctionsStudioCan\(session, capability\)/);
  assert.match(guard, /correctionsStudioSupervisorAllowed\(/);
  assert.match(guard, /resolveEntitlements\(subscription\)/);
});

test("recording, waveform, and multitrack saves use the transaction-time guard and current limits", async () => {
  const [recordings, waveform, multitrack] = await Promise.all([
    source("app/api/corrections/contributor/recordings/route.js"),
    source("app/api/corrections/contributor/audio-lab/projects/[projectId]/editor/route.js"),
    source("app/api/corrections/contributor/multitrack/projects/[projectId]/route.js")
  ]);
  for (const route of [recordings, waveform, multitrack]) {
    assert.match(route, /runSerializableTransaction\(prisma, async \(tx\) => \{[\s\S]*?assertCurrentCorrectionsContributorWrite\(tx, access/);
  }
  assert.match(recordings, /assertCurrentCorrectionsContributorWrite\(tx, access, "RECORD"\)/);
  assert.match(recordings, /tx\.mediaAsset\.aggregate\([\s\S]*?entitlements\.storageLimitGb/);
  assert.match(waveform, /renderAction \? \["EDIT", "RENDER"\] : "EDIT"/);
  assert.match(waveform, /assertStudioWaveformWriteAllowed\(state, entitlements\)/);
  assert.match(multitrack, /\{ requirePro: true \}/);
  assert.match(multitrack, /assertStudioMultitrackWriteAllowed\(parsed\.data\.state, entitlements\)/);
});
