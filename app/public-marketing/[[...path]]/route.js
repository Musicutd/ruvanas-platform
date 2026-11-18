import { readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { publicMarketingResponse } from "@/lib/private-preview-public-site-response.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request) {
  return publicMarketingResponse(request, { policy: readPrivatePreviewPolicy() });
}

export function HEAD(request) {
  return publicMarketingResponse(request, { policy: readPrivatePreviewPolicy() });
}
