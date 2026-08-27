import { validateAudioUpload } from "./audio-validation.mjs";

export const STUDIO_FILE_LIMITS = Object.freeze({
  BRIEF_ATTACHMENT: 10 * 1024 * 1024,
  AUDIO_PREVIEW: 50 * 1024 * 1024,
  FINAL_MASTER: 50 * 1024 * 1024
});

function extensionOf(fileName) {
  return String(fileName || "").split(".").pop()?.toLowerCase() || "";
}

function matchesBriefSignature(buffer, extension) {
  if (extension === "pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === "png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === "jpg" || extension === "jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === "txt") return !buffer.includes(0) && Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
  return false;
}

export function validateStudioFile({ buffer, fileName, claimedType = "", kind }) {
  if (!Object.hasOwn(STUDIO_FILE_LIMITS, kind)) return { ok: false, error: "Choose a valid Studio file purpose." };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, error: "Choose a file before uploading." };
  if (buffer.length > STUDIO_FILE_LIMITS[kind]) {
    return { ok: false, error: kind === "BRIEF_ATTACHMENT" ? "Brief attachments must be 10 MB or smaller." : "Studio audio files must be 50 MB or smaller." };
  }

  if (kind !== "BRIEF_ATTACHMENT") return validateAudioUpload({ buffer, fileName, claimedType });

  const extension = extensionOf(fileName);
  const contentTypes = { pdf: "application/pdf", txt: "text/plain", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
  const contentType = contentTypes[extension];
  if (!contentType) return { ok: false, error: "Brief attachments must be PDF, TXT, PNG, or JPG files." };
  if (!matchesBriefSignature(buffer, extension)) return { ok: false, error: "The attachment contents do not match its file type." };
  if (claimedType && claimedType.toLowerCase() !== contentType) return { ok: false, error: "The attachment extension and reported media type do not match." };
  return { ok: true, extension: extension === "jpeg" ? "jpg" : extension, contentType };
}

export function safeStudioDownloadName(value) {
  const cleaned = String(value || "studio-file").replace(/[\r\n"\\/]/g, "_").trim();
  return cleaned.slice(0, 180) || "studio-file";
}

