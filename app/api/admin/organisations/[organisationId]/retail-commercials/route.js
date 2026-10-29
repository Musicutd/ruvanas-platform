import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { retailSetupOrigin } from "@/lib/retail-stream-setup-http.mjs";
import { createRetailCommercialOwnerHandlers } from "@/lib/retail-commercial-owner-http.mjs";
import { reviewRetailCommercialApproval, approveRetailCommercialDraft } from "@/lib/retail-commercial-approval.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createRetailCommercialOwnerHandlers({ getAdmin: requirePlatformAdmin,
  canonicalOrigin: () => retailSetupOrigin(process.env.RUVANAS_PUBLIC_URL, { allowLocalHttp: process.env.NODE_ENV === "development" }),
  review: options => reviewRetailCommercialApproval(prisma, options), approve: options => approveRetailCommercialDraft(prisma, options) });
export const GET = handlers.GET;
export const POST = handlers.POST;
