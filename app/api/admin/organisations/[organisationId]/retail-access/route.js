import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { retailSetupOrigin } from "@/lib/retail-stream-setup-http.mjs";
import { loadRetailPilotAccessProposal, changeRetailPilotAccess } from "@/lib/retail-stream-pilot-access.mjs";
import { createRetailPilotAccessHandlers } from "@/lib/retail-stream-pilot-access-http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createRetailPilotAccessHandlers({ getAdmin: requirePlatformAdmin,
  canonicalOrigin: () => retailSetupOrigin(process.env.RUVANAS_PUBLIC_URL, { allowLocalHttp: process.env.NODE_ENV === "development" }),
  proposal: options => loadRetailPilotAccessProposal(prisma, options),
  change: options => changeRetailPilotAccess(prisma, options) });
export const GET = handlers.GET;
export const POST = handlers.POST;
