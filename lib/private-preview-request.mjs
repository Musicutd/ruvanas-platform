export const PREVIEW_RESPONSE_HEADERS = Object.freeze({
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "same-origin",
  "x-robots-tag": "noindex, nofollow, noarchive"
});

export async function readPrivatePreviewBody(request, fields, { form = false } = {}) {
  const type = request.headers.get("content-type") || "";
  const isForm = /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(type);
  if (!(form && isForm) && !/^application\/json(?:\s*;|$)/i.test(type)) throw new Error("INVALID_BODY");
  const size = request.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > 4096)) throw new Error("INVALID_BODY");
  const reader = request.body?.getReader?.();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4096) {
      void reader.cancel().catch(() => {});
      throw new Error("INVALID_BODY");
    }
    chunks.push(value);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  let body;
  if (isForm) {
    const params = new URLSearchParams(text);
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new Error("INVALID_BODY");
    body = Object.fromEntries(params);
  } else body = JSON.parse(text);
  if (!body || Array.isArray(body) || typeof body !== "object" ||
      Object.keys(body).some((key) => !fields.includes(key))) throw new Error("INVALID_BODY");
  return body;
}
