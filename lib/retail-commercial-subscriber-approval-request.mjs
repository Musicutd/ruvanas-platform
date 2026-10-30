const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_COMMERCIAL_${code}` }); };

export function retailSubscriberCommercialApprovalQuery(request) {
  if ([...new URL(request.url).searchParams].length) fail("REQUEST_INVALID");
}

export async function retailSubscriberCommercialApprovalCommand(request, { timeoutMs = 10_000 } = {}) {
  retailSubscriberCommercialApprovalQuery(request);
  if (request.headers.get("origin") !== "https://www.ruvanas.com" || request.headers.get("sec-fetch-site") === "cross-site") fail("ACCESS_DENIED");
  const maximum = 4 * 1024, size = request.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "") ||
      size !== null && (!/^\d+$/.test(size) || Number(size) > maximum)) fail("REQUEST_INVALID");
  const reader = request.body?.getReader(); if (!reader) fail("REQUEST_INVALID");
  let timer, bytes = 0;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
    void reader.cancel().catch(() => {}); reject(Object.assign(new Error("REQUEST_INVALID"), { code: "RETAIL_COMMERCIAL_REQUEST_INVALID" }));
  }, timeoutMs); });
  try {
    const chunks = [];
    while (true) {
      const result = await Promise.race([reader.read(), deadline]); if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximum) { void reader.cancel().catch(() => {}); fail("REQUEST_INVALID"); }
      chunks.push(result.value);
    }
    if (size !== null && Number(size) !== bytes) fail("REQUEST_INVALID");
    let input;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { fail("REQUEST_INVALID"); }
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(key => !["draftId", "reviewHash", "baseApprovalId", "requestId", "responsibilityConfirmed"].includes(key))) fail("REQUEST_INVALID");
    return input;
  } finally { clearTimeout(timer); }
}
