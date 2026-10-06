import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("Corrections recording inventory retains global references and verifies scoped supervision without exposing private identifiers", async () => {
  if (!ciDatabase) throw new Error("Corrections recording inventory runs only against the exact disposable CI database.");
  const { inventoryCorrectionsRecordingStorage } = await import("../../lib/corrections-recording-storage-inventory.mjs");
  const db = new PrismaClient();
  const suffix = randomUUID();
  const organisations = [];
  const privateMarkers = [];
  const observedAt = new Date("2026-10-05T12:00:00.000Z");
  const oldDate = new Date("2026-09-01T12:00:00.000Z");
  let userId;
  try {
    for (const label of ["local", "foreign"]) {
      organisations.push(await db.organisation.create({ data: {
        name: `Fictional C9 recording inventory ${label} ${suffix}`,
        slug: `c9-recording-inventory-${label}-${suffix}`
      } }));
    }
    const organisationId = organisations[0].id;
    const foreignOrganisationId = organisations[1].id;
    const user = await db.user.create({ data: {
      email: `c9-recording-inventory-${suffix}@example.invalid`,
      passwordHash: "ci-only-unusable", role: "OWNER"
    } });
    userId = user.id;
    privateMarkers.push(userId, user.email);

    async function project(scope, label) {
      const title = `Fictional private recording title ${label} ${suffix}`;
      const row = await db.audioProject.create({ data: {
        organisationId: scope, title, editDecision: {}, createdByUserId: userId
      } });
      privateMarkers.push(row.id, title);
      return row;
    }
    const closedProject = await project(organisationId, "closed");
    const activeProject = await project(organisationId, "expired-active");
    const ordinaryProject = await project(organisationId, "no-supervision");
    const foreignSessionProject = await project(organisationId, "foreign-session-only");
    const malformedSessionProject = await project(organisationId, "foreign-session-relations");
    const foreignActiveProject = await project(organisationId, "foreign-active-session");
    const foreignProject = await project(foreignOrganisationId, "foreign-project");

    const supervisors = new Map();
    for (const scope of [organisationId, foreignOrganisationId]) {
      const facility = await db.location.create({ data: {
        organisationId: scope, name: `Fictional private facility ${suffix}`,
        slug: `c9-recording-inventory-facility-${suffix}`,
        correctionsFacility: { create: {} }
      } });
      const programme = await db.correctionsProgramme.create({ data: {
        organisationId: scope, facilityId: facility.id,
        title: `Fictional private programme ${suffix}`, createdByUserId: userId
      } });
      const contributor = await db.correctionsContributor.create({ data: {
        organisationId: scope, facilityId: facility.id,
        displayName: `Fictional private contributor ${suffix}`, createdByUserId: userId
      } });
      privateMarkers.push(facility.id, facility.name, programme.id, programme.title,
        contributor.id, contributor.displayName);
      supervisors.set(scope, { facility, programme, contributor });
    }
    async function session(scope, projectId, status, relationScope = scope) {
      const { facility, programme, contributor } = supervisors.get(relationScope);
      const row = await db.correctionsStudioSession.create({ data: {
        organisationId: scope, facilityId: facility.id, programmeId: programme.id,
        contributorId: contributor.id, projectId, supervisorUserId: userId,
        createdByUserId: userId, status, capabilityScope: ["RECORD"],
        activatedAt: oldDate, expiresAt: oldDate,
        ...(status === "COMPLETED" ? { completedAt: oldDate } : {})
      } });
      privateMarkers.push(row.id);
      return row;
    }
    await session(organisationId, closedProject.id, "COMPLETED");
    await session(organisationId, activeProject.id, "COMPLETED");
    await session(organisationId, activeProject.id, "ACTIVE");
    // Foreign legacy rows cannot establish scoped supervision. An ACTIVE
    // association remains in progress even when its organisation is malformed.
    await session(foreignOrganisationId, foreignSessionProject.id, "COMPLETED");
    await session(organisationId, malformedSessionProject.id, "COMPLETED", foreignOrganisationId);
    await session(organisationId, foreignActiveProject.id, "COMPLETED");
    await session(foreignOrganisationId, foreignActiveProject.id, "ACTIVE");

    const prefix = `organisations/${organisationId}/corrections-studio/`;
    const recordingKey = (projectId) => `${prefix}${projectId}/${randomUUID()}.wav`;
    const keys = {
      deletedMedia: recordingKey(closedProject.id),
      archivedSignage: recordingKey(closedProject.id),
      productionFile: recordingKey(closedProject.id),
      failedUpload: recordingKey(closedProject.id),
      missingProject: recordingKey(`missing-${randomUUID()}`),
      foreignProject: recordingKey(foreignProject.id),
      activeSession: recordingKey(activeProject.id),
      noSupervision: recordingKey(ordinaryProject.id),
      foreignSessionOnly: recordingKey(foreignSessionProject.id),
      foreignSessionRelations: recordingKey(malformedSessionProject.id),
      foreignActiveSession: recordingKey(foreignActiveProject.id),
      closedUnreferenced: recordingKey(closedProject.id)
    };
    privateMarkers.push(...Object.values(keys), foreignOrganisationId);
    const originalName = `fictional-private-audio-${suffix}.wav`;
    const checksumSha256 = "a".repeat(64);
    privateMarkers.push(originalName);

    const media = await db.mediaAsset.create({ data: {
      organisationId: foreignOrganisationId, libraryType: "ORGANISATION_PROMO",
      name: `Fictional private audio ${suffix}`, originalName, storageKey: keys.deletedMedia,
      mimeType: "audio/wav", sizeBytes: 128n, durationSeconds: 1,
      mediaType: "ANNOUNCEMENT", status: "DELETED"
    } });
    privateMarkers.push(media.id, media.name);
    await db.digitalSignageAsset.create({ data: {
      organisationId: foreignOrganisationId, name: `Fictional private signage ${suffix}`,
      status: "ARCHIVED", originalName, storageKey: keys.archivedSignage,
      mimeType: "image/png", sizeBytes: 128n, checksumSha256,
      width: 1, height: 1, uploadedByUserId: userId
    } });
    const order = await db.productionOrder.create({ data: {
      organisationId: foreignOrganisationId, createdByUserId: userId,
      title: `Fictional private production ${suffix}`, promotionDetails: "CI-only fixture",
      languageCodes: ["en"], contactName: "Fictional contact",
      contactEmail: `c9-production-${suffix}@example.invalid`, fundingType: "PLAN_INCLUDED"
    } });
    await db.productionOrderFile.create({ data: {
      organisationId: foreignOrganisationId, orderId: order.id, uploadedByUserId: userId,
      kind: "FINAL_MASTER", originalName, storageKey: keys.productionFile,
      mimeType: "audio/wav", sizeBytes: 128n, checksumSha256
    } });
    await db.schoolAudioUploadSession.create({ data: {
      organisationId: foreignOrganisationId, projectId: foreignProject.id,
      createdByUserId: userId, status: "FAILED", originalName, mimeType: "audio/wav",
      expectedSizeBytes: 128n, partSizeBytes: 128, partCount: 1,
      quarantineKey: keys.failedUpload, multipartUploadId: `ci-only-${randomUUID()}`,
      expiresAt: oldDate
    } });

    const listedKeys = Object.values(keys);
    const projectIds = [...new Set(listedKeys.map((key) => key.slice(prefix.length).split("/")[0]))].sort();
    const queries = [];
    const projectQueries = [];
    function read(model, method, validate) {
      return async (args) => {
        validate(args);
        queries.push(`${model}.${method}`);
        return db[model][method](args);
      };
    }
    function globalReference(model, field) {
      return { findMany: read(model, "findMany", (args) => {
        assert.deepEqual(args, { where: { [field]: { in: listedKeys } }, select: { [field]: true } },
          `${model} references must be exact-key, global, and include every status`);
      }) };
    }
    // The inventory can access only these reads; all fixture writes use db.
    const database = {
      organisation: { findUnique: read("organisation", "findUnique", (args) => {
        assert.deepEqual(args, { where: { id: organisationId }, select: { id: true } });
      }) },
      mediaAsset: globalReference("mediaAsset", "storageKey"),
      digitalSignageAsset: globalReference("digitalSignageAsset", "storageKey"),
      productionOrderFile: globalReference("productionOrderFile", "storageKey"),
      schoolAudioUploadSession: globalReference("schoolAudioUploadSession", "quarantineKey"),
      audioProject: { findMany: read("audioProject", "findMany", (args) => {
        assert.deepEqual(Object.keys(args).sort(), ["select", "where"]);
        assert.equal(args.where.organisationId, organisationId);
        assert.deepEqual([...args.where.id.in].sort(), projectIds);
        assert.deepEqual(args.select, { id: true });
        const some = args.where.correctionsStudioSessions?.some;
        if (!some) {
          assert.deepEqual(Object.keys(args.where).sort(), ["id", "organisationId"]);
          projectQueries.push("existing");
        } else {
          assert.deepEqual(Object.keys(args.where).sort(), ["correctionsStudioSessions", "id", "organisationId"]);
          assert.deepEqual(Object.keys(args.where.correctionsStudioSessions), ["some"]);
          if (some.status === "ACTIVE") {
            assert.deepEqual(some, { status: "ACTIVE" });
            projectQueries.push("active");
          } else {
            assert.deepEqual(some, {
              organisationId, facility: { organisationId }, programme: { organisationId },
              contributor: { organisationId }
            });
            projectQueries.push("supervised");
          }
        }
      }) }
    };
    const storageCalls = [];
    const storage = { bucketName: "CI-only-no-network", client: { send: async (command) => {
      storageCalls.push(command);
      if (command instanceof ListObjectsV2Command) {
        assert.deepEqual(command.input, {
          Bucket: storage.bucketName, Prefix: prefix, MaxKeys: 100
        });
        return { IsTruncated: false, Contents: listedKeys.map((Key) => ({
          Key, ETag: '"ci-inventory"', Size: 128, LastModified: oldDate
        })) };
      }
      assert.ok(command instanceof HeadObjectCommand, "inventory must issue only LIST and HEAD requests");
      assert.deepEqual(command.input, { Bucket: storage.bucketName, Key: keys.closedUnreferenced });
      return { ETag: '"ci-inventory"', ContentLength: 128, LastModified: oldDate,
        Metadata: { source: "corrections-supervised-studio", project: closedProject.id,
          checksum: checksumSha256 } };
    } } };

    const report = await inventoryCorrectionsRecordingStorage({
      database, storage, organisationId, now: observedAt
    });
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.kind, "CORRECTIONS_RECORDING_STORAGE");
    assert.equal(report.organisationId, organisationId);
    assert.equal(report.readOnly, true);
    assert.equal(report.coverage, "BOUNDED_PAGE_ONLY");
    assert.equal(report.disposalCandidates, false);
    assert.equal(report.page.hasMore, false);
    assert.equal(report.page.nextCursor, null);
    assert.equal(report.page.items.length, listedKeys.length);
    const classifications = new Map(report.page.items.map((item) => [item.keyFingerprint, item.classification]));
    for (const key of [keys.deletedMedia, keys.archivedSignage, keys.productionFile, keys.failedUpload]) {
      assert.equal(classifications.get(fingerprint(key)), "REFERENCED_DB");
    }
    for (const key of [keys.missingProject, keys.foreignProject]) {
      assert.equal(classifications.get(fingerprint(key)), "MISSING_OR_OUT_OF_SCOPE_PROJECT_REVIEW");
    }
    for (const key of [keys.noSupervision, keys.foreignSessionOnly, keys.foreignSessionRelations]) {
      assert.equal(classifications.get(fingerprint(key)), "PROJECT_CONTEXT_UNVERIFIED");
    }
    for (const key of [keys.activeSession, keys.foreignActiveSession]) {
      assert.equal(classifications.get(fingerprint(key)), "SESSION_IN_PROGRESS_REVIEW");
    }
    assert.equal(classifications.get(fingerprint(keys.closedUnreferenced)), "NO_DATABASE_REFERENCE_OBSERVED_REVIEW");
    for (const item of report.page.items) {
      assert.match(item.keyFingerprint, /^[0-9a-f]{64}$/);
      assert.match(item.projectFingerprint, /^[0-9a-f]{64}$/);
      assert.equal("projectId" in item, false);
      assert.equal("storageKey" in item, false);
    }
    assert.equal(report.page.counts.REFERENCED_DB, 4);
    assert.equal(report.page.counts.MISSING_OR_OUT_OF_SCOPE_PROJECT_REVIEW, 2);
    assert.equal(report.page.counts.PROJECT_CONTEXT_UNVERIFIED, 3);
    assert.equal(report.page.counts.SESSION_IN_PROGRESS_REVIEW, 2);
    assert.equal(report.page.counts.NO_DATABASE_REFERENCE_OBSERVED_REVIEW, 1);
    assert.equal(storageCalls.filter((command) => command instanceof ListObjectsV2Command).length, 1);
    assert.equal(storageCalls.filter((command) => command instanceof HeadObjectCommand).length, 1);
    assert.equal(queries.length, 8);
    assert.deepEqual(projectQueries.sort(), ["active", "existing", "supervised"]);
    const serialized = JSON.stringify(report);
    for (const marker of privateMarkers) {
      assert.equal(serialized.includes(marker), false, "inventory must exclude private content and raw identifiers");
    }
    assert.equal(await db.mediaAsset.count({ where: { id: media.id, status: "DELETED" } }), 1);
    assert.equal(await db.correctionsStudioSession.count({ where: { organisationId, status: "ACTIVE" } }), 1);
  } finally {
    try {
      if (organisations.length) {
        const where = { organisationId: { in: organisations.map(({ id }) => id) } };
        await db.correctionsStudioSession.deleteMany({ where });
        await db.schoolAudioUploadSession.deleteMany({ where });
        await db.digitalSignageAsset.deleteMany({ where });
        await db.productionOrderFile.deleteMany({ where });
        await db.productionOrder.deleteMany({ where });
        await db.mediaAsset.deleteMany({ where });
        await db.audioProject.deleteMany({ where });
        await db.correctionsContributor.deleteMany({ where });
        await db.correctionsProgramme.deleteMany({ where });
        await db.location.deleteMany({ where });
        await db.organisation.deleteMany({ where: { id: { in: organisations.map(({ id }) => id) } } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  }
});
