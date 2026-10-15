import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPrivatePreviewPublicPath } from "./private-preview-policy.mjs";
import { publicMarketingDocument } from "./private-preview-public-site.mjs";

const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow, noarchive"
});

function denied(status, method) {
  return new Response(method === "HEAD" ? null : status === 503 ? "Website temporarily unavailable." : "Not found.", {
    status, headers: { ...SECURITY_HEADERS, "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" }
  });
}

// The request never supplies a filename. Only the two fixed internal documents
// can reach readFile, and their exact published bytes are checked before use.
export async function publicMarketingResponse(request, { policy, read = readFile } = {}) {
  let pathname;
  try { pathname = new URL(request.url).pathname; } catch { return denied(404, request.method); }
  // Reverse proxies can preserve the original URL after the middleware rewrite.
  // Resolve only the same three public aliases already permitted by policy;
  // forwarded/original/rewrite headers never select a document or filename.
  const documentPath = pathname === "/" ? "/public-marketing/index.html"
    : pathname === "/how-it-works" || pathname === "/how-it-works/"
      ? "/public-marketing/how-it-works/index.html" : pathname;
  const document = publicMarketingDocument(documentPath);
  if (!policy?.enabled || !policy.valid || policy.publicSite !== true || !document ||
      !isPrivatePreviewPublicPath(pathname, policy)) return denied(404, request.method);
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(null, { status: 405, headers: { ...SECURITY_HEADERS, "cache-control": "no-store", Allow: "GET, HEAD" } });
  }
  try {
    const bytes = await read(join(process.cwd(), "assets", "private-preview-public-site", document.file));
    if (!Buffer.isBuffer(bytes) || bytes.length !== document.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== document.sha256) return denied(503, request.method);
    return new Response(request.method === "HEAD" ? null : bytes, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "cache-control": "public, max-age=300, must-revalidate",
        "content-type": "text/html; charset=utf-8",
        "content-length": String(document.bytes),
        etag: `"${document.sha256}"`
      }
    });
  } catch { return denied(503, request.method); }
}
