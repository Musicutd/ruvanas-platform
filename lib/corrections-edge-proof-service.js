import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { verifyCorrectionsEdgeProof, validCorrectionsEdgeProofPayload } from "@/lib/corrections-edge-proof.mjs";
import { resolveCorrectionsEdgePlayback } from "@/edge/resolver.mjs";

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const scheduleId = (nodeId, sessionId) => createHash("sha256").update(`c8:${nodeId}:${sessionId}`).digest("hex");

async function sourceReferences(tx, window, override) {
  if (override) {
    const row = await tx.correctionsOverride.findUnique({ where: { id: override.id },
      select: { announcementId: true, organisationId: true, facilityId: true } });
    if (!row) throw bad("The signed override no longer has an auditable source.");
    return { correctionsAnnouncementId: row.announcementId, correctionsOverrideId: override.id };
  }
  if (!window) throw bad("The signed playback window is missing.");
  if (window.sourceRevision?.startsWith("c7a:")) {
    const row = await tx.correctionsNetworkAudioDistribution.findUnique({ where: { id: window.distributionId },
      select: { rehabilitationId: true, announcementId: true, organisationId: true, targetFacilityId: true } });
    if (!row) throw bad("The signed audio distribution no longer has an auditable source.");
    return { correctionsRehabContentId: row.rehabilitationId, correctionsAnnouncementId: row.announcementId };
  }
  const row = await tx.correctionsProgrammeDistribution.findUnique({ where: { id: window.distributionId },
    select: { programmeId: true, submissionId: true, organisationId: true, targetFacilityId: true } });
  if (!row) throw bad("The signed programme distribution no longer has an auditable source.");
  return { correctionsProgrammeId: row.programmeId, correctionsSubmissionId: row.submissionId };
}

export async function ingestCorrectionsEdgeProof(node, records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 100) throw bad("Submit 1–100 Edge proof records.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CorrectionsEdgeNode" WHERE "id" = ${node.id} FOR UPDATE`;
    const current = await tx.correctionsEdgeNode.findUnique({ where: { id: node.id } });
    if (current?.status !== "ACTIVE" || current.credentialHash !== node.credentialHash || !current.proofPublicKeyPem) {
      throw bad("This Edge credential is no longer authorised.", 401);
    }
    let sequence = current.lastProofSequence;
    let previousHash = current.lastProofHash || null;
    let accepted = 0;
    let duplicates = 0;
    const now = new Date();
    for (const record of records) {
      if (!Number.isSafeInteger(record?.sequence) || !validCorrectionsEdgeProofPayload(record.payload,
        { nodeId: node.id, organisationId: node.organisationId, facilityId: node.facilityId })) {
        throw bad("An Edge proof record is malformed.");
      }
      if (record.sequence <= sequence) {
        const existing = await tx.correctionsEdgeProofEvent.findUnique({ where: {
          nodeId_sequence: { nodeId: node.id, sequence: record.sequence } },
          select: { eventHash: true, previousHash: true } });
        if (!existing || existing.eventHash !== record.eventHash ||
            !verifyCorrectionsEdgeProof(record, current.proofPublicKeyPem,
              { sequence: record.sequence, previousHash: existing.previousHash })) {
          throw bad("An Edge proof sequence was replayed with different evidence.", 409);
        }
        duplicates += 1;
        continue;
      }
      if (record.sequence !== sequence + 1 ||
          !verifyCorrectionsEdgeProof(record, current.proofPublicKeyPem, { sequence: sequence + 1, previousHash })) {
        throw bad("The Edge proof signature or chain is invalid.", 409);
      }
      const payload = record.payload;
      const occurredAt = new Date(payload.occurredAt);
      const age = now.getTime() - occurredAt.getTime();
      if (age > MAX_AGE_MS || age < -5 * 60_000) throw bad("Edge proof time is outside the accepted recovery period.");
      const manifest = await tx.correctionsEdgeManifest.findUnique({ where: {
        nodeId_version: { nodeId: node.id, version: payload.manifestVersion } } });
      if (!manifest || occurredAt < manifest.validFrom || occurredAt >= manifest.validUntil ||
          payload.facilityId !== node.facilityId || payload.organisationId !== node.organisationId) {
        throw bad("Edge proof is outside its exact signed manifest authorisation.");
      }
      const signed = manifest.payload;
      const zone = signed.zones.find((item) => item.id === payload.zoneId && item.playerIds.includes(payload.playerId));
      const item = signed.content.find((entry) =>
        `${entry.mediaAssetId}:${entry.promoVersionId}:${entry.sha256}` === payload.contentKey);
      if (!zone || !item) throw bad("Edge proof names a player or media outside the signed facility snapshot.");
      const sessionScheduleId = scheduleId(node.id, payload.sessionId);
      let intent = await tx.playoutIntent.findUnique({ where: { scheduleItemId: sessionScheduleId } });
      if (payload.eventType === "STARTED") {
        if (intent) throw bad("This Edge playback session was started twice.", 409);
        const decision = resolveCorrectionsEdgePlayback(signed, { zoneId: payload.zoneId,
          playerId: payload.playerId, instant: occurredAt });
        if (decision.state !== "READY" || decision.contentKey !== payload.contentKey ||
            decision.source !== payload.programmingSource || (decision.windowId || null) !== payload.windowId ||
            (decision.overrideId || null) !== payload.overrideId) {
          throw bad("Edge playback does not match the authorised source at the claimed start time.");
        }
        const [player, location] = await Promise.all([
          tx.player.findFirst({ where: { id: payload.playerId, organisationId: node.organisationId,
            zoneId: payload.zoneId }, select: { id: true, name: true } }),
          tx.location.findFirst({ where: { id: node.facilityId, organisationId: node.organisationId },
            select: { name: true } })
        ]);
        if (!player || !location) throw bad("The claimed Edge player or facility does not belong to this node.");
        const window = signed.windows.find((entry) => entry.id === payload.windowId);
        const override = signed.overrides.find((entry) => entry.id === payload.overrideId);
        const refs = await sourceReferences(tx, window, override);
        intent = await tx.playoutIntent.create({ data: { scheduleItemId: sessionScheduleId,
          organisationId: node.organisationId, playerId: player.id, zoneId: zone.id,
          channelId: zone.channelId, mediaAssetId: item.mediaAssetId, promoVersionId: item.promoVersionId,
          locationId: node.facilityId, locationName: location.name, locationTimezone: signed.timezone,
          locationGroups: [], publicationRevision: 1,
          sourceRevision: window?.sourceRevision || `c8-override:${override?.id}`,
          plannedStart: occurredAt, expiresAt: manifest.validUntil, ...refs } });
      } else {
        if (!intent || intent.playerId !== payload.playerId || intent.zoneId !== payload.zoneId ||
            intent.mediaAssetId !== item.mediaAssetId || intent.promoVersionId !== item.promoVersionId) {
          throw bad("A terminal Edge proof needs the exact prior started session.");
        }
        const started = await tx.proofOfPlayEvent.findFirst({ where: {
          playoutIntentId: intent.id, eventType: "STARTED", playerId: payload.playerId },
          orderBy: { occurredAt: "asc" } });
        const terminal = await tx.proofOfPlayEvent.findFirst({ where: {
          playoutIntentId: intent.id, eventType: { in: ["COMPLETED", "FAILED", "INTERRUPTED"] } } });
        if (!started || terminal || occurredAt < started.occurredAt ||
            occurredAt.getTime() > started.occurredAt.getTime() + (item.durationSeconds + 300) * 1000 ||
            (payload.eventType === "COMPLETED" && (payload.positionSeconds < Math.max(1, item.durationSeconds - 5) ||
              occurredAt.getTime() - started.occurredAt.getTime() < Math.max(1, item.durationSeconds - 5) * 1000))) {
          throw bad("The Edge terminal proof cannot be reconciled with playback time or prior evidence.");
        }
      }
      const [player, location, zoneRow, promo] = await Promise.all([
        tx.player.findUnique({ where: { id: payload.playerId }, select: { name: true } }),
        tx.location.findUnique({ where: { id: node.facilityId }, select: { name: true } }),
        tx.zone.findUnique({ where: { id: payload.zoneId }, select: { name: true } }),
        tx.promoVersion.findUnique({ where: { id: item.promoVersionId }, select: { promoAsset: { select: { name: true } } } })
      ]);
      const proof = await tx.proofOfPlayEvent.create({ data: {
        clientEventId: payload.eventId, organisationId: node.organisationId,
        playerId: payload.playerId, zoneId: payload.zoneId, channelId: zone.channelId,
        scheduleItemId: sessionScheduleId, itemType: "CORRECTIONS_AUDIO",
        promoVersionId: item.promoVersionId, playoutIntentId: intent.id, mediaAssetId: item.mediaAssetId,
        // Shared proof rows have a legacy 24-hex manifest check. The complete
        // signed 64-hex Edge version remains in immutable Edge proof payload.
        manifestVersion: payload.manifestVersion.slice(0, 24), programmingSource: payload.programmingSource,
        eventType: payload.eventType, occurredAt, positionSeconds: payload.positionSeconds,
        failureReason: payload.eventType === "FAILED" ? "Edge player reported failure" :
          payload.eventType === "INTERRUPTED" ? "Edge player reported interruption" : null,
        playerName: player?.name || "Secure Edge player", locationName: location?.name || "Inside facility",
        zoneName: zoneRow?.name || "Inside zone", trackTitle: promo?.promoAsset?.name || "Approved Inside audio",
        trackArtist: "Ruvanas Inside"
      } });
      await tx.correctionsEdgeProofEvent.create({ data: { nodeId: node.id, sequence: record.sequence,
        eventId: payload.eventId, previousHash: record.previousHash, eventHash: record.eventHash,
        signature: record.signature, payload, occurredAt, proofOfPlayEventId: proof.id } });
      sequence = record.sequence;
      previousHash = record.eventHash;
      accepted += 1;
    }
    await tx.correctionsEdgeNode.update({ where: { id: node.id }, data: { lastProofSequence: sequence,
      lastProofHash: previousHash, pendingProofCount: { decrement: Math.min(accepted, current.pendingProofCount) } } });
    return { accepted, duplicates, acknowledgedSequence: sequence, acknowledgedHash: previousHash,
      receivedAt: now.toISOString() };
  }, { timeout: 30_000 });
}
