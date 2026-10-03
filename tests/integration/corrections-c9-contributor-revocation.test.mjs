import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas" &&
  process.env.R2_ENDPOINT === "http://127.0.0.1:9107";

function syntheticWav() {
  const pcmBytes = 8_000 * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24);
  wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcmBytes, 40);
  return wav;
}

test("a facility grant revoked during a contributor upload prevents the take from being committed", async () => {
  if (!ciDatabase) throw new Error("Contributor revocation integration runs only against the exact disposable CI database and media store.");
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId;
  let userId;
  let planId;
  let store;
  let releasePut;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 revoke ${suffix}`, code: `C9_REVOKE_${suffix}`,
      productFamily: "CORRECTIONS", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      correctionsRadioEnabled: true, stationLimit: 1
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 revocation ${suffix}`, slug: `c9-revocation-${suffix}`
    } });
    organisationId = organisation.id;
    const user = await db.user.create({ data: { email: `c9-revocation-${suffix}@example.invalid`, passwordHash: "ci-only-unusable", role: "OWNER" } });
    userId = user.id;
    const member = await db.organisationMember.create({ data: { organisationId, userId, role: "MANAGER" } });
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional revocation facility", slug: `c9-revocation-facility-${suffix}`,
      correctionsFacility: { create: {} }
    } });
    const grant = await db.correctionsFacilityGrant.create({ data: {
      organisationId, organisationMemberId: member.id, facilityId: facility.id,
      permission: "MANAGER", createdByUserId: userId
    } });
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional supervised programme", createdByUserId: userId
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional contributor", createdByUserId: userId
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional recording project", editDecision: {}, createdByUserId: userId
    } });
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facility.id, contributorId: contributor.id,
      programmeId: programme.id, projectId: project.id, supervisorUserId: userId,
      createdByUserId: userId, status: "ACTIVE", accessTokenHash: tokenHash,
      capabilityScope: ["RECORD", "EDIT", "RENDER", "SUBMIT"],
      activatedAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 60 * 60_000)
    } });

    let putStarted;
    const putSeen = new Promise((resolve) => { putStarted = resolve; });
    const storageMethods = [];
    store = createServer((request, response) => {
      storageMethods.push(request.method);
      request.resume();
      request.on("end", () => {
        if (request.method === "PUT") {
          releasePut = () => { response.writeHead(200, { etag: '"ci-put"' }); response.end(); };
          putStarted();
        } else if (request.method === "DELETE") {
          response.writeHead(204);
          response.end();
        } else {
          response.writeHead(404);
          response.end();
        }
      });
    });
    await new Promise((resolve, reject) => store.once("error", reject).listen(9107, "127.0.0.1", resolve));

    const form = new FormData();
    form.set("recording", new Blob([syntheticWav()], { type: "audio/wav" }), "fictional-take.wav");
    form.set("durationMs", "1000");
    const cookie = `ruvanas_inside_studio=${token}`;
    const pending = fetch(`${baseUrl}/api/corrections/contributor/recordings`, {
      method: "POST", headers: { origin: baseUrl, cookie }, body: form, redirect: "manual"
    });
    let putTimeout;
    try {
      await Promise.race([putSeen, new Promise((_, reject) => {
        putTimeout = setTimeout(() => reject(new Error("The CI media upload did not start.")), 10_000);
      })]);
    } finally {
      clearTimeout(putTimeout);
    }
    // The first cookie/entitlement check and storage upload have completed.
    // Revocation now races specifically with the database write boundary.
    await db.correctionsFacilityGrant.delete({ where: { id: grant.id } });
    releasePut();
    releasePut = null;
    const result = await pending;
    assert.equal(result.status, 403, await result.clone().text());
    assert.equal(await db.audioTake.count({ where: { projectId: project.id } }), 0);
    assert.equal(await db.mediaAsset.count({ where: { organisationId } }), 0);
    assert.ok(storageMethods.includes("DELETE"), "the rejected recording object must be cleaned up");

    for (const path of [
      `/api/corrections/contributor/audio-lab/projects/${project.id}/editor`,
      `/api/corrections/contributor/multitrack/projects/${project.id}`
    ]) {
      const denied = await fetch(`${baseUrl}${path}`, { method: "POST",
        headers: { origin: baseUrl, cookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "SAVE", state: {} }), redirect: "manual" });
      assert.equal(denied.status, 403, await denied.clone().text());
    }
    assert.equal(await db.audioProjectVersion.count({ where: { projectId: project.id } }), 0);
    assert.equal(await db.audioRender.count({ where: { projectId: project.id } }), 0);
  } finally {
    releasePut?.();
    if (store) {
      store.closeAllConnections?.();
      await new Promise((resolve) => store.close(resolve));
    }
    try {
      if (organisationId) {
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.correctionsFacilityGrant.deleteMany({ where: { organisationId } });
        await db.auditLog.deleteMany({ where: { organisationId } });
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
