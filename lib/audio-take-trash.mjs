export const AUDIO_TAKE_TRASH_DAYS = 30;
export const AUDIO_TAKE_TRASH_MS = AUDIO_TAKE_TRASH_DAYS * 24 * 60 * 60 * 1000;

export function audioTakePurgeAfter(now = new Date()) {
  return new Date(new Date(now).getTime() + AUDIO_TAKE_TRASH_MS);
}

export function recordingTrashBlockers({ clipCount = 0, rundownCount = 0, publicationCount = 0, processingCount = 0 } = {}) {
  const blockers = [];
  if (Number(clipCount) > 0) blockers.push(`${clipCount} multitrack clip${Number(clipCount) === 1 ? "" : "s"}`);
  if (Number(rundownCount) > 0) blockers.push(`${rundownCount} published or draft programme item${Number(rundownCount) === 1 ? "" : "s"}`);
  if (Number(publicationCount) > 0) blockers.push(`${publicationCount} published or submitted use${Number(publicationCount) === 1 ? "" : "s"}`);
  if (Number(processingCount) > 0) blockers.push(`${processingCount} active audio processing job${Number(processingCount) === 1 ? "" : "s"}`);
  return blockers;
}

export function assertRecordingCanBeTrashed(usage = {}) {
  const blockers = recordingTrashBlockers(usage);
  if (blockers.length) {
    throw new Error(`Remove this recording from ${blockers.join(" and ")} before moving it to Trash.`);
  }
}

export function canRestoreAudioTake(take, now = new Date()) {
  return Boolean(
    take?.trashedAt &&
    !take?.permanentlyDeletedAt &&
    (!take?.purgeAfter || new Date(take.purgeAfter).getTime() > new Date(now).getTime())
  );
}

export function trashDaysRemaining(purgeAfter, now = new Date()) {
  if (!purgeAfter) return AUDIO_TAKE_TRASH_DAYS;
  return Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - new Date(now).getTime()) / (24 * 60 * 60 * 1000)));
}

