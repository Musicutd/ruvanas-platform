import { catalogueRequestSizePolicy, MAX_CATALOGUE_BULK_REQUEST_BYTES } from "./catalogue-request-limits.mjs";

export class CatalogueBulkRequestError extends Error {
  constructor(message, status = 413) {
    super(message);
    this.name = "CatalogueBulkRequestError";
    this.status = status;
  }
}

// The existing single-instance host processes only one bulk parse/extraction
// at a time. This does not claim to prevent Next's earlier middleware cloning.
let active = false;
export function acquireCatalogueBulkRequest() {
  if (active) return null;
  active = true;
  let released = false;
  return () => {
    if (!released) { released = true; active = false; }
  };
}

export async function readCatalogueBulkFormData(request, { maxBytes = MAX_CATALOGUE_BULK_REQUEST_BYTES, timeoutMs = 300_000 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("Invalid multipart request limit.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new RangeError("Invalid multipart read deadline.");
  const tooLarge = () => new CatalogueBulkRequestError(catalogueRequestSizePolicy("/api/admin/catalogue/bulk-upload").error);
  // Next's middleware clone can silently drop a whole crossing chunk. A
  // counted clone alone therefore cannot establish the original wire size.
  // Browser File/FormData uploads have a known length: require it and verify
  // it against the fully consumed stream, rather than allow chunked uploads.
  const cancelBody = () => {
    // A cloned request's cancellation may wait for its other branch.
    if (request.body) void request.body.cancel().catch(() => {});
  };
  const rawLength = request.headers.get("content-length");
  if (rawLength === null) {
    cancelBody();
    throw new CatalogueBulkRequestError("The upload size is missing. Use the Ruvanas bulk upload form in your browser and try again.", 411);
  }
  const declared = Number(rawLength);
  if (!/^\d+$/.test(rawLength) || !Number.isSafeInteger(declared) || declared < 1) {
    cancelBody();
    throw new CatalogueBulkRequestError("The upload size is invalid. Choose the files in the Ruvanas bulk upload form and try again.", 400);
  }
  if (declared > maxBytes) {
    cancelBody();
    throw tooLarge();
  }
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) {
    throw new CatalogueBulkRequestError("Choose a music ZIP and CSV or XLSX spreadsheet.", 400);
  }
  const reader = request.body.getReader();
  let bytes = 0;
  let limitError = null;
  let interruptionError = null;
  let finished = false;
  let bodyController;
  const bounded = new ReadableStream({
    start(controller) { bodyController = controller; },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { finished = true; controller.close(); return; }
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          limitError = tooLarge();
          controller.error(limitError);
          void reader.cancel(limitError).catch(() => {});
          return;
        }
        controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { void reader.cancel(reason).catch(() => {}); }
  });
  const interrupt = (message) => {
    if (finished || limitError || interruptionError) return;
    interruptionError = new CatalogueBulkRequestError(message, 408);
    // Error the parser-facing stream as well as cancelling its source: a
    // stalled reader or cloned-branch cancellation must not hold the lease.
    bodyController.error(interruptionError);
    void reader.cancel(interruptionError).catch(() => {});
  };
  const onAbort = () => interrupt("The batch upload was interrupted. Choose the files again and retry Check files.");
  const deadline = setTimeout(() => interrupt("The batch upload took too long. Choose the files again and retry Check files."), timeoutMs);
  request.signal?.addEventListener("abort", onAbort, { once: true });
  if (request.signal?.aborted) onAbort();
  let formData;
  try {
    // Native multipart parsing consumes the counted stream directly. Do not
    // concatenate a second full request buffer alongside the parsed Files.
    formData = await new Response(bounded, { headers: { "content-type": contentType } }).formData();
  } catch {
    if (limitError) throw limitError;
    if (interruptionError) throw interruptionError;
    throw new CatalogueBulkRequestError("The batch upload could not be read. Choose the ZIP and spreadsheet again.", 400);
  } finally {
    clearTimeout(deadline);
    request.signal?.removeEventListener("abort", onAbort);
    if (!finished) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* An upstream cancellation may still be settling. */ }
  }
  if (bytes !== declared) {
    throw new CatalogueBulkRequestError("The upload size did not match the received files. Choose the ZIP and spreadsheet again and retry Check files.", 400);
  }
  return formData;
}
