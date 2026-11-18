import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { retailSetupOrigin } from "@/lib/retail-stream-setup-http.mjs";
import { createRetailPlayoutHandlers } from "@/lib/retail-stream-playout-http.mjs";
import { RetailPlayoutError, loadRetailPlayoutReadiness, prepareRetailPlayout, startRetailPlayout, stopRetailPlayout } from "@/lib/retail-stream-playout-service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createRetailPlayoutHandlers({
  getAdmin: requirePlatformAdmin,
  canonicalOrigin: () => retailSetupOrigin(process.env.RUVANAS_PUBLIC_URL, { allowLocalHttp: process.env.NODE_ENV === "development" }),
  loadReadiness: options => loadRetailPlayoutReadiness(prisma, options),
  prepare: options => prepareRetailPlayout(prisma, options),
  start: options => startRetailPlayout(prisma, options),
  stop: options => stopRetailPlayout(prisma, options),
  publicFailure: error => error instanceof RetailPlayoutError ? { status: error.status, code: error.code } : null
});
export const GET = handlers.GET;
export const POST = handlers.POST;
