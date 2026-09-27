import { prisma } from "@/lib/prisma";
import { canonicalEdgeJson, signEdgeManifest, EDGE_MANIFEST_SCHEMA } from "@/lib/corrections-edge-manifest.mjs";
import { correctionsEdgeSigningPrivateKey } from "@/lib/corrections-edge-signing";
import { approvedCorrectionsNetworkSource, assertCorrectionsNetworkTarget } from "@/lib/corrections-network-programming-service";
import { approvedCorrectionsNetworkAudioSource, assertCorrectionsNetworkAudioTarget } from "@/lib/corrections-network-audio-service";

const OFFLINE_HOURS = 24;
const MAX_WINDOWS = 500;

function bad(message, status = 409) { return Object.assign(new Error(message), { status }); }
const dateText = (date) => date ? new Date(date).toISOString() : null;
const validChecksum = (value) => /^[a-f0-9]{64}$/i.test(value || "");

async function eligibleWindow(db, node, facility, window, now, until) {
  if (window.organisationId !== node.organisationId || window.facilityId !== node.facilityId || !window.active ||
      Boolean(window.distributionId) === Boolean(window.audioDistributionId)) return null;
  if (window.audioDistributionId) {
    const distribution = await db.correctionsNetworkAudioDistribution.findFirst({ where: {
      id: window.audioDistributionId, organisationId: node.organisationId, targetFacilityId: node.facilityId,
      status: "ACTIVE", effectiveFrom: { lt: until }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }]
    } });
    if (!distribution || window.kind !== "CENTRAL" || !window.allowedContentTypes.includes(distribution.kind)) return null;
    const source = await approvedCorrectionsNetworkAudioSource(db, node.organisationId, distribution.kind,
      distribution.rehabilitationId || distribution.announcementId, { pinnedVersionId: distribution.promoVersionId, instant: now });
    assertCorrectionsNetworkAudioTarget(node.organisationId, source, facility, distribution.territoryCode);
    if (source.content.facilityId !== distribution.sourceFacilityId || source.media.id !== distribution.mediaAssetId ||
        source.fingerprint !== distribution.sourceFingerprint || !validChecksum(source.promo.checksumSha256)) return null;
    return { distribution, media: source.media, promo: source.promo, sourceRevision: `c7a:${window.id}:${distribution.id}:${source.fingerprint}`,
      sourceType: distribution.kind, sourceExpiry: source.content.expiresAt || null };
  }
  if (!window.allowedContentTypes.includes("PROGRAMME")) return null;
  const distribution = await db.correctionsProgrammeDistribution.findFirst({ where: {
    id: window.distributionId, organisationId: node.organisationId, targetFacilityId: node.facilityId,
    status: "ACTIVE", effectiveFrom: { lt: until }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }]
  }, include: { syndicationOffer: { select: { status: true, sourceFacilityId: true, programmeId: true, submissionId: true } } } });
  if (!distribution || (window.kind === "LOCAL" && distribution.sourceFacilityId !== node.facilityId) ||
      (distribution.syndicationOfferId && (distribution.syndicationOffer?.status !== "ACCEPTED" ||
        distribution.syndicationOffer.sourceFacilityId !== distribution.sourceFacilityId ||
        distribution.syndicationOffer.programmeId !== distribution.programmeId ||
        distribution.syndicationOffer.submissionId !== distribution.submissionId))) return null;
  const source = await approvedCorrectionsNetworkSource(db, node.organisationId, distribution.programmeId, distribution.submissionId);
  assertCorrectionsNetworkTarget(node.organisationId, source, facility);
  if (source.programme.facilityId !== distribution.sourceFacilityId || source.submission.id !== distribution.submissionId ||
      (source.programme.networkOrigin !== "CENTRAL" && distribution.sourceFacilityId !== node.facilityId && !distribution.syndicationOfferId) ||
      source.render.outputMediaAsset.id !== source.render.outputPromoVersion.mediaAssetId ||
      !validChecksum(source.render.outputPromoVersion.checksumSha256)) return null;
  return { distribution, media: source.render.outputMediaAsset, promo: source.render.outputPromoVersion,
    sourceRevision: `c7:${window.id}:${distribution.id}:${source.submission.id}:${source.submission.sourceFingerprint}`,
    sourceType: "PROGRAMME" };
}

function contentFor(choice) {
  const bytes = Number(choice.media.sizeBytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || !Number.isSafeInteger(Number(choice.media.durationSeconds)) ||
      Number(choice.media.durationSeconds) < 2 || choice.media.status !== "READY" ||
      choice.media.libraryType !== "ORGANISATION_PROMO") return null;
  return { mediaAssetId: choice.media.id, promoVersionId: choice.promo.id,
    sha256: choice.promo.checksumSha256.toLowerCase(), sizeBytes: bytes, mimeType: choice.media.mimeType,
    durationSeconds: Number(choice.media.durationSeconds), rightsUse: "CORRECTIONS_RADIO", sourceType: choice.sourceType };
}

export async function buildCorrectionsEdgePayload(db, node, now = new Date()) {
  const until = new Date(now.getTime() + OFFLINE_HOURS * 60 * 60_000);
  const facility = await db.correctionsFacility.findFirst({ where: { locationId: node.facilityId,
    location: { organisationId: node.organisationId, status: "ACTIVE" } },
    include: { location: { select: { id: true, organisationId: true, status: true, countryCode: true, timezone: true,
      zones: { where: { status: "ACTIVE" }, select: { id: true, name: true,
        players: { where: { status: { not: "DISABLED" }, enrolledAt: { not: null } }, select: { id: true, organisationId: true } },
        channelAssignments: { where: { activeFrom: { lte: now }, OR: [{ activeTo: null }, { activeTo: { gt: now } }],
          channel: { status: "ACTIVE", musicRightsUse: "CORRECTIONS_RADIO", station: { productFamily: "CORRECTIONS" } } },
          select: { channel: { select: { id: true, organisationId: true } } }, take: 1 } } } } } } });
  const central = await db.correctionsProfile.findUnique({ where: { organisationId: node.organisationId } });
  if (!facility?.policyConfiguredAt || !central?.policyConfiguredAt || !facility.location.countryCode) {
    throw bad("This facility requires current central and local Corrections policy before Edge sync.");
  }
  const zones = facility.location.zones.filter((zone) => zone.channelAssignments[0]?.channel.organisationId === node.organisationId)
    .map((zone) => ({ id: zone.id, channelId: zone.channelAssignments[0].channel.id,
      playerIds: zone.players.filter((player) => player.organisationId === node.organisationId).map((player) => player.id).sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const rawWindows = await db.correctionsNetworkWindow.findMany({ where: { organisationId: node.organisationId,
    facilityId: node.facilityId, active: true }, orderBy: [{ weekday: "asc" }, { startMinute: "asc" }, { id: "asc" }], take: MAX_WINDOWS + 1 });
  if (rawWindows.length > MAX_WINDOWS) throw bad("The Edge schedule exceeds the safe sync limit.");
  const windows = [];
  const content = new Map();
  for (const window of rawWindows) {
    let choice;
    try { choice = await eligibleWindow(db, node, facility, window, now, until); }
    catch { continue; } // Invalid or withdrawn content is omitted, never cached.
    if (!choice) continue;
    const item = contentFor(choice);
    if (!item) continue;
    const key = `${item.mediaAssetId}:${item.promoVersionId}:${item.sha256}`;
    content.set(key, item);
    const expiry = [choice.distribution.effectiveUntil, choice.sourceExpiry].filter(Boolean)
      .map((value) => new Date(value).getTime());
    const programmingSource = window.kind === "FALLBACK" ? "CORRECTIONS_FALLBACK" :
      choice.sourceType === "REHABILITATION" ? "CORRECTIONS_CENTRAL_REHAB" :
      choice.sourceType === "ANNOUNCEMENT" ? "CORRECTIONS_CENTRAL_ANNOUNCE" :
      choice.distribution.syndicationOfferId ? "CORRECTIONS_SYNDICATED" :
      window.kind === "LOCAL" ? "CORRECTIONS_LOCAL" : "CORRECTIONS_CENTRAL";
    windows.push({ id: window.id, facilityId: node.facilityId, kind: window.kind, mandatory: window.mandatory,
      weekday: window.weekday, startMinute: window.startMinute, endMinute: window.endMinute,
      distributionId: choice.distribution.id, contentKey: key, sourceRevision: choice.sourceRevision, programmingSource,
      effectiveFrom: dateText(choice.distribution.effectiveFrom),
      effectiveUntil: expiry.length ? new Date(Math.min(...expiry)).toISOString() : null });
  }
  const overrides = [];
  const activeOverrides = await db.correctionsOverride.findMany({ where: { organisationId: node.organisationId,
    facilityId: node.facilityId, status: "ACTIVE", startedAt: { lte: now }, expiresAt: { gt: now }, endedAt: null },
    orderBy: { startedAt: "desc" }, take: 100 });
  const allowedPlayers = new Set(zones.flatMap((zone) => zone.playerIds));
  const allowedZones = new Set(zones.map((zone) => zone.id));
  for (const override of activeOverrides) {
    if (!override.targetZoneIds.every((id) => allowedZones.has(id)) ||
        !override.targetPlayerIds.every((id) => allowedPlayers.has(id))) continue;
    try {
      const source = await approvedCorrectionsNetworkAudioSource(db, node.organisationId,
        "ANNOUNCEMENT", override.announcementId, { instant: now });
      assertCorrectionsNetworkAudioTarget(node.organisationId, source, facility, facility.location.countryCode);
      if (source.content.facilityId !== node.facilityId || source.promo.promoAsset.currentApprovedVersionId !== source.promo.id ||
          !validChecksum(source.promo.checksumSha256)) continue;
      const item = contentFor({ media: source.media, promo: source.promo, sourceType: `OVERRIDE_${override.type}` });
      if (!item) continue;
      const contentKey = `${item.mediaAssetId}:${item.promoVersionId}:${item.sha256}`;
      content.set(contentKey, item);
      overrides.push({ id: override.id, facilityId: node.facilityId, type: override.type,
        targetZoneIds: override.targetZoneIds, targetPlayerIds: override.targetPlayerIds,
        startedAt: dateText(override.startedAt), expiresAt: dateText(override.expiresAt), contentKey });
    } catch { /* An invalid or withdrawn override cannot be cached. */ }
  }
  return { schema: EDGE_MANIFEST_SCHEMA, nodeId: node.id, organisationId: node.organisationId,
    facilityId: node.facilityId, sequence: 0, issuedAt: now.toISOString(), validUntil: until.toISOString(),
    timezone: facility.location.timezone, territoryCode: facility.location.countryCode,
    policy: { centralVersion: central.policyVersion, facilityVersion: facility.policyVersion },
    zones, windows, overrides, content: [...content.values()].sort((a, b) => a.mediaAssetId.localeCompare(b.mediaAssetId) || a.promoVersionId.localeCompare(b.promoVersionId)) };
}

export async function currentCorrectionsEdgeManifest(node) {
  const key = correctionsEdgeSigningPrivateKey();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CorrectionsEdgeNode" WHERE "id" = ${node.id} FOR UPDATE`;
    const current = await tx.correctionsEdgeNode.findUnique({ where: { id: node.id } });
    if (current?.status !== "ACTIVE" || current.credentialHash !== node.credentialHash) throw bad("This Edge node is no longer active.", 401);
    const latest = await tx.correctionsEdgeManifest.findFirst({ where: { nodeId: node.id }, orderBy: { sequence: "desc" } });
    const now = new Date();
    const payload = await buildCorrectionsEdgePayload(tx, node, now);
    const state = { ...payload, sequence: 0, issuedAt: null, validUntil: null };
    if (latest && latest.validUntil.getTime() > now.getTime() + 60 * 60_000) {
      const priorState = { ...latest.payload, sequence: 0, issuedAt: null, validUntil: null };
      if (canonicalEdgeJson(state) === canonicalEdgeJson(priorState)) {
        return { payload: latest.payload, version: latest.version, signature: latest.signature };
      }
    }
    payload.sequence = (latest?.sequence || 0) + 1;
    const signed = signEdgeManifest(payload, key);
    await tx.correctionsEdgeManifest.create({ data: { nodeId: node.id, sequence: payload.sequence,
      version: signed.version, payload, signature: signed.signature, validFrom: now, validUntil: new Date(payload.validUntil) } });
    await tx.correctionsEdgeNode.update({ where: { id: node.id }, data: { lastSyncAt: now } });
    await tx.auditLog.create({ data: { organisationId: node.organisationId, action: "CORRECTIONS_EDGE_MANIFEST_ISSUED",
      entityType: "CorrectionsEdgeNode", entityId: node.id, details: { facilityId: node.facilityId,
        sequence: payload.sequence, contentCount: payload.content.length, windowCount: payload.windows.length } } });
    return signed;
  });
}

export async function authorisedCorrectionsEdgeMedia(node, mediaAssetId, now = new Date()) {
  const latest = await prisma.correctionsEdgeManifest.findFirst({ where: { nodeId: node.id,
    validFrom: { lte: now }, validUntil: { gt: now } }, orderBy: { sequence: "desc" } });
  const entries = latest?.payload?.content?.filter((item) => item.mediaAssetId === mediaAssetId) || [];
  if (!entries.length) throw bad("This media is not in the current Edge manifest.", 404);
  const current = await buildCorrectionsEdgePayload(prisma, node, now);
  const eligible = entries.find((item) => current.content.some((candidate) =>
    candidate.mediaAssetId === item.mediaAssetId && candidate.promoVersionId === item.promoVersionId &&
    candidate.sha256 === item.sha256 && candidate.sizeBytes === item.sizeBytes));
  if (!eligible) throw bad("This media is no longer authorised for this facility.", 403);
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaAssetId, organisationId: node.organisationId,
    libraryType: "ORGANISATION_PROMO", status: "READY" }, select: { storageKey: true, mimeType: true, sizeBytes: true } });
  if (!asset) throw bad("The protected media is unavailable.", 404);
  return asset;
}
