export const AUDIO_LAB_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const AUDIO_LAB_MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024;
export const AUDIO_LAB_MAX_PARTS = 100;
export const AUDIO_LAB_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const supportedTypes = new Map([
  ["audio/webm", "webm"],
  ["video/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["application/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"]
]);

export function createDefaultEditDecision() {
  return {
    trimStartMs: 0,
    trimEndMs: null,
    fadeInMs: 0,
    fadeOutMs: 0,
    normalize: true,
    targetLufs: -16,
    noiseCleanup: false
  };
}

export function normalizeEditDecision(value = {}) {
  const integer = (candidate, fallback, min, max) => {
    const parsed = Number(candidate);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max
      ? parsed
      : fallback;
  };
  const trimStartMs = integer(value.trimStartMs, 0, 0, 12 * 60 * 60 * 1000);
  const trimEndMs = value.trimEndMs == null
    ? null
    : integer(value.trimEndMs, null, trimStartMs, 12 * 60 * 60 * 1000);
  return {
    trimStartMs,
    trimEndMs,
    fadeInMs: integer(value.fadeInMs, 0, 0, 60_000),
    fadeOutMs: integer(value.fadeOutMs, 0, 0, 60_000),
    normalize: value.normalize !== false,
    targetLufs: [-24, -23, -18, -16, -14].includes(Number(value.targetLufs))
      ? Number(value.targetLufs)
      : -16,
    noiseCleanup: value.noiseCleanup === true
  };
}

export function validateAudioLabUpload({ sizeBytes, mimeType }) {
  const size = Number(sizeBytes);
  const normalizedType = String(mimeType || "").split(";", 1)[0].toLowerCase();
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("The recording is empty or has an invalid size.");
  }
  if (size > AUDIO_LAB_MAX_FILE_SIZE_BYTES) {
    throw new Error("Quick Record accepts recordings up to 250 MB.");
  }
  const extension = supportedTypes.get(normalizedType);
  if (!extension) {
    throw new Error("This browser produced an unsupported recording format.");
  }
  const partCount = Math.ceil(size / AUDIO_LAB_PART_SIZE_BYTES);
  if (partCount > AUDIO_LAB_MAX_PARTS) {
    throw new Error("The recording has too many upload parts.");
  }
  return {
    mimeType: normalizedType,
    extension,
    partSizeBytes: AUDIO_LAB_PART_SIZE_BYTES,
    partCount
  };
}

export function validateUploadPart({ partNumber, partCount, sizeBytes, partSizeBytes }) {
  const number = Number(partNumber);
  const size = Number(sizeBytes);
  if (!Number.isInteger(number) || number < 1 || number > partCount) {
    throw new Error("The upload part number is invalid.");
  }
  const isLast = number === partCount;
  if (!Number.isInteger(size) || size <= 0 || size > partSizeBytes) {
    throw new Error("The upload part has an invalid size.");
  }
  if (!isLast && size !== partSizeBytes) {
    throw new Error("Only the final upload part may be smaller than 5 MB.");
  }
  return number;
}

