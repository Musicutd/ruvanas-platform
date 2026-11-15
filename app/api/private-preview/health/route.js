import { readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";

const HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive"
});

function healthStatus() {
  const policy = readPrivatePreviewPolicy();
  if (!policy.enabled) return 404;
  return policy.valid ? 200 : 503;
}

export function GET() {
  const status = healthStatus();
  return new Response(status === 200 ? "OK" : null, { status, headers: HEADERS });
}

export function HEAD() {
  return new Response(null, { status: healthStatus(), headers: HEADERS });
}
