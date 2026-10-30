import { RETAIL_PLANNER_STATION_ID } from "./retail-weekly-planner-ui.mjs";

export const RETAIL_COMMERCIAL_UPLOAD_ENDPOINT = "/api/programming/test-retail/commercial-audio";
export const RETAIL_COMMERCIAL_RECORDING_REVIEW_ENDPOINT = `${RETAIL_COMMERCIAL_UPLOAD_ENDPOINT}/review`;
export const RETAIL_COMMERCIAL_UPLOAD_KINDS = [
  { value: "COMMERCIAL", label: "Commercial / offer" },
  { value: "ANNOUNCEMENT", label: "Shop announcement" },
  { value: "JINGLE", label: "Jingle / station ident" },
  { value: "VOICEOVER", label: "Voice message" }
];
export const RETAIL_COMMERCIAL_UPLOAD_ACCEPT = ".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const count = value => Number.isSafeInteger(value) && value >= 0;
const statuses = ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"];
const qcStatuses = ["PENDING", "PASSED", "FAILED"];
const kind = value => RETAIL_COMMERCIAL_UPLOAD_KINDS.some(entry => entry.value === value);

export function retailCommercialUploadView(body) {
  const limits = body?.limits;
  if (body?.stationId !== RETAIL_PLANNER_STATION_ID || body.organisationId !== "cmvmeq5880005lf2knwtw1b93" || body.adminApprovalRequired !== false || body.subscriberApprovalRequired !== true || body.scheduleApprovalRequired !== "SUBSCRIBER" || body.playbackConnected !== false ||
      typeof body.canUpload !== "boolean" || !count(body.usedBytes) || !count(body.storageLimitBytes) || body.storageLimitBytes < 1 ||
      !Number.isSafeInteger(limits?.maxFileBytes) || limits.maxFileBytes < 1 || limits.maxFileBytes > MAX_FILE_BYTES ||
      !Number.isInteger(limits.maxDurationSeconds) || limits.maxDurationSeconds < 1 || limits.maxDurationSeconds > 300 ||
      !Number.isInteger(limits.maxUploads) || limits.maxUploads < 1 || limits.maxUploads > 50 ||
      !Array.isArray(body.uploads) || body.uploads.length > limits.maxUploads || body.uploads.some(entry => !id(entry.id) || !id(entry.promoAssetId) ||
        typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 120 || !kind(entry.mediaType) ||
        !Number.isInteger(entry.version) || entry.version < 1 || !statuses.includes(entry.status) || !qcStatuses.includes(entry.qcStatus) ||
        !Number.isInteger(entry.durationSeconds) || entry.durationSeconds < 1 || entry.durationSeconds > limits.maxDurationSeconds ||
        !count(entry.sizeBytes) || entry.sizeBytes < 1 || entry.sizeBytes > limits.maxFileBytes ||
        !date(entry.submittedAt) || entry.reviewedAt !== null && !date(entry.reviewedAt)) ||
      new Set(body.uploads.map(entry => entry.id)).size !== body.uploads.length)
    throw new Error("Your commercial audio library could not be verified. Refresh its status before uploading.");
  return {
    stationId: body.stationId, canUpload: body.canUpload, adminApprovalRequired: false, subscriberApprovalRequired: true, scheduleApprovalRequired: "SUBSCRIBER", playbackConnected: false,
    usedBytes: body.usedBytes, storageLimitBytes: body.storageLimitBytes,
    limits: { maxFileBytes: limits.maxFileBytes, maxDurationSeconds: limits.maxDurationSeconds, maxUploads: limits.maxUploads },
    uploads: body.uploads.map(({ id, promoAssetId, name, mediaType, version, status, qcStatus, durationSeconds, sizeBytes, submittedAt, reviewedAt }) =>
      ({ id, promoAssetId, name, mediaType, version, status, qcStatus, durationSeconds, sizeBytes, submittedAt, reviewedAt }))
  };
}

export function retailCommercialUploadIssues({ name, mediaType, file, rightsConfirmed }, limits) {
  const issues = [];
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(name)) issues.push("Give this recording a name, up to 120 characters.");
  if (!kind(mediaType)) issues.push("Choose a recording type.");
  if (!file) issues.push("Choose a commercial or shop announcement audio file.");
  else if (!/\.(mp3|wav|ogg|m4a)$/i.test(file.name || "")) issues.push("Choose an MP3, WAV, OGG or M4A audio file.");
  else if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > (limits?.maxFileBytes || MAX_FILE_BYTES)) issues.push("Choose a non-empty audio file no larger than 20 MB.");
  if (rightsConfirmed !== true) issues.push("Confirm you have permission to use this commercial or announcement.");
  return issues;
}

export function retailCommercialUploadStatus(recording) {
  if (recording.status === "APPROVED" && recording.qcStatus === "PASSED") return { label: "Approved for planning", tone: "approved", detail: "You can select this recording in a commercial break. Approving the recording alone does not put it on air." };
  if (recording.status === "REJECTED" || recording.qcStatus === "FAILED") return { label: "Not approved", tone: "rejected", detail: "This recording cannot be used in a break. Upload a corrected replacement if needed." };
  if (recording.status === "SUPERSEDED") return { label: "Replaced", tone: "neutral", detail: "Use the current approved recording when planning a break." };
  return { label: "Awaiting your approval", tone: "pending", detail: "Review your recording and accept responsibility for its content before adding it to a break." };
}

export function retailCommercialRecordingReviewBody(recording, decision, { rightsConfirmed = false, notes = "" } = {}) {
  if (!id(recording?.id) || recording.status !== "IN_REVIEW" || !["APPROVE", "REJECT"].includes(decision)) throw new Error("Refresh upload status before reviewing this recording.");
  if (typeof notes !== "string" || notes.length > 1000) throw new Error("Keep your review note within 1,000 characters.");
  if (decision === "APPROVE" && rightsConfirmed !== true) throw new Error("Confirm that you have reviewed the recording and accept responsibility for its use.");
  if (decision === "REJECT" && !notes.trim()) throw new Error("Add a short reason before rejecting this recording.");
  return { versionId: recording.id, decision, ...(decision === "APPROVE" ? { rightsConfirmed: true } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) };
}

export function retailCommercialRecordingPreviewPath(recording) {
  if (!id(recording?.id)) throw new Error("This recording cannot be previewed.");
  return `${RETAIL_COMMERCIAL_UPLOAD_ENDPOINT}/preview?versionId=${encodeURIComponent(recording.id)}`;
}

export const retailCommercialUploadDuration = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export const retailCommercialUploadSize = bytes => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
