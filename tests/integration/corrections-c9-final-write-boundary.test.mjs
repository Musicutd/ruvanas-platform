import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

async function api(path, { method = "GET", cookie, body, range } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin: baseUrl,
      ...(cookie ? { cookie } : {}),
      ...(range ? { range } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

test("C9 contributor playback follows current source approval and revoked staff cannot save facility policy", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 final write-boundary integration runs only against the exact disposable CI database.");
  }

  const db = new PrismaClient();
  const suffix = randomUUID();
  const userIds = [];
  let organisationId;
  let planId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 final boundary ${suffix}`, code: `C9_FINAL_${suffix}`,
      productFamily: "CORRECTIONS", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      correctionsRadioEnabled: true, stationLimit: 1
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 final boundary ${suffix}`, slug: `c9-final-${suffix}`
    } });
    organisationId = organisation.id;
    const password = `CI-only-${randomUUID()}!`;
    const hash = await bcrypt.hash(password, 4);
    async function member(role) {
      const user = await db.user.create({ data: {
        email: `c9-final-${role.toLowerCase()}-${suffix}@example.invalid`, passwordHash: hash, role
      } });
      userIds.push(user.id);
      const membership = await db.organisationMember.create({ data: { organisationId, userId: user.id, role } });
      return { user, membership };
    }
    const owner = await member("OWNER");
    const manager = await member("MANAGER");
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const facility = await db.location.create({ data: {
      organisationId, name: "Fictional final boundary facility", slug: `c9-final-facility-${suffix}`,
      countryCode: "MT", status: "ACTIVE", correctionsFacility: { create: {} }
    } });
    const grant = await db.correctionsFacilityGrant.create({ data: {
      organisationId, organisationMemberId: manager.membership.id, facilityId: facility.id,
      permission: "MANAGER", createdByUserId: owner.user.id
    } });
    const programme = await db.correctionsProgramme.create({ data: {
      organisationId, facilityId: facility.id, title: "Fictional contributor programme",
      createdByUserId: owner.user.id
    } });
    const contributor = await db.correctionsContributor.create({ data: {
      organisationId, facilityId: facility.id, displayName: "Fictional contributor",
      createdByUserId: owner.user.id
    } });
    const project = await db.audioProject.create({ data: {
      organisationId, title: "Fictional source-current project", editDecision: {},
      createdByUserId: owner.user.id
    } });
    async function media(name) {
      return db.mediaAsset.create({ data: {
        organisationId, libraryType: "ORGANISATION_PROMO", name,
        originalName: `${name}.mp3`, storageKey: `c9-final/${suffix}/${name}.mp3`,
        mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 20,
        mediaType: "ANNOUNCEMENT", status: "READY"
      } });
    }
    const source = await media("approved-source");
    const output = await media("rendered-output");
    const replacement = await media("replacement-source");
    const promo = await db.promoAsset.create({ data: {
      organisationId, name: "Fictional reusable source", mediaType: "ANNOUNCEMENT",
      versions: { create: { mediaAssetId: source.id, version: 1, status: "APPROVED", qcStatus: "PASSED" } }
    }, include: { versions: true } });
    const firstVersion = promo.versions[0];
    await db.promoAsset.update({ where: { id: promo.id }, data: { currentApprovedVersionId: firstVersion.id } });
    const take = await db.audioTake.create({ data: {
      organisationId, projectId: project.id, mediaAssetId: source.id,
      promoVersionId: firstVersion.id, recordedByUserId: owner.user.id,
      sourceEditDecision: {}, durationMs: 20_000, status: "READY"
    } });
    const version = await db.audioProjectVersion.create({ data: {
      projectId: project.id, version: 1, createdByUserId: owner.user.id,
      state: { editor: { clips: [{ kind: "SOURCE", mediaAssetId: source.id }] } }
    } });
    await db.audioRender.create({ data: {
      organisationId, projectId: project.id, versionId: version.id,
      outputMediaAssetId: output.id, requestedByUserId: owner.user.id,
      preset: "SPEECH_MP3", status: "SUCCEEDED"
    } });
    const token = randomBytes(32).toString("base64url");
    await db.correctionsStudioSession.create({ data: {
      organisationId, facilityId: facility.id, contributorId: contributor.id,
      programmeId: programme.id, projectId: project.id,
      supervisorUserId: owner.user.id, createdByUserId: owner.user.id,
      status: "ACTIVE", accessTokenHash: createHash("sha256").update(token).digest("hex"),
      capabilityScope: ["EDIT", "RENDER"], activatedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 60 * 60_000)
    } });
    const contributorCookie = `ruvanas_inside_studio=${token}`;

    // An out-of-range request proves the authorisation gate passed without
    // requiring a real object store: authorised media reaches range parsing.
    for (const assetId of [source.id, output.id]) {
      const permitted = await api(`/api/corrections/contributor/media/${assetId}`, {
        cookie: contributorCookie, range: "bytes=1024-"
      });
      assert.equal(permitted.status, 416, await permitted.clone().text());
    }
    const editorBefore = await api(`/api/corrections/contributor/audio-lab/projects/${project.id}/editor`, {
      cookie: contributorCookie
    });
    assert.equal(editorBefore.status, 200, await editorBefore.clone().text());
    assert.ok((await editorBefore.json()).takes.some((item) => item.id === take.id));

    const secondVersion = await db.promoVersion.create({ data: {
      promoAssetId: promo.id, mediaAssetId: replacement.id, version: 2,
      status: "APPROVED", qcStatus: "PASSED"
    } });
    await db.promoAsset.update({ where: { id: promo.id }, data: { currentApprovedVersionId: secondVersion.id } });
    await db.promoVersion.update({ where: { id: firstVersion.id }, data: { status: "SUPERSEDED" } });

    for (const assetId of [source.id, output.id]) {
      const denied = await api(`/api/corrections/contributor/media/${assetId}`, {
        cookie: contributorCookie, range: "bytes=1024-"
      });
      assert.equal(denied.status, 404, await denied.clone().text());
    }
    const editorAfter = await api(`/api/corrections/contributor/audio-lab/projects/${project.id}/editor`, {
      cookie: contributorCookie
    });
    assert.equal(editorAfter.status, 200, await editorAfter.clone().text());
    assert.ok(!(await editorAfter.json()).takes.some((item) => item.id === take.id));
    const initialise = await api(`/api/corrections/contributor/audio-lab/projects/${project.id}/editor`, {
      method: "POST", cookie: contributorCookie, body: { action: "INITIALIZE", takeId: take.id }
    });
    assert.equal(initialise.status, 409, await initialise.clone().text());

    const login = await api("/api/auth/login", {
      method: "POST", body: { email: manager.user.email, password }
    });
    assert.equal(login.status, 200, await login.clone().text());
    const managerCookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(managerCookie);
    const policyPath = `/api/corrections/facilities/${facility.id}`;
    const policyBody = { action: "SAVE_POLICY", allowedGenres: [], restrictedGenres: [],
      blockedTrackIds: [], blockedArtists: [] };
    const saved = await api(policyPath, { method: "PATCH", cookie: managerCookie, body: policyBody });
    assert.equal(saved.status, 200, await saved.clone().text());
    const policyVersion = (await db.correctionsFacility.findUnique({ where: { locationId: facility.id } })).policyVersion;
    await db.correctionsFacilityGrant.delete({ where: { id: grant.id } });
    const revoked = await api(policyPath, { method: "PATCH", cookie: managerCookie, body: policyBody });
    assert.ok([403, 404].includes(revoked.status), await revoked.clone().text());
    assert.equal((await db.correctionsFacility.findUnique({ where: { locationId: facility.id } })).policyVersion,
      policyVersion);
  } finally {
    try {
      if (organisationId) {
        await db.correctionsStudioSession.deleteMany({ where: { organisationId } });
        await db.audioTake.deleteMany({ where: { organisationId } });
        await db.audioRender.deleteMany({ where: { organisationId } });
        await db.promoAsset.updateMany({ where: { organisationId }, data: { currentApprovedVersionId: null } });
        await db.promoAsset.deleteMany({ where: { organisationId } });
        await db.audioProject.deleteMany({ where: { organisationId } });
        await db.correctionsContributor.deleteMany({ where: { organisationId } });
        await db.correctionsProgramme.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
