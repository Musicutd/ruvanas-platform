import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { countCorrectionsPrivacyInventory } from "../lib/corrections-privacy-inventory.mjs";

class ExpectedRollback extends Error {}

const expectedDeltas = {
  contributors: 1, supervisedSessions: 1, supervisedStudioProjects: 1,
  supervisedStudioVersions: 1, supervisedStudioTakes: 1,
  supervisedStudioTracks: 1, supervisedStudioClips: 1, supervisedStudioMarkers: 1,
  supervisedStudioRenders: 1, supervisedStudioTranscripts: 1, studioLinkedMediaAssets: 1,
  submittedVersions: 1, reviews: 1,
  familyRequests: 1, internalRequests: 1, requestDecisions: 1,
  developmentMilestones: 1, rehabilitationContent: 1,
  announcements: 1, priorityOverrides: 1,
  insidePlaybackProofEvents: 2, insideCompletedProofEvents: 1,
  correctionsAuditEvents: 1
};

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
  const render = await tx.audioRender.create({ data: {
    organisationId, projectId: project.id, versionId: version.id,
    outputMediaAssetId: media.id, requestedByUserId: ownerId,
    preset: "SPEECH_MP3", status: "SUCCEEDED"
  } });
  const track = await tx.audioTrack.create({ data: { projectId: project.id, name: "Voice" } });
  await tx.audioClip.create({ data: {
    trackId: track.id, mediaAssetId: media.id, sourceEndMs: 1000
  } });
  await tx.audioMarker.create({ data: {
    projectId: project.id, positionMs: 500, type: "EDIT_NOTE",
    label: "Fictional edit marker", createdByUserId: ownerId
  } });
  await tx.transcript.create({ data: {
    organisationId, projectId: project.id, segmentsJson: [],
    source: "MANUAL"
  } });
  const session = await tx.correctionsStudioSession.create({ data: {
    organisationId, facilityId: facility.id, contributorId: contributor.id,
    programmeId: programme.id, projectId: project.id,
    supervisorUserId: ownerId, createdByUserId: ownerId,
    capabilityScope: []
  } });
  return { organisationId, ownerId, marker, facility, programme, contributor,
    project, version, media, render, session };
}

async function createFictionalInventoryEvidence(tx, context) {
  const { organisationId, ownerId, marker, facility, programme, contributor,
    project, version, media, render, session } = context;
  const submission = await tx.correctionsSubmission.create({ data: {
    programmeId: programme.id, organisationId, facilityId: facility.id,
    revision: 1, renderId: render.id, sourceFingerprint: `fictional-${marker}`,
    organisationPolicyVersion: 1, facilityPolicyVersion: 1,
    titleSnapshot: "Fictional submitted version", evidenceSnapshot: {},
    submittedByUserId: ownerId, contributorId: contributor.id,
    studioSessionId: session.id, studioProjectId: project.id,
    studioVersionId: version.id
  } });
  await tx.correctionsReview.create({ data: {
    submissionId: submission.id, stage: "STAFF", decision: "CHANGES_REQUESTED",
    note: "Fictional review only", evidenceSnapshot: {}, reviewedByUserId: ownerId
  } });
  await tx.correctionsRequest.create({ data: {
    organisationId, facilityId: facility.id, source: "FAMILY", type: "SONG",
    songTitle: "Fictional request"
  } });
  const internalRequest = await tx.correctionsRequest.create({ data: {
    organisationId, facilityId: facility.id, source: "INTERNAL", type: "PROGRAMME",
    programmeId: programme.id, createdByUserId: ownerId
  } });
  await tx.correctionsRequestDecision.create({ data: {
    requestId: internalRequest.id, organisationId, facilityId: facility.id,
    action: "SCREEN", fromStatus: "RECEIVED", toStatus: "SCREENING",
    moderatorUserId: ownerId
  } });
  const module = await tx.correctionsDevelopmentModule.create({ data: {
    organisationId, code: marker, title: "Fictional development module", position: 1
  } });
  await tx.correctionsContributorMilestone.create({ data: {
    contributorId: contributor.id, moduleId: module.id, status: "IN_PROGRESS"
  } });
  const category = await tx.correctionsRehabCategory.create({ data: {
    organisationId, code: marker, name: "Fictional rehabilitation category"
  } });
  await tx.correctionsRehabContent.create({ data: {
    organisationId, facilityId: facility.id, categoryId: category.id,
    mediaAssetId: media.id, title: "Fictional rehabilitation draft",
    providerName: "Fictional provider", createdByUserId: ownerId
  } });
  const promoAsset = await tx.promoAsset.create({ data: {
    organisationId, name: "Fictional announcement asset", mediaType: "ANNOUNCEMENT"
  } });
  const promoVersion = await tx.promoVersion.create({ data: {
    promoAssetId: promoAsset.id, mediaAssetId: media.id, version: 1
  } });
  const announcement = await tx.correctionsAnnouncement.create({ data: {
    organisationId, facilityId: facility.id, title: "Fictional announcement draft",
    mediaAssetId: media.id, promoVersionId: promoVersion.id, createdByUserId: ownerId
  } });
  const zone = await tx.zone.create({ data: {
    locationId: facility.id, name: "Fictional inventory zone", slug: marker
  } });
  const player = await tx.player.create({ data: {
    organisationId, zoneId: zone.id, name: "Fictional unconnected player"
  } });
  const trackMedia = await tx.mediaAsset.create({ data: {
    organisationId, name: "Fictional inventory music", originalName: "fictional-music.wav",
    storageKey: `inside-inventory-probe/${marker}/${organisationId}/music`, mimeType: "audio/wav",
    sizeBytes: 1024n, mediaType: "MUSIC", status: "READY"
  } });
  const track = await tx.track.create({ data: {
    mediaAssetId: trackMedia.id, title: "Fictional music", artist: "Fictional artist"
  } });
  await tx.correctionsOverride.create({ data: {
    organisationId, facilityId: facility.id, announcementId: announcement.id,
    type: "PRIORITY", status: "CLEARED", category: "fictional-probe",
    targetZoneIds: [zone.id], targetPlayerIds: [player.id], idempotencyKey: marker,
    initiatedByUserId: ownerId, expiresAt: new Date(Date.now() + 60_000),
    endedAt: new Date(), endedByUserId: ownerId
  } });
  for (const [kind, eventType, programmingSource] of [
    ["started", "STARTED", "CORRECTIONS_PROGRAMME"],
    ["completed", "COMPLETED", "CORRECTIONS_PROGRAMME"],
    ["unrelated", "COMPLETED", "RETAIL"]
  ]) {
    await tx.proofOfPlayEvent.create({ data: {
      clientEventId: `${marker}-${organisationId}-${kind}`, organisationId,
      playerId: player.id, zoneId: zone.id, scheduleItemId: `fictional-${marker}`,
      mediaAssetId: trackMedia.id, trackId: track.id,
      manifestVersion: randomUUID().replaceAll("-", "").slice(0, 24),
      programmingSource, eventType, occurredAt: new Date(),
      playerName: player.name, locationName: facility.name, zoneName: zone.name,
      trackTitle: "Fictional audio", trackArtist: "Fictional artist"
    } });
  }
  for (const action of ["CORRECTIONS_INVENTORY_PROBE", "STUDIO_INVENTORY_PROBE"]) {
    await tx.auditLog.create({ data: {
      organisationId, actorUserId: ownerId, action,
      entityType: "FictionalInventoryProbe"
    } });
  }
}

// Called only after seed-inside-demo's exact service/database guard. The
// transaction always rolls back, even when the assertions pass.
export async function validateInsideInventoryDemo(database, { organisationId, ownerId }) {
  const marker = `inventory-probe-${randomUUID()}`;
  let before;
  try {
    await database.$transaction(async (tx) => {
      before = await countCorrectionsPrivacyInventory(tx, organisationId);
      const other = await tx.organisation.create({ data: {
        name: "Fictional second inventory authority", slug: marker
      } });
      await tx.organisationMember.create({ data: {
        userId: ownerId, organisationId: other.id, role: "OWNER"
      } });
      for (const id of [organisationId, other.id]) {
        const context = await createFictionalStudioEvidence(tx, { organisationId: id, ownerId, marker });
        await createFictionalInventoryEvidence(tx, context);
      }

      const [first, second] = await Promise.all([
        countCorrectionsPrivacyInventory(tx, organisationId),
        countCorrectionsPrivacyInventory(tx, other.id)
      ]);
      for (const counts of [first, second]) {
        assert.deepEqual(Object.keys(counts), Object.keys(expectedDeltas), "Inventory must return only known count fields");
      }
      for (const [field, delta] of Object.entries(expectedDeltas)) {
        assert.equal(first[field], before[field] + delta, `${field} must count the first organisation only`);
        assert.equal(second[field], delta, `${field} must count the second organisation only`);
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
  assert.deepEqual(await countCorrectionsPrivacyInventory(database, organisationId), before,
    "Fictional first-organisation records must not persist");
  console.log(JSON.stringify({ event: "inside_demo_inventory_validation_passed", organisations: 2,
    checkedCountFields: Object.keys(expectedDeltas).length, fictionalRowsRolledBack: true }));
}
