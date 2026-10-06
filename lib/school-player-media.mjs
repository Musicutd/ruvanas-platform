import { generalSchoolRundownWhere } from "./school-general-content-boundary.mjs";
import { compileSchoolRadioPlayout, SCHOOL_RADIO_MEDIA_GRACE_SECONDS } from "./school-radio.mjs";
import { resolveEntitlements } from "./entitlements.mjs";

const schoolSlotInclude = {
  announcement: {
    include: {
      sourceExchangeRequest: { include: { offer: {
        select: { status: true, sourceOrganisationId: true, approvedPromoVersionId: true }
      } } },
      promoVersion: { include: {
        promoAsset: { select: { id: true, name: true, status: true } },
        mediaAsset: { select: { id: true, organisationId: true, libraryType: true, status: true, durationSeconds: true } }
      } }
    }
  },
  episode: { include: { rundown: { include: { items: {
    orderBy: { position: "asc" },
    include: {
      sourceMediaAsset: true,
      sourceTrack: { include: { mediaAsset: true } },
      sourcePromoVersion: { include: { mediaAsset: true } },
      sourceAnnouncement: { include: { promoVersion: { include: { mediaAsset: true } } } },
      sourceTake: { include: { mediaAsset: true } }
    }
  } } } } }
};

// A persisted School intent keeps a multi-item rundown playable across a
// manifest bucket transition, but it cannot outlive a changed approval or
// source. Recompile its exact item from the current slot before serving bytes.
export async function schoolMediaIntentIsCurrent(database, { player, intent, instant = new Date() }) {
  if (!intent?.schoolBroadcastSlotId || !intent.plannedStart || !intent.expiresAt ||
      new Date(intent.expiresAt) <= instant) return false;
  if (!resolveEntitlements(player.organisation?.subscription, instant).schoolRadioEnabled) return false;

  const slot = await database.schoolBroadcastSlot.findFirst({
    where: {
      id: intent.schoolBroadcastSlotId,
      organisationId: player.organisationId,
      status: "APPROVED",
      revision: intent.publicationRevision,
      endsAt: { gt: new Date(instant.getTime() - SCHOOL_RADIO_MEDIA_GRACE_SECONDS * 1000) },
      OR: [{ zoneId: player.zoneId }, { locationId: player.zone.locationId }]
    },
    include: schoolSlotInclude
  });
  if (!slot) return false;
  if (slot.episode) {
    if (!intent.schoolRundownItemId || !slot.episode.rundown) return false;
    const safeRundown = await database.schoolRundown.findFirst({
      where: {
        id: slot.episode.rundown.id,
        organisationId: player.organisationId,
        ...generalSchoolRundownWhere(player.organisationId, instant)
      },
      select: { id: true }
    });
    if (!safeRundown) return false;
  } else if (intent.schoolRundownItemId) {
    return false;
  }

  const plannedStart = new Date(intent.plannedStart);
  if (Number.isNaN(plannedStart.getTime())) return false;
  const insertion = compileSchoolRadioPlayout({ slots: [slot], player, instant: plannedStart }).insertions.find((item) =>
    item.scheduleItemId === intent.scheduleItemId &&
    item.schoolBroadcastSlotId === intent.schoolBroadcastSlotId &&
    (item.schoolRundownItemId || null) === (intent.schoolRundownItemId || null) &&
    item.mediaAssetId === intent.mediaAssetId &&
    (item.promoVersionId || null) === (intent.promoVersionId || null) &&
    item.publicationRevision === intent.publicationRevision &&
    item.sourceRevision === intent.sourceRevision &&
    item.plannedStart.getTime() === plannedStart.getTime() &&
    item.expiresAt.getTime() === new Date(intent.expiresAt).getTime()
  );
  return Boolean(insertion && insertion.expiresAt > instant);
}
