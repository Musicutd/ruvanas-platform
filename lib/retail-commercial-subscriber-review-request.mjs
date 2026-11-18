const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_RECORDING_REVIEW_${code}` }); };
export const RETAIL_RECORDING_REVIEW_MAX_BYTES = 8192;
export function retailRecordingReviewBoundary(request) {
  if ([...new URL(request.url).searchParams].length) fail("INVALID");
  if (request.headers.get("origin") !== "https://www.ruvanas.com" || request.headers.get("sec-fetch-site") === "cross-site") fail("ACCESS_DENIED");
}
export function normaliseRetailRecordingReview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["versionId", "decision", "rightsConfirmed", "notes"].includes(key)) ||
      typeof input.versionId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(input.versionId) ||
      !["APPROVE", "REJECT"].includes(input.decision) ||
      input.rightsConfirmed !== undefined && typeof input.rightsConfirmed !== "boolean" ||
      input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 1000 || /[\u0000-\u001f\u007f]/.test(input.notes))) fail("INVALID");
  if (input.decision === "APPROVE" && input.rightsConfirmed !== true) fail("RIGHTS_REQUIRED");
  const notes = (input.notes || "").trim();
  if (input.decision === "REJECT" && !notes) fail("NOTES_REQUIRED");
  return { versionId: input.versionId, decision: input.decision, rightsConfirmed: input.decision === "APPROVE", notes };
}
export async function readRetailRecordingReview(request, { timeoutMs = 10_000 } = {}) {
  retailRecordingReviewBoundary(request);
  const type = request.headers.get("content-type") || "", size = request.headers.get("content-length");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) ||
      size !== null && (!/^\d+$/.test(size) || Number(size) > RETAIL_RECORDING_REVIEW_MAX_BYTES)) fail("INVALID");
  const reader = request.body?.getReader(); if (!reader) fail("INVALID");
  let timer, bytes = 0;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
    reject(Object.assign(new Error("TIMEOUT"), { code: "RETAIL_RECORDING_REVIEW_TIMEOUT" })); void reader.cancel().catch(() => {});
  }, timeoutMs); });
  try {
    const chunks = [];
    while (true) {
      const result = await Promise.race([reader.read(), timeout]); if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > RETAIL_RECORDING_REVIEW_MAX_BYTES) { void reader.cancel().catch(() => {}); fail("INVALID"); }
      chunks.push(result.value);
    }
    if (size !== null && Number(size) !== bytes) fail("INVALID");
    let input; try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { fail("INVALID"); }
    return normaliseRetailRecordingReview(input);
  } finally { clearTimeout(timer); }
}
const MESSAGES = {
  ACCESS_DENIED: "Use your authorised Retail workspace to review your own recordings.",
  INVALID: "Check the recording and review details, then try again.",
  RIGHTS_REQUIRED: "Confirm that you take responsibility for this recording and have permission to play it in your shops.",
  NOTES_REQUIRED: "Explain what needs changing before rejecting this recording.",
  NOT_FOUND: "This recording is not available in your Retail library.",
  VALIDATION_REQUIRED: "This recording needs a successful audio check before it can be approved.",
  CHANGED: "This recording has already changed. Refresh your recordings before reviewing it.",
  TIMEOUT: "The review request took too long. Please try again."
};
export function retailRecordingReviewError(error) {
  const code = String(error?.code || ""), key = code.replace(/^RETAIL_RECORDING_REVIEW_/, "");
  if (code === "RETAIL_COMMERCIAL_UPLOAD_ACCESS_DENIED") return { code: "RETAIL_RECORDING_REVIEW_ACCESS_DENIED", error: MESSAGES.ACCESS_DENIED, status: 403 };
  const known = Object.hasOwn(MESSAGES, key);
  return { code: known ? code : "RETAIL_RECORDING_REVIEW_FAILED", error: known ? MESSAGES[key] : "This recording could not be reviewed. Please refresh and try again.",
    status: key === "ACCESS_DENIED" ? 403 : key === "NOT_FOUND" ? 404 : ["CHANGED", "VALIDATION_REQUIRED"].includes(key) ? 409 : key === "TIMEOUT" ? 408 : known ? 400 : 503 };
}
