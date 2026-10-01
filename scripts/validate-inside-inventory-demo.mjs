import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { countCorrectionsPrivacyInventory } from "../lib/corrections-privacy-inventory.mjs";

class ExpectedRollback extends Error {}

const countedFields = [
  "contributors", "supervisedSessions", "supervisedStudioProjects",
  "supervisedStudioVersions", "supervisedStudioTakes",
  "supervisedStudioRenders", "studioLinkedMediaAssets"
];

async function createFictionalStudioEvidence(tx, { organisationId, ownerId, marker }) {
  const facility = await tx.location.create({ data: {
    organisationId, name: "Fictional inventory test facility", slug: marker,
    status: "ACTIVE", countryCode: "MT",
    correctionsFacility: { create: { policyConfiguredAt: new Date() } }
  } });
  const programme = await tx.correctionsProgramme.create({ data: {
    organisationId, facilityId: facility.id, title: "Fictional inventory test programme",
    createdByUserId: ownerId
  } });
  const contributor = await tx.correctionsContributor.create({ data: {
    organisationId, facilityId: facility.id, displayName: "Fictional inventory contributor",
    createdByUserId: ownerId
  } });
  const project = await tx.audioProject.create({ data: {
    organisationId, title: "Fictional inventory test project", editDecision: {},
    createdByUserId: ownerId
  } });
  const version = await tx.audioProjectVersion.create({ data: {
    projectId: project.id, version: 1, state: { fictionalInventoryProbe: true },
    createdByUserId: ownerId
  } });
  const media = await tx.mediaAsset.create({ data: {
    organisationId, name: "Fictional inventory test audio", originalName: "fictional-test.wav",
    storageKey: `inside-inventory-probe/${marker}/${organisationId}`, mimeType: "audio/wav",
    sizeBytes: 1024n, mediaType: "VOICEOVER", status: "READY"
  } });
  await tx.audioTake.create({ data: {
    organisationId, projectId: project.id, mediaAssetId: media.id,
    recordedByUserId: ownerId, durationMs: 1000, status: "READY",
    sourceEditDecision: {}
  } });
  await tx.audioRender.create({ data: {
    organisationId, projectId: project.id, versionId: version.id,
    outputMediaAssetId: media.id, requestedByUserId: ownerId,
    preset: "SPEECH_MP3", status: "SUCCEEDED"
  } });
  const track = await tx.audioTrack.create({ data: { projectId: project.id, name: "Voice" } });
  await tx.audioClip.create({ data: {
    trackId: track.id, mediaAssetId: media.id, sourceEndMs: 1000
  } });
  await tx.correctionsStudioSession.create({ data: {
    organisationId, facilityId: facility.id, contributorId: contributor.id,
    programmeId: programme.id, projectId: project.id,
    supervisorUserId: ownerId, createdByUserId: ownerId,
    capabilityScope: []
  } });
}

// Called only after seed-inside-demo's exact service/database guard. The
// transaction always rolls back, even when the assertions pass.
export async function validateInsideInventoryDemo(database, { organisationId, ownerId }) {
  const marker = `inventory-probe-${randomUUID()}`;
  try {
    await database.$transaction(async (tx) => {
      const before = await countCorrectionsPrivacyInventory(tx, organisationId);
      const other = await tx.organisation.create({ data: {
        name: "Fictional second inventory authority", slug: marker
      } });
      await tx.organisationMember.create({ data: {
        userId: ownerId, organisationId: other.id, role: "OWNER"
      } });
      await createFictionalStudioEvidence(tx, { organisationId, ownerId, marker });
      await createFictionalStudioEvidence(tx, { organisationId: other.id, ownerId, marker });

      const [first, second] = await Promise.all([
        countCorrectionsPrivacyInventory(tx, organisationId),
        countCorrectionsPrivacyInventory(tx, other.id)
      ]);
      for (const field of countedFields) {
        assert.equal(first[field], before[field] + 1, `${field} must count the first organisation only`);
        assert.equal(second[field], 1, `${field} must count the second organisation only`);
      }
      for (const value of [...Object.values(first), ...Object.values(second)]) {
        assert.ok(Number.isSafeInteger(value) && value >= 0, "Inventory must reveal counts only");
      }
      throw new ExpectedRollback("Fictional inventory check complete; discard all test rows.");
    }, { maxWait: 20_000, timeout: 90_000 });
    throw new Error("The fictional inventory transaction did not roll back.");
  } catch (error) {
    if (!(error instanceof ExpectedRollback)) throw error;
  }
  const persisted = await database.organisation.findUnique({ where: { slug: marker }, select: { id: true } });
  assert.equal(persisted, null, "Fictional test organisation must not persist");
  console.log(JSON.stringify({ event: "inside_demo_inventory_validation_passed", organisations: 2,
    checkedCountFields: countedFields.length, fictionalRowsRolledBack: true }));
}
