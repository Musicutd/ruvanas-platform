export const SHOW_ITEM_TYPES = Object.freeze([
  "MUSIC_TRACK", "JINGLE", "VOICE_TRACK", "INTERVIEW", "ANNOUNCEMENT",
  "SCRIPT_NOTE", "HARD_TIME", "FLEXIBLE_MARKER"
]);

export const BROADCAST_SHOW_ITEM_TYPES = new Set([
  "MUSIC_TRACK", "JINGLE", "VOICE_TRACK", "INTERVIEW", "ANNOUNCEMENT"
]);

export const SHOW_TRANSITIONS = Object.freeze(["CLEAN", "CROSSFADE", "DUCK_VOICE", "HARD_START"]);

const REVIEW_ACTIONS = Object.freeze({
  SUBMIT: new Set(["DRAFT", "CHANGES_REQUESTED", "REJECTED"]),
  APPROVE: new Set(["IN_REVIEW"]),
  REQUEST_CHANGES: new Set(["IN_REVIEW"]),
  REJECT: new Set(["IN_REVIEW"]),
  ARCHIVE: new Set(["DRAFT", "IN_REVIEW", "APPROVED", "CHANGES_REQUESTED", "REJECTED"])
});

export function showItemNeedsSource(type) {
  return BROADCAST_SHOW_ITEM_TYPES.has(type);
}

export function validateShowItem(item) {
  if (!SHOW_ITEM_TYPES.includes(item?.type)) throw new Error("Choose a supported rundown item type.");
  const label = typeof item.label === "string" ? item.label.trim() : "";
  if (label.length < 2 || label.length > 160) throw new Error("Give the rundown item a short label.");
  if (!showItemNeedsSource(item.type)) return { ...item, label };

  const sourceByType = {
    MUSIC_TRACK: item.sourceTrackId,
    JINGLE: item.sourcePromoVersionId,
    VOICE_TRACK: item.sourceTakeId,
    INTERVIEW: item.sourceMediaAssetId,
    ANNOUNCEMENT: item.sourceAnnouncementId
  };
  if (!sourceByType[item.type]) throw new Error(`${item.type.toLowerCase().replaceAll("_", " ")} needs an approved audio source.`);
  return { ...item, label };
}

export function transitionSchoolRundown({ currentStatus, action, notes = null, items = [] }) {
  if (!REVIEW_ACTIONS[action]?.has(currentStatus)) {
    throw new Error(`A ${currentStatus.toLowerCase().replaceAll("_", " ")} rundown cannot be changed with ${action.toLowerCase().replaceAll("_", " ")}.`);
  }
  const reviewNotes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  if (action === "SUBMIT") {
    const broadcastItems = items.filter((item) => showItemNeedsSource(item.type));
    if (!broadcastItems.length) throw new Error("Add at least one playable item before submitting the rundown.");
    for (const item of items) validateShowItem(item);
    return { status: "IN_REVIEW", submittedAt: new Date(), reviewedAt: null, reviewedByUserId: null, reviewNotes: null, approvedRevision: null };
  }
  if (new Set(["REQUEST_CHANGES", "REJECT"]).has(action) && !reviewNotes) {
    throw new Error("Review notes are required for this decision.");
  }
  if (action === "APPROVE") return { status: "APPROVED", reviewedAt: new Date(), reviewNotes };
  if (action === "REQUEST_CHANGES") return { status: "CHANGES_REQUESTED", reviewedAt: new Date(), reviewNotes, approvedRevision: null };
  if (action === "REJECT") return { status: "REJECTED", reviewedAt: new Date(), reviewNotes, approvedRevision: null };
  return { status: "ARCHIVED", reviewedAt: new Date(), reviewNotes, approvedRevision: null };
}

export function invalidatedRundownData(rundown) {
  return {
    revision: rundown.revision + 1,
    status: "DRAFT",
    approvedRevision: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedByUserId: null,
    reviewNotes: null
  };
}

export function orderedPositions(items, movedId, direction) {
  const ordered = [...items].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const index = ordered.findIndex((item) => item.id === movedId);
  const target = direction === "UP" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ordered.length) return ordered.map((item, position) => ({ id: item.id, position }));
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered.map((item, position) => ({ id: item.id, position }));
}

export function showItemDurationMs(item) {
  const explicit = Number(item?.estimatedDurationMs);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const seconds = item?.sourceMediaAsset?.durationSeconds
    ?? item?.sourceTrack?.mediaAsset?.durationSeconds
    ?? item?.sourcePromoVersion?.durationSeconds
    ?? item?.sourcePromoVersion?.mediaAsset?.durationSeconds
    ?? item?.sourceAnnouncement?.promoVersion?.durationSeconds
    ?? item?.sourceAnnouncement?.promoVersion?.mediaAsset?.durationSeconds
    ?? (item?.sourceTake?.durationMs ? item.sourceTake.durationMs / 1000 : null);
  return Math.max(1000, Math.round(Number(seconds || 1) * 1000));
}

export function showItemMedia(item) {
  if (item?.sourceTrack?.mediaAsset) return { mediaAsset: item.sourceTrack.mediaAsset, promoVersionId: null, artist: item.sourceTrack.artist || "Music" };
  if (item?.sourcePromoVersion?.mediaAsset) return { mediaAsset: item.sourcePromoVersion.mediaAsset, promoVersionId: item.sourcePromoVersion.id, artist: "School Radio" };
  if (item?.sourceAnnouncement?.promoVersion?.mediaAsset) return { mediaAsset: item.sourceAnnouncement.promoVersion.mediaAsset, promoVersionId: item.sourceAnnouncement.promoVersion.id, artist: "School announcement" };
  if (item?.sourceTake?.mediaAsset) return { mediaAsset: item.sourceTake.mediaAsset, promoVersionId: item.sourceTake.promoVersionId || null, artist: "Voice track" };
  if (item?.sourceMediaAsset) return { mediaAsset: item.sourceMediaAsset, promoVersionId: null, artist: "School feature" };
  return null;
}

