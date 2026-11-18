const MAX_BYTES = 20 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_RECORDING_REVIEW_${code}` }); };
export function retailPreviewRequest(request) {
  const url = new URL(request.url), values = url.searchParams.getAll("versionId");
  if (!["GET", "HEAD"].includes(request.method) || values.length !== 1 ||
      [...url.searchParams.keys()].some(key => key !== "versionId") || !/^[A-Za-z0-9_-]{1,191}$/.test(values[0])) fail("INVALID");
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if (origin && origin !== "https://www.ruvanas.com" || site && !["same-origin", "none"].includes(site)) fail("ACCESS_DENIED");
  return values[0];
}
export function retailPreviewRange(header, total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > MAX_BYTES) fail("VALIDATION_REQUIRED");
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) return "invalid";
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start ||
      !match[1] && (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) <= 0)) return "invalid";
  return { start, end };
}
export function retailPreviewHeaders(recording, range) {
  const headers = new Headers({ "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Accept-Ranges": "bytes",
    "Content-Type": recording.mimeType, "Content-Length": String(range ? range.end - range.start + 1 : recording.sizeBytes),
    "Content-Disposition": "inline" });
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${recording.sizeBytes}`);
  return headers;
}
// The response has a hard byte/deadline bound, and never redirects to storage.
export function boundedRetailPreviewBody(body, expectedBytes, { timeoutMs = 60_000 } = {}) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_BYTES) fail("VALIDATION_REQUIRED");
  const stream = typeof body?.transformToWebStream === "function" ? body.transformToWebStream() : body;
  if (!stream?.getReader) fail("VALIDATION_REQUIRED");
  const reader = stream.getReader(); let received = 0, timer, finished = false;
  const cleanup = () => { finished = true; clearTimeout(timer); };
  return new ReadableStream({
    start(controller) { timer = setTimeout(() => { if (finished) return; cleanup(); void reader.cancel().catch(() => {}); controller.error(new Error("Preview timed out")); }, timeoutMs); },
    async pull(controller) {
      try {
        const part = await reader.read(); if (finished) return;
        if (part.done) { cleanup(); if (received !== expectedBytes) controller.error(new Error("Incomplete preview")); else controller.close(); return; }
        received += part.value.byteLength;
        if (received > expectedBytes) { cleanup(); void reader.cancel().catch(() => {}); controller.error(new Error("Invalid preview length")); return; }
        controller.enqueue(part.value);
      } catch { if (!finished) { cleanup(); controller.error(new Error("Preview unavailable")); } }
    },
    cancel(reason) { cleanup(); return reader.cancel(reason); }
  });
}
