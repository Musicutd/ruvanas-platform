const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_COMMERCIAL_${code}` }); };
export function retailCommercialQuery(request) {
  if ([...new URL(request.url).searchParams].length) fail("QUERY_INVALID");
}
export async function retailCommercialCommand(request) {
  if (request.headers.get("origin") !== "https://www.ruvanas.com" || request.headers.get("sec-fetch-site") === "cross-site") fail("ORIGIN_INVALID");
  const maximum = 48 * 1024, size = request.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "") ||
      size !== null && (!/^\d+$/.test(size) || Number(size) > maximum)) fail("BODY_INVALID");
  const reader = request.body?.getReader(); if (!reader) fail("BODY_INVALID");
  const chunks = []; let bytes = 0;
  while (true) { const result = await reader.read(); if (result.done) break; bytes += result.value.byteLength;
    if (bytes > maximum) { void reader.cancel().catch(() => {}); fail("BODY_INVALID"); } chunks.push(result.value); }
  let input;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { fail("BODY_INVALID"); }
  if (!input || typeof input !== "object" || Array.isArray(input) || input.action !== "save" ||
      Object.keys(input).some(key => !["action", "requestId", "baseVersionId", "name", "timezone", "rules"].includes(key))) fail("BODY_INVALID");
  return input;
}
export function retailCommercialErrorStatus(code) {
  if (["RETAIL_COMMERCIAL_ACCESS_DENIED", "RETAIL_COMMERCIAL_ORIGIN_INVALID"].includes(code)) return 403;
  if (["RETAIL_COMMERCIAL_DRAFT_CHANGED", "RETAIL_COMMERCIAL_RETRY_CHANGED", "RETAIL_COMMERCIAL_SPOT_UNAVAILABLE", "RETAIL_COMMERCIAL_HISTORY_INVALID"].includes(code)) return 409;
  return code === "RETAIL_COMMERCIAL_FAILED" ? 503 : 400;
}
