export const RETAIL_COMMERCIAL_UPLOAD_LIMITS = Object.freeze({ maxFileBytes: 20 * 1024 * 1024,
  maxRequestBytes: 21 * 1024 * 1024, maxDurationSeconds: 300, maxUploads: 50, maxStorageBytes: 100 * 1024 * 1024 });
const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_COMMERCIAL_UPLOAD_${code}` }); };
const FIELDS = new Set(["file", "name", "mediaType", "languageCode", "requestId", "rightsConfirmed"]);
let activeUploads = 0;

export function retailCommercialUploadRequestBoundary(request, { write = false } = {}) {
  if ([...new URL(request.url).searchParams].length) fail("REQUEST_INVALID");
  if (write && (request.headers.get("origin") !== "https://www.ruvanas.com" || request.headers.get("sec-fetch-site") === "cross-site")) fail("ACCESS_DENIED");
}
// Bound total in-flight memory/probes, including chunked requests without a length header.
export async function withRetailCommercialUploadAdmission(operation) {
  if (activeUploads >= 2) fail("BUSY");
  activeUploads += 1;
  try { return await operation(); } finally { activeUploads -= 1; }
}
export async function readRetailCommercialUpload(request, { timeoutMs = 30_000 } = {}) {
  retailCommercialUploadRequestBoundary(request, { write: true });
  const type = request.headers.get("content-type") || "", size = request.headers.get("content-length");
  if (!/^multipart\/form-data;\s*boundary=(?:[A-Za-z0-9'()+_,.\/:=?-]{1,200}|"[^"\r\n]{1,200}")$/i.test(type) ||
      size !== null && (!/^\d+$/.test(size) || Number(size) > RETAIL_COMMERCIAL_UPLOAD_LIMITS.maxRequestBytes)) fail("FILE_TOO_LARGE");
  const reader = request.body?.getReader(); if (!reader) fail("REQUEST_INVALID");
  let timer, bytes = 0;
  const timedOut = new Promise((_, reject) => { timer = setTimeout(() => {
    void reader.cancel().catch(() => {}); reject(Object.assign(new Error("TIMEOUT"), { code: "RETAIL_COMMERCIAL_UPLOAD_TIMEOUT" }));
  }, timeoutMs); });
  try {
    const chunks = [];
    while (true) {
      const result = await Promise.race([reader.read(), timedOut]);
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > RETAIL_COMMERCIAL_UPLOAD_LIMITS.maxRequestBytes) { void reader.cancel().catch(() => {}); fail("FILE_TOO_LARGE"); }
      chunks.push(result.value);
    }
    if (size !== null && Number(size) !== bytes) fail("REQUEST_INVALID");
    let form;
    try { form = await new Response(Buffer.concat(chunks), { headers: { "content-type": type } }).formData(); }
    catch { fail("REQUEST_INVALID"); }
    const keys = [...form.keys()];
    if (keys.some(key => !FIELDS.has(key)) || new Set(keys).size !== keys.length) fail("REQUEST_INVALID");
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function" || typeof file.name !== "string" || !file.size) fail("FILE_INVALID");
    if (file.size > RETAIL_COMMERCIAL_UPLOAD_LIMITS.maxFileBytes) fail("FILE_TOO_LARGE");
    const result = Object.fromEntries([...form.entries()].filter(([key]) => key !== "file"));
    if (Object.values(result).some(value => typeof value !== "string")) fail("REQUEST_INVALID");
    return { ...result, fileName: file.name, claimedType: file.type, buffer: Buffer.from(await file.arrayBuffer()) };
  } finally { clearTimeout(timer); }
}

const MESSAGES = {
  ACCESS_DENIED: "Commercial uploads are available only in your authorised Test Retail workspace.",
  REQUEST_INVALID: "Check the recording details and try again.",
  FILE_INVALID: "Choose a valid MP3, WAV, OGG or M4A recording.",
  FILE_TOO_LARGE: "Choose an audio file of 20 MB or less.",
  DURATION_INVALID: "The recording must have a verified audio length of five minutes or less.",
  RIGHTS_REQUIRED: "Confirm that you have permission to use this commercial or announcement.",
  STORAGE_LIMIT: "This upload would exceed the Retail commercial storage allowance. Ask your administrator to review the stored recordings.",
  UPLOAD_LIMIT: "The Retail recording limit has been reached. Ask your administrator to review the stored recordings.",
  BUSY: "An upload is still being checked. Please wait and try again.",
  TIMEOUT: "The upload took too long. Please try again with a stable connection.",
  RETRY_CHANGED: "This upload request changed. Select the recording again and retry.",
  STORAGE_FAILED: "The recording could not be stored. Please try again.",
  STORAGE_REVIEW: "This recording needs an administrator storage check before retrying. Your music stream is unchanged."
};
export function retailCommercialUploadError(error) {
  const key = String(error?.code || "").replace(/^RETAIL_COMMERCIAL_UPLOAD_/, "");
  const known = Object.hasOwn(MESSAGES, key), code = known ? error.code : "RETAIL_COMMERCIAL_UPLOAD_FAILED";
  return { code, error: known ? MESSAGES[key] : "Unable to upload this recording. Please try again.",
    status: key === "ACCESS_DENIED" ? 403 : ["FILE_TOO_LARGE", "STORAGE_LIMIT", "UPLOAD_LIMIT"].includes(key) ? 413 :
      ["RETRY_CHANGED", "STORAGE_REVIEW"].includes(key) ? 409 : key === "BUSY" ? 429 : key === "TIMEOUT" ? 408 :
      !known || key === "STORAGE_FAILED" ? 503 : 400 };
}
