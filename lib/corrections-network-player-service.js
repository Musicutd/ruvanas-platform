import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { localDateTimeParts } from "@/lib/opening-hours.mjs";
import { rankCorrectionsNetworkWindows } from "@/lib/corrections-network-policy.mjs";
import { approvedCorrectionsNetworkSource } from "@/lib/corrections-network-programming-service";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

const digest = (parts) => createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
const terminalTypes = ["COMPLETED", "FAILED", "INTERRUPTED"];

export function correctionsNetworkSourceRevision(window, distribution, submission) {
  return `c7:${window.id}:${distribution.id}:${submission.id}:${submission.sourceFingerprint}`;
}

export function correctionsNetworkIntentRefs(intent) {
  const parts = String(intent?.sourceRevision || "").split(":");
  return parts.length === 5 && parts[0] === "c7" && parts.slice(1).every(Boolean)
    ? { windowId: parts[1], distributionId: parts[2], submissionId: parts[3], fingerprint: parts[4] } : null;
}

async function currentNetworkChoice(db, player, instant, excludedDistributionIds = new Set()) {
  const entitlements = resolveEntitlements(player.organisation?.subscription);
  if (!entitlements.correctionsRadioEnabled || Number(entitlements.planTierNumber) < 4) return null;
  const facilityId = player.zone?.locationId;
  const channel = player.zone?.channelAssignments?.[0]?.channel;
  const location = player.zone?.location;
  if (!facilityId || location?.organisationId !== player.organisationId || channel?.organisationId !== player.organisationId ||
      channel.status !== "ACTIVE" || channel.musicRightsUse !== "CORRECTIONS_RADIO" || channel.station?.productFamily !== "CORRECTIONS") return null;
  const facility = await db.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId: player.organisationId, status: "ACTIVE" } }, include: { location: { select: { countryCode: true, timezone: true } } } });
  if (!facility?.policyConfiguredAt || !facility.location.countryCode) return null;
  let local;
  try { local = localDateTimeParts(instant, facility.location.timezone); }
  catch { return null; }
  const windows = await db.correctionsNetworkWindow.findMany({ where: { organisationId: player.organisationId, facilityId, weekday: local.weekday,
    active: true, startMinute: { lte: local.minute }, endMinute: { gt: local.minute }, distributionId: { not: null } } });
  for (const window of rankCorrectionsNetworkWindows(windows, { facilityId, weekday: local.weekday, minute: local.minute })) {
    if (!window.allowedContentTypes.includes("PROGRAMME") || excludedDistributionIds.has(window.distributionId)) continue;
    const distribution = await db.correctionsProgrammeDistribution.findFirst({ where: { id: window.distributionId, organisationId: player.organisationId,
      targetFacilityId: facilityId, status: "ACTIVE", effectiveFrom: { lte: instant }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: instant } }] } });
    if (!distribution || (window.kind === "LOCAL" && distribution.sourceFacilityId !== facilityId)) continue;
    try {
      const source = await approvedCorrectionsNetworkSource(db, player.organisationId, distribution.programmeId, distribution.submissionId);
      if (source.submission.id !== distribution.submissionId || source.programme.facilityId !== distribution.sourceFacilityId ||
          source.territory !== facility.location.countryCode || !Number.isFinite(Number(source.render.outputMediaAsset.durationSeconds)) ||
          Number(source.render.outputMediaAsset.durationSeconds) < 2) continue;
      return { window, distribution, source, facility, local, channelId: channel.id };
    } catch { /* Try the next approved central/default version. */ }
  }
  return null;
}

export async function validateCorrectionsNetworkIntent(db, player, intent, instant = new Date()) {
  const refs = correctionsNetworkIntentRefs(intent);
  if (!refs || intent.organisationId !== player.organisationId || intent.playerId !== player.id || intent.zoneId !== player.zoneId ||
      intent.locationId !== player.zone.locationId || intent.cancelledAt) return null;
  let choice = await currentNetworkChoice(db, player, instant);
  if (choice?.window.kind === "LOCAL" && choice.window.id !== refs.windowId) {
    const failedLocal = await db.playoutIntent.findFirst({ where: { organisationId: player.organisationId, playerId: player.id,
      sourceRevision: { startsWith: `c7:${choice.window.id}:${choice.distribution.id}:` },
      playbackEvents: { some: { eventType: "FAILED" } } }, orderBy: { plannedStart: "desc" }, select: { plannedStart: true } });
    if (failedLocal?.plannedStart.getTime() + 30_000 > instant.getTime()) {
      choice = await currentNetworkChoice(db, player, instant, new Set([choice.distribution.id]));
    }
  }
  if (!choice || choice.window.id !== refs.windowId || choice.distribution.id !== refs.distributionId ||
      choice.source.submission.id !== refs.submissionId || choice.source.submission.sourceFingerprint !== refs.fingerprint ||
      intent.correctionsProgrammeId !== choice.source.programme.id || intent.correctionsSubmissionId !== choice.source.submission.id ||
      intent.mediaAssetId !== choice.source.render.outputMediaAsset.id || intent.promoVersionId !== choice.source.render.outputPromoVersion.id ||
      intent.channelId !== choice.channelId) return null;
  return choice;
}

// An interruption is not a delivery claim. Permit signed evidence for an
// already-issued intent after a window is deactivated or a version withdrawn,
// while still checking its immutable tenant/facility/version relationships.
export async function validateCorrectionsNetworkInterruption(db, player, intent) {
  const refs = correctionsNetworkIntentRefs(intent);
  if (!refs || intent.organisationId !== player.organisationId || intent.playerId !== player.id || intent.zoneId !== player.zoneId ||
      intent.locationId !== player.zone.locationId || intent.cancelledAt) return null;
  const window = await db.correctionsNetworkWindow.findFirst({ where: { id: refs.windowId, organisationId: player.organisationId,
    facilityId: player.zone.locationId, distributionId: refs.distributionId } });
  const distribution = window ? await db.correctionsProgrammeDistribution.findFirst({ where: { id: refs.distributionId,
    organisationId: player.organisationId, targetFacilityId: player.zone.locationId, submissionId: refs.submissionId,
    programmeId: intent.correctionsProgrammeId } }) : null;
  if (!window || !distribution || intent.correctionsSubmissionId !== refs.submissionId ||
      intent.channelId !== player.zone.channelAssignments[0]?.channelId) return null;
  return { window, distribution };
}

// Materialise the current governed window as an ordinary private PlayoutIntent.
// The existing player manifest, signed media URL and proof endpoint remain the
// only delivery path. This is not a parallel scheduler or public playlist.
export async function correctionsNetworkPlayerInsertion(player, instant = new Date()) {
  const result = await runSerializableTransaction(prisma, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Player" WHERE "id" = ${player.id} FOR UPDATE`;
    let active = await currentNetworkChoice(tx, player, instant);
    if (!active) return null;
    let sourceRevision;
    let latest;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      sourceRevision = correctionsNetworkSourceRevision(active.window, active.distribution, active.source.submission);
      latest = await tx.playoutIntent.findFirst({ where: { organisationId: player.organisationId, playerId: player.id,
        sourceRevision, cancelledAt: null }, orderBy: { plannedStart: "desc" }, include: { playbackEvents: { where: { eventType: { in: terminalTypes } }, take: 1 } } });
      const recentFailure = latest?.playbackEvents.some((item) => item.eventType === "FAILED") && latest.plannedStart.getTime() + 30_000 > instant.getTime();
      if (!recentFailure) break;
      if (active.window.kind !== "LOCAL") return null;
      active = await currentNetworkChoice(tx, player, instant, new Set([active.distribution.id]));
      if (!active) return null;
    }
    const { window, distribution, source, facility, channelId } = active;
    const interruptedByClearedOverride = latest && await tx.correctionsOverride.findFirst({ where: {
      organisationId: player.organisationId, facilityId: facility.locationId, targetPlayerIds: { has: player.id },
      status: { in: ["COMPLETED", "CLEARED", "SUPERSEDED", "EXPIRED"] }, endedAt: { gte: latest.plannedStart, lte: instant }
    }, select: { id: true } });
    if (latest && latest.expiresAt > instant && !latest.playbackEvents.length && !interruptedByClearedOverride) return { intent: latest, active };
    const seconds = Number(source.render.outputMediaAsset.durationSeconds);
    const remainingWindowMs = (window.endMinute - active.local.minute) * 60_000 - instant.getUTCSeconds() * 1000 - instant.getUTCMilliseconds();
    const expiresAt = new Date(Math.min(instant.getTime() + (seconds + 90) * 1000, instant.getTime() + remainingWindowMs));
    if (expiresAt <= instant) return null;
    const intent = await tx.playoutIntent.create({ data: {
      scheduleItemId: digest(["inside-c7", window.id, distribution.id, player.id, instant.toISOString()]),
      organisationId: player.organisationId, playerId: player.id, zoneId: player.zoneId, channelId,
      locationId: facility.locationId, locationName: player.zone.location.name, locationTimezone: player.zone.location.timezone,
      locationGroups: [], publicationRevision: source.submission.revision, sourceRevision,
      correctionsProgrammeId: source.programme.id, correctionsSubmissionId: source.submission.id,
      mediaAssetId: source.render.outputMediaAsset.id, promoVersionId: source.render.outputPromoVersion.id,
      plannedStart: instant, expiresAt
    } });
    return { intent, active };
  });
  if (!result) return null;
  const { intent, active } = result;
  return { scheduleItemId: intent.scheduleItemId, itemType: "CORRECTIONS_AUDIO", mediaAssetId: intent.mediaAssetId,
    promoVersionId: intent.promoVersionId, plannedStart: intent.plannedStart, expiresAt: intent.expiresAt,
    durationSeconds: Number(active.source.render.outputMediaAsset.durationSeconds), sourceRevision: intent.sourceRevision,
    title: active.source.programme.title, artist: "Ruvanas Inside", programmingSource: active.window.kind === "LOCAL" ? "CORRECTIONS_LOCAL" : "CORRECTIONS_CENTRAL" };
}
