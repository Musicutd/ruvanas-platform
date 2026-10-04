import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function waitForRouteMediaLock(db, holderPid, settled, { minimumWaiters = 1, label = "promo status route" } = {}) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const waiters = await db.$queryRaw`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%"MediaAsset"%FOR UPDATE%'
        AND ${holderPid}::integer = ANY(pg_blocking_pids(pid))
        AND pid <> pg_backend_pid()`;
    if (waiters.length >= minimumWaiters) return;
    if (settled()) throw new Error(`The ${label} finished before waiting for the media row lock.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The ${label} did not reach the media row lock.`);
}

test("generic promo writes cannot append, submit or review private Inside audio while ordinary promos remain writable", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 media write integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  let mediaStore;
  let releaseAttachment;
  let releaseReuseMediaLock;
  let releaseSiblingAttachment;
  let releaseStatusSnapshotLock;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 media writes ${suffix}`, code: `C9_MEDIA_WRITES_${suffix}`,
      productFamily: "ONLINE", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      onlineRadioEnabled: true, stationLimit: 1, promoUploadEnabled: true
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 media writes ${suffix}`, slug: `c9-media-writes-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const user = await db.user.create({ data: {
      email: `c9-media-writes-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "OWNER"
    } });
    userId = user.id;
    await db.organisationMember.create({ data: { organisationId, userId, role: "OWNER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional private facility", slug: `c9-media-writes-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional programme", createdByUserId: userId
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional contributor", createdByUserId: userId
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional supervised project", editDecision: {}, createdByUserId: userId
    } });
    const projectVersion = await db.audioProjectVersion.create({ data: {
      projectId: project.id, version: 1, state: {}, createdByUserId: userId
    } });
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facility.id, contributorId: contributor.id,
      programmeId: programme.id, projectId: project.id, supervisorUserId: userId,
      createdByUserId: userId, capabilityScope: { purpose: "CI-only" }
    } });

    const ordinaryBytes = Buffer.from("ID3ordinary-audio");
    const privateBytes = Buffer.from("ID3private-audio");
    async function media(name, bytes) {
      const checksum = createHash("sha256").update(bytes).digest("hex");
      return db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name,
        originalName: `${name}.mp3`,
        storageKey: `organisations/${organisationId}/promos/announcement/${checksum}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: BigInt(bytes.length), durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
    }
    const ordinaryMedia = await media("fictional-ordinary", ordinaryBytes);
    const privateMedia = await media("fictional-private", privateBytes);
    const ordinaryPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional ordinary promo", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: ordinaryMedia.id, version: 1, status: "DRAFT" } }
    }, include: { versions: true } });
    const privatePromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional private promo", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: privateMedia.id, version: 1, status: "DRAFT" } }
    }, include: { versions: true } });
    const mixedPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional mixed promo", mediaType: "ANNOUNCEMENT",
      versions: { create: [
        { mediaAssetId: ordinaryMedia.id, version: 1, status: "APPROVED", qcStatus: "PASSED" },
        { mediaAssetId: privateMedia.id, version: 2, status: "DRAFT" }
      ] }
    }, include: { versions: true } });
    await db.audioRender.create({ data: {
      organisationId, projectId: project.id, versionId: projectVersion.id,
      outputMediaAssetId: privateMedia.id, outputPromoVersionId: privatePromo.versions[0].id,
      requestedByUserId: userId, preset: "SPEECH_MP3", status: "SUCCEEDED"
    } });

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password }), redirect: "manual"
    });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    async function listedPromoIds(path) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { origin: baseUrl, cookie }, redirect: "manual"
      });
      assert.equal(response.status, 200, await response.clone().text());
      return new Set((await response.json()).assets.map((asset) => asset.id));
    }
    function assertOrdinaryOnly(ids) {
      assert.ok(ids.has(ordinaryPromo.id), "ordinary promo stays available");
      assert.ok(!ids.has(privatePromo.id), "private promo is hidden");
      assert.ok(!ids.has(mixedPromo.id), "mixed version history is hidden as a whole");
    }
    assertOrdinaryOnly(await listedPromoIds("/api/admin/media"));
    assertOrdinaryOnly(await listedPromoIds("/api/media/library"));

    async function updateStatus(promoAssetId, status) {
      return fetch(`${baseUrl}/api/admin/promos/${promoAssetId}/status`, {
        method: "PATCH", headers: { origin: baseUrl, cookie, "content-type": "application/json" },
        body: JSON.stringify({ status }), redirect: "manual"
      });
    }
    for (const protectedPromo of [privatePromo, mixedPromo]) {
      for (const status of ["ARCHIVED", "ACTIVE"]) {
        const denied = await updateStatus(protectedPromo.id, status);
        assert.equal(denied.status, 404, await denied.clone().text());
      }
      assert.equal((await db.promoAsset.findUnique({ where: { id: protectedPromo.id } })).status, "ACTIVE");
      assert.equal(await db.auditLog.count({ where: {
        entityType: "PromoAsset", entityId: protectedPromo.id,
        action: { in: ["PROMO_ASSET_ARCHIVED", "PROMO_ASSET_RESTORED"] }
      } }), 0);
    }
    const ordinaryArchive = await updateStatus(ordinaryPromo.id, "ARCHIVED");
    assert.equal(ordinaryArchive.status, 200, await ordinaryArchive.clone().text());
    assert.equal((await db.promoAsset.findUnique({ where: { id: ordinaryPromo.id } })).status, "ARCHIVED");
    const ordinaryRestore = await updateStatus(ordinaryPromo.id, "ACTIVE");
    assert.equal(ordinaryRestore.status, 200, await ordinaryRestore.clone().text());
    assert.equal((await db.promoAsset.findUnique({ where: { id: ordinaryPromo.id } })).status, "ACTIVE");
    assertOrdinaryOnly(await listedPromoIds("/api/admin/media"));

    async function upload(promoAssetId, bytes) {
      const form = new FormData();
      form.set("file", new Blob([bytes], { type: "audio/mpeg" }), "fixture.mp3");
      form.set("organisationId", organisationId);
      form.set("promoAssetId", promoAssetId || "");
      form.set("name", "Fictional upload");
      form.set("mediaType", "ANNOUNCEMENT");
      form.set("languageCode", "en");
      return fetch(`${baseUrl}/api/media/upload`, {
        method: "POST", headers: { origin: baseUrl, cookie }, body: form, redirect: "manual"
      });
    }
    const privateAppend = await upload(privatePromo.id, ordinaryBytes);
    assert.equal(privateAppend.status, 404, await privateAppend.clone().text());
    const mixedAppend = await upload(mixedPromo.id, ordinaryBytes);
    assert.equal(mixedAppend.status, 404, await mixedAppend.clone().text());
    const privateChecksumReuse = await upload(null, privateBytes);
    assert.equal(privateChecksumReuse.status, 403, await privateChecksumReuse.clone().text());
    const privateSubmit = await fetch(`${baseUrl}/api/media/library/${privatePromo.versions[0].id}/submit`, {
      method: "PATCH", headers: { origin: baseUrl, cookie }, redirect: "manual"
    });
    assert.equal(privateSubmit.status, 404, await privateSubmit.clone().text());
    assert.equal((await db.promoVersion.findUnique({ where: { id: privatePromo.versions[0].id } })).status, "DRAFT");
    assert.equal(await db.promoVersion.count({ where: { promoAssetId: privatePromo.id } }), 1);
    assert.equal(await db.promoVersion.count({ where: { promoAssetId: mixedPromo.id } }), 2);

    const ordinaryAppend = await upload(ordinaryPromo.id, ordinaryBytes);
    assert.equal(ordinaryAppend.status, 200, await ordinaryAppend.clone().text());
    const appended = await ordinaryAppend.json();
    assert.equal(appended.version, 2);
    const ordinarySubmit = await fetch(`${baseUrl}/api/media/library/${ordinaryPromo.versions[0].id}/submit`, {
      method: "PATCH", headers: { origin: baseUrl, cookie }, redirect: "manual"
    });
    assert.equal(ordinarySubmit.status, 200, await ordinarySubmit.clone().text());
    assert.equal((await db.promoVersion.findUnique({ where: { id: ordinaryPromo.versions[0].id } })).status, "IN_REVIEW");

    // Exercise the unchanged six-product fresh-upload path as well as the
    // checksum reuse path. CI points R2 at this synthetic local object store.
    const storageMethods = [];
    mediaStore = createServer((request, response) => {
      storageMethods.push(request.method);
      request.resume();
      request.on("end", () => {
        if (request.method === "PUT" && request.headers["x-amz-copy-source"]) {
          response.writeHead(200, { "content-type": "application/xml" });
          response.end("<CopyObjectResult><ETag>\"ci-copy\"</ETag></CopyObjectResult>");
        } else if (request.method === "PUT") {
          response.writeHead(200, { etag: '"ci-put"' });
          response.end();
        } else if (request.method === "DELETE") {
          response.writeHead(204);
          response.end();
        } else {
          response.writeHead(404);
          response.end();
        }
      });
    });
    await new Promise((resolve, reject) => mediaStore.once("error", reject).listen(9107, "127.0.0.1", resolve));
    const freshUpload = await upload(null, Buffer.from("ID3fresh-ordinary-audio"));
    assert.equal(freshUpload.status, 200, await freshUpload.clone().text());
    const freshResult = await freshUpload.json();
    assert.equal((await db.mediaAsset.findUnique({ where: { id: freshResult.id } })).status, "READY");
    assert.ok(storageMethods.filter((method) => method === "PUT").length >= 2);

    // A Corrections render intentionally remains IN_REVIEW for Guard review.
    // Platform promo review must preserve that evidence and still review an
    // ordinary version in the same organisation.
    await db.promoVersion.update({ where: { id: privatePromo.versions[0].id }, data: { status: "IN_REVIEW" } });
    await db.promoVersion.update({ where: { id: appended.promoVersionId }, data: { status: "IN_REVIEW" } });
    await db.user.update({ where: { id: userId }, data: { role: "SUPER_ADMIN" } });
    assertOrdinaryOnly(await listedPromoIds("/api/admin/media"));
    const uploadChoices = await fetch(`${baseUrl}/admin/media/upload?promoAssetId=${ordinaryPromo.id}`, {
      headers: { origin: baseUrl, cookie }, redirect: "manual"
    });
    assert.equal(uploadChoices.status, 200, await uploadChoices.clone().text());
    const uploadHtml = await uploadChoices.text();
    assert.ok(uploadHtml.includes(`<option value="${ordinaryPromo.id}"`), "ordinary promo is an upload choice");
    assert.ok(!uploadHtml.includes(`<option value="${privatePromo.id}"`), "private promo is not an upload choice");
    assert.ok(!uploadHtml.includes(`<option value="${mixedPromo.id}"`), "mixed promo is not an upload choice");
    for (const protectedPromo of [privatePromo, mixedPromo]) {
      const denied = await updateStatus(protectedPromo.id, "ARCHIVED");
      assert.equal(denied.status, 404, await denied.clone().text());
      assert.equal((await db.promoAsset.findUnique({ where: { id: protectedPromo.id } })).status, "ACTIVE");
      assert.equal(await db.auditLog.count({ where: {
        entityType: "PromoAsset", entityId: protectedPromo.id,
        action: { in: ["PROMO_ASSET_ARCHIVED", "PROMO_ASSET_RESTORED"] }
      } }), 0);
    }
    async function review(promoAssetId, promoVersionId, decision, notes = "") {
      return fetch(`${baseUrl}/api/admin/promos/${promoAssetId}/versions/${promoVersionId}/review`, {
        method: "PATCH", headers: { origin: baseUrl, cookie, "content-type": "application/json" },
        body: JSON.stringify({ decision, notes }), redirect: "manual"
      });
    }
    const privateApprove = await review(privatePromo.id, privatePromo.versions[0].id, "APPROVE");
    assert.equal(privateApprove.status, 404, await privateApprove.clone().text());
    const privateReject = await review(privatePromo.id, privatePromo.versions[0].id, "REJECT", "Use Corrections Guard review");
    assert.equal(privateReject.status, 404, await privateReject.clone().text());
    const untouched = await db.promoVersion.findUnique({ where: { id: privatePromo.versions[0].id } });
    assert.equal(untouched.status, "IN_REVIEW");
    assert.equal(untouched.qcStatus, "PENDING");
    assert.equal(untouched.reviewedById, null);
    assert.equal((await db.promoAsset.findUnique({ where: { id: privatePromo.id } })).currentApprovedVersionId, null);
    assert.equal(await db.auditLog.count({ where: { entityType: "PromoVersion", entityId: untouched.id,
      action: { in: ["PROMO_VERSION_APPROVED", "PROMO_VERSION_REJECTED"] } } }), 0);

    const ordinaryReject = await review(ordinaryPromo.id, appended.promoVersionId, "REJECT", "Fictional QC rejection");
    assert.equal(ordinaryReject.status, 200, await ordinaryReject.clone().text());
    assert.equal((await db.promoVersion.findUnique({ where: { id: appended.promoVersionId } })).status, "REJECTED");
    const ordinaryApprove = await review(ordinaryPromo.id, ordinaryPromo.versions[0].id, "APPROVE");
    assert.equal(ordinaryApprove.status, 200, await ordinaryApprove.clone().text());
    assert.equal((await db.promoAsset.findUnique({ where: { id: ordinaryPromo.id } })).currentApprovedVersionId, ordinaryPromo.versions[0].id);

    // Queue archive first and READY-media checksum reuse second behind the
    // same row. The upload must recheck ACTIVE after it gets the media lock;
    // neither request may deadlock or append to the archived parent.
    const reusePromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional checksum reuse race", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: ordinaryMedia.id, version: 1, status: "DRAFT" } }
    } });
    let reuseLockEntered;
    const reuseLockStarted = new Promise((resolve) => { reuseLockEntered = resolve; });
    const reuseLockRelease = new Promise((resolve) => { releaseReuseMediaLock = resolve; });
    const reuseLockHolder = db.$transaction(async (tx) => {
      const [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${ordinaryMedia.id} FOR UPDATE`;
      reuseLockEntered(holderPid);
      await reuseLockRelease;
    }, { timeout: 20_000 });
    const reuseHolderPid = await Promise.race([
      reuseLockStarted,
      reuseLockHolder.then(() => { throw new Error("The reuse fixture finished before holding the media lock."); })
    ]);
    let reuseArchiveSettled = false;
    let reuseUploadSettled = false;
    const reuseArchive = updateStatus(reusePromo.id, "ARCHIVED")
      .finally(() => { reuseArchiveSettled = true; });
    let reuseUpload;
    let reuseLockWaitError = null;
    try {
      await waitForRouteMediaLock(db, reuseHolderPid, () => reuseArchiveSettled);
      reuseUpload = upload(reusePromo.id, ordinaryBytes)
        .finally(() => { reuseUploadSettled = true; });
      await waitForRouteMediaLock(db, reuseHolderPid,
        () => reuseArchiveSettled || reuseUploadSettled,
        { minimumWaiters: 2, label: "archive and reuse upload" });
    } catch (error) {
      reuseLockWaitError = error;
    } finally {
      releaseReuseMediaLock();
      releaseReuseMediaLock = null;
    }
    const [reuseHolderResult, reuseArchiveResult, reuseUploadResult] = await Promise.allSettled([
      reuseLockHolder, reuseArchive, reuseUpload || Promise.resolve(null)
    ]);
    if (reuseHolderResult.status === "rejected") throw reuseHolderResult.reason;
    if (reuseArchiveResult.status === "rejected") throw reuseArchiveResult.reason;
    if (reuseUploadResult.status === "rejected") throw reuseUploadResult.reason;
    if (reuseLockWaitError) throw reuseLockWaitError;
    assert.equal(reuseArchiveResult.value.status, 200, await reuseArchiveResult.value.clone().text());
    assert.equal(reuseUploadResult.value.status, 409, await reuseUploadResult.value.clone().text());
    assert.equal((await db.promoAsset.findUnique({ where: { id: reusePromo.id } })).status, "ARCHIVED");
    assert.equal(await db.promoVersion.count({ where: { promoAssetId: reusePromo.id } }), 1);
    assert.equal(await db.auditLog.count({ where: {
      entityType: "PromoAsset", entityId: reusePromo.id, action: "PROMO_ASSET_ARCHIVED"
    } }), 1);
    const reuseRestore = await updateStatus(reusePromo.id, "ACTIVE");
    assert.equal(reuseRestore.status, 200, await reuseRestore.clone().text());
    const validReuse = await upload(reusePromo.id, ordinaryBytes);
    assert.equal(validReuse.status, 200, await validReuse.clone().text());
    assert.equal(await db.promoVersion.count({ where: { promoAssetId: reusePromo.id } }), 2);

    // Hold the media FK's KEY SHARE lock while the generic archive waits for
    // FOR UPDATE. Commit a direct C5 attachment before the archive rechecks.
    const category = await db.correctionsRehabCategory.create({ data: {
      organisationId, code: `CI_MEDIA_${suffix}`, name: "Fictional education"
    } });

    // The target upload reuses M1, but the parent's older M2 version can
    // become private while the upload waits on that second media row.
    const siblingMedia = await media("fictional-sibling", Buffer.from("ID3sibling-ordinary-audio"));
    const siblingPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional two-version promo", mediaType: "ANNOUNCEMENT",
      versions: { create: [
        { mediaAssetId: ordinaryMedia.id, version: 1, status: "DRAFT" },
        { mediaAssetId: siblingMedia.id, version: 2, status: "DRAFT" }
      ] }
    } });
    let siblingEntered;
    const siblingStarted = new Promise((resolve) => { siblingEntered = resolve; });
    const siblingRelease = new Promise((resolve) => { releaseSiblingAttachment = resolve; });
    const siblingAttachment = db.$transaction(async (tx) => {
      const [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${siblingMedia.id} FOR KEY SHARE`;
      siblingEntered(holderPid);
      await siblingRelease;
      await tx.correctionsRehabContent.create({ data: {
        organisationId, facilityId: facility.id, categoryId: category.id,
        mediaAssetId: siblingMedia.id, title: "Fictional sibling rehabilitation audio",
        providerName: "CI provider", createdByUserId: userId
      } });
    }, { timeout: 20_000 });
    const siblingHolderPid = await Promise.race([
      siblingStarted,
      siblingAttachment.then(() => { throw new Error("The sibling fixture finished before holding its media lock."); })
    ]);
    let siblingUploadSettled = false;
    const siblingUpload = upload(siblingPromo.id, ordinaryBytes)
      .finally(() => { siblingUploadSettled = true; });
    let siblingWaitError = null;
    try {
      await waitForRouteMediaLock(db, siblingHolderPid, () => siblingUploadSettled,
        { label: "two-version promo upload" });
    } catch (error) {
      siblingWaitError = error;
    } finally {
      releaseSiblingAttachment();
      releaseSiblingAttachment = null;
    }
    const [siblingAttachmentResult, siblingUploadResult] = await Promise.allSettled([
      siblingAttachment, siblingUpload
    ]);
    if (siblingAttachmentResult.status === "rejected") throw siblingAttachmentResult.reason;
    if (siblingUploadResult.status === "rejected") throw siblingUploadResult.reason;
    if (siblingWaitError) throw siblingWaitError;
    assert.equal(siblingUploadResult.value.status, 409, await siblingUploadResult.value.clone().text());
    assert.equal(await db.promoVersion.count({ where: { promoAssetId: siblingPromo.id } }), 2);
    assert.equal((await db.promoAsset.findUnique({ where: { id: siblingPromo.id } })).status, "ACTIVE");
    assert.equal(await db.correctionsRehabContent.count({ where: {
      organisationId, mediaAssetId: siblingMedia.id
    } }), 1);

    // The status route enumerates M1 before its lock wait. A new ordinary M2
    // version committed during that wait must invalidate its version snapshot.
    const lateMedia = await media("fictional-late-version", Buffer.from("ID3late-ordinary-audio"));
    const snapshotPromo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional status snapshot race", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: ordinaryMedia.id, version: 1, status: "DRAFT" } }
    } });
    let snapshotLockEntered;
    const snapshotLockStarted = new Promise((resolve) => { snapshotLockEntered = resolve; });
    const snapshotLockRelease = new Promise((resolve) => { releaseStatusSnapshotLock = resolve; });
    const snapshotLockHolder = db.$transaction(async (tx) => {
      const [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${ordinaryMedia.id} FOR KEY SHARE`;
      snapshotLockEntered(holderPid);
      await snapshotLockRelease;
    }, { timeout: 20_000 });
    const snapshotHolderPid = await Promise.race([
      snapshotLockStarted,
      snapshotLockHolder.then(() => { throw new Error("The snapshot fixture finished before holding its media lock."); })
    ]);
    let snapshotArchiveSettled = false;
    const snapshotArchive = updateStatus(snapshotPromo.id, "ARCHIVED")
      .finally(() => { snapshotArchiveSettled = true; });
    let snapshotAppendError = null;
    try {
      await waitForRouteMediaLock(db, snapshotHolderPid, () => snapshotArchiveSettled);
      await db.promoVersion.create({ data: {
        promoAssetId: snapshotPromo.id, mediaAssetId: lateMedia.id,
        version: 2, status: "DRAFT"
      } });
    } catch (error) {
      snapshotAppendError = error;
    } finally {
      releaseStatusSnapshotLock();
      releaseStatusSnapshotLock = null;
    }
    const [snapshotHolderResult, snapshotArchiveResult] = await Promise.allSettled([
      snapshotLockHolder, snapshotArchive
    ]);
    if (snapshotHolderResult.status === "rejected") throw snapshotHolderResult.reason;
    if (snapshotArchiveResult.status === "rejected") throw snapshotArchiveResult.reason;
    if (snapshotAppendError) throw snapshotAppendError;
    assert.equal(snapshotArchiveResult.value.status, 409, await snapshotArchiveResult.value.clone().text());
    assert.equal((await db.promoAsset.findUnique({ where: { id: snapshotPromo.id } })).status, "ACTIVE");
    assert.equal(await db.promoVersion.count({ where: { promoAssetId: snapshotPromo.id } }), 2);
    assert.equal(await db.auditLog.count({ where: {
      entityType: "PromoAsset", entityId: snapshotPromo.id, action: "PROMO_ASSET_ARCHIVED"
    } }), 0);

    let attachmentEntered;
    const attachmentStarted = new Promise((resolve) => { attachmentEntered = resolve; });
    const attachmentRelease = new Promise((resolve) => { releaseAttachment = resolve; });
    const attachment = db.$transaction(async (tx) => {
      const [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${freshResult.id} FOR KEY SHARE`;
      attachmentEntered(holderPid);
      await attachmentRelease;
      await tx.correctionsRehabContent.create({ data: {
        organisationId, facilityId: facility.id, categoryId: category.id,
        mediaAssetId: freshResult.id, title: "Fictional private rehabilitation audio",
        providerName: "CI provider", createdByUserId: userId
      } });
    }, { timeout: 20_000 });
    const holderPid = await Promise.race([
      attachmentStarted,
      attachment.then(() => { throw new Error("The C5 fixture finished before holding the media lock."); })
    ]);
    let archiveSettled = false;
    const racedArchive = updateStatus(freshResult.promoAssetId, "ARCHIVED")
      .finally(() => { archiveSettled = true; });
    let lockWaitError = null;
    try {
      await waitForRouteMediaLock(db, holderPid, () => archiveSettled);
    } catch (error) {
      lockWaitError = error;
    } finally {
      releaseAttachment();
      releaseAttachment = null;
    }
    const [attachmentResult, archiveResult] = await Promise.allSettled([attachment, racedArchive]);
    if (attachmentResult.status === "rejected") throw attachmentResult.reason;
    if (archiveResult.status === "rejected") throw archiveResult.reason;
    const racedResponse = archiveResult.value;
    if (lockWaitError) throw new Error(`${lockWaitError.message} Route status: ${racedResponse.status}.`);
    assert.equal(racedResponse.status, 409, await racedResponse.clone().text());
    assert.equal((await db.promoAsset.findUnique({ where: { id: freshResult.promoAssetId } })).status, "ACTIVE");
    assert.equal(await db.correctionsRehabContent.count({ where: { organisationId, mediaAssetId: freshResult.id } }), 1);
    assert.equal(await db.auditLog.count({ where: {
      entityType: "PromoAsset", entityId: freshResult.promoAssetId, action: "PROMO_ASSET_ARCHIVED"
    } }), 0);
  } finally {
    try {
      releaseReuseMediaLock?.();
      releaseSiblingAttachment?.();
      releaseStatusSnapshotLock?.();
      releaseAttachment?.();
      if (mediaStore) {
        mediaStore.closeAllConnections?.();
        await new Promise((resolve) => mediaStore.close(resolve));
      }
      if (organisationId) {
        await db.correctionsRehabContent.deleteMany({ where: { organisationId } });
        await db.correctionsRehabCategory.deleteMany({ where: { organisationId } });
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.promoAsset.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.auditLog.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
