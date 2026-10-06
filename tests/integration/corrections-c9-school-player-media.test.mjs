import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { hashPlayerToken } from "../../lib/player-tokens.mjs";
import { createPlayerListenerToken, playerInstanceHash } from "../../lib/player-listener-lease.mjs";
import { compileSchoolRadioPlayout, schoolPlayoutIntentCreateData } from "../../lib/school-radio.mjs";
import { schoolMediaIntentIsCurrent } from "../../lib/school-player-media.mjs";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

test("withdrawn School episode, rundown and slot invalidate both saved media URLs after a rundown transition", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 School player-media integration runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  let organisationId, planId, userId;
  try {
    const plan = await db.plan.create({ data: {
      name: `Fictional C9 School media ${suffix}`, code: `C9_SCHOOL_MEDIA_${suffix}`,
      productFamily: "SCHOOL", tierNumber: 3, monthlyPriceCents: 0,
      storageLimitGb: 1, listenerLimit: 10, maxBitrateKbps: 128,
      schoolRadioEnabled: true, stationLimit: 1
    } });
    planId = plan.id;
    const organisation = await db.organisation.create({ data: {
      name: `Fictional C9 School media ${suffix}`, slug: `c9-school-media-${suffix}`
    } });
    organisationId = organisation.id;
    await db.subscription.create({ data: { organisationId, planId, status: "ACTIVE" } });
    const user = await db.user.create({ data: {
      email: `c9-school-media-${suffix}@example.invalid`, passwordHash: "CI-only-not-a-login", role: "OWNER"
    } });
    userId = user.id;
    const supervisor = await db.staffSupervisor.create({ data: { organisationId, userId } });
    const location = await db.location.create({ data: {
      organisationId, name: "Fictional School campus", slug: `c9-school-media-campus-${suffix}`,
      status: "ACTIVE", timezone: "UTC"
    } });
    const zone = await db.zone.create({ data: {
      locationId: location.id, name: "Fictional School hall", slug: `c9-school-media-hall-${suffix}`,
      status: "ACTIVE"
    } });
    const playerToken = `c9-school-media-${randomUUID()}`;
    const player = await db.player.create({ data: {
      organisationId, zoneId: zone.id, name: "Fictional School player", status: "ONLINE",
      sessionTokenHash: hashPlayerToken(playerToken, process.env.SESSION_SECRET),
      enrolledAt: new Date(), lastHeartbeatAt: new Date()
    } });
    const instanceHash = playerInstanceHash(randomUUID(), process.env.SESSION_SECRET);
    await db.playerListenerLease.create({ data: {
      organisationId, playerId: player.id, instanceHash,
      expiresAt: new Date(Date.now() + 5 * 60_000)
    } });
    const listenerToken = createPlayerListenerToken({
      playerId: player.id, instanceHash, expiresAt: new Date(Date.now() + 10 * 60_000)
    }, process.env.SESSION_SECRET);
    const programme = await db.schoolProgramme.create({ data: {
      organisationId, supervisorId: supervisor.id, title: "Fictional School show", createdByUserId: userId
    } });
    const episode = await db.schoolEpisode.create({ data: {
      organisationId, programmeId: programme.id, title: "Fictional approved episode",
      status: "APPROVED", createdByUserId: userId
    } });
    const firstMedia = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional first segment",
      originalName: "first.mp3", storageKey: `c9-school-media/${suffix}/first.mp3`,
      mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 300,
      mediaType: "ANNOUNCEMENT", status: "READY"
    } });
    const secondMedia = await db.mediaAsset.create({ data: {
      organisationId, libraryType: "ORGANISATION_PROMO", name: "Fictional second segment",
      originalName: "second.mp3", storageKey: `c9-school-media/${suffix}/second.mp3`,
      mimeType: "audio/mpeg", sizeBytes: 1024n, durationSeconds: 60,
      mediaType: "ANNOUNCEMENT", status: "READY"
    } });
    const rundown = await db.schoolRundown.create({ data: {
      organisationId, episodeId: episode.id, status: "APPROVED", revision: 1,
      approvedRevision: 1, createdByUserId: userId,
      items: { create: [
        { type: "INTERVIEW", position: 0, label: "First segment", sourceMediaAssetId: firstMedia.id,
          estimatedDurationMs: 300_000 },
        { type: "INTERVIEW", position: 1, label: "Second segment", sourceMediaAssetId: secondMedia.id,
          estimatedDurationMs: 60_000 }
      ] }
    }, include: { items: { orderBy: { position: "asc" }, include: { sourceMediaAsset: true } } } });
    const startsAt = new Date(Date.now() - 6 * 60_000);
    const slot = await db.schoolBroadcastSlot.create({ data: {
      organisationId, episodeId: episode.id, zoneId: zone.id, startsAt,
      endsAt: new Date(Date.now() + 10 * 60_000), status: "APPROVED",
      approvedByUserId: userId
    } });
    const playoutPlayer = { id: player.id, organisationId, zoneId: zone.id,
      organisation: { subscription: { status: "ACTIVE", plan } },
      zone: { locationId: location.id, location: { id: location.id, name: location.name,
        timezone: location.timezone, groupMemberships: [] } } };
    const playoutSlot = { ...slot, announcement: null, episode: { ...episode, rundown } };
    const firstInsertion = compileSchoolRadioPlayout({ slots: [playoutSlot], player: playoutPlayer,
      instant: startsAt }).insertions[0];
    const secondInsertion = compileSchoolRadioPlayout({ slots: [playoutSlot], player: playoutPlayer,
      instant: new Date(startsAt.getTime() + 5 * 60_000) }).insertions[0];
    assert.equal(firstInsertion.schoolRundownItemId, rundown.items[0].id);
    assert.equal(secondInsertion.schoolRundownItemId, rundown.items[1].id);
    const intents = [];
    for (const insertion of [firstInsertion, secondInsertion]) {
      intents.push(await db.playoutIntent.create({ data: schoolPlayoutIntentCreateData({
        insertion, player: playoutPlayer
      }) }));
    }
    for (const intent of intents) {
      assert.equal(await schoolMediaIntentIsCurrent(db, { player: playoutPlayer, intent }), true,
        "each approved rundown item remains valid after its original manifest bucket");
    }
    const mediaStatus = async (mediaAssetId) => (await fetch(
      `${baseUrl}/api/player/media/${mediaAssetId}?listener=${encodeURIComponent(listenerToken)}`,
      { headers: { cookie: `ruvanas_player=${playerToken}` } }
    )).status;
    const bothDenied = async () => {
      assert.equal(await mediaStatus(firstMedia.id), 404);
      assert.equal(await mediaStatus(secondMedia.id), 404);
    };
    await db.schoolEpisode.update({ where: { id: episode.id }, data: { status: "ARCHIVED" } });
    await bothDenied();
    await db.schoolEpisode.update({ where: { id: episode.id }, data: { status: "APPROVED" } });
    await db.schoolRundown.update({ where: { id: rundown.id }, data: { status: "ARCHIVED" } });
    await bothDenied();
    await db.schoolRundown.update({ where: { id: rundown.id }, data: { status: "APPROVED" } });
    await db.schoolBroadcastSlot.update({ where: { id: slot.id }, data: { status: "CANCELLED" } });
    await bothDenied();
  } finally {
    try {
      if (organisationId) {
        await db.playoutIntent.deleteMany({ where: { organisationId } });
        await db.playerListenerLease.deleteMany({ where: { organisationId } });
        await db.schoolBroadcastSlot.deleteMany({ where: { organisationId } });
        await db.schoolRundownItem.deleteMany({ where: { rundown: { organisationId } } });
        await db.schoolRundown.deleteMany({ where: { organisationId } });
        await db.schoolEpisode.deleteMany({ where: { organisationId } });
        await db.schoolProgramme.deleteMany({ where: { organisationId } });
        await db.staffSupervisor.deleteMany({ where: { organisationId } });
        await db.player.deleteMany({ where: { organisationId } });
        await db.zone.deleteMany({ where: { location: { organisationId } } });
        await db.location.deleteMany({ where: { organisationId } });
        await db.mediaAsset.deleteMany({ where: { organisationId } });
        await db.subscription.deleteMany({ where: { organisationId } });
        await db.organisation.delete({ where: { id: organisationId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
      if (planId) await db.plan.delete({ where: { id: planId } });
    } finally {
      await db.$disconnect();
    }
  }
});
