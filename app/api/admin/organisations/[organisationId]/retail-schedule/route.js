import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { retailSetupOrigin } from "@/lib/retail-stream-setup-http.mjs";
import { createRetailOwnerScheduleHandlers } from "@/lib/retail-owner-schedule-http.mjs";
import { retailOwnerScheduleDashboard, approveRetailOwnerSchedule, prepareRetailOwnerScheduleTest } from "@/lib/retail-owner-schedule-service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createRetailOwnerScheduleHandlers({ getAdmin: requirePlatformAdmin,
  canonicalOrigin: () => retailSetupOrigin(process.env.RUVANAS_PUBLIC_URL, { allowLocalHttp: process.env.NODE_ENV === "development" }),
  dashboard: options => retailOwnerScheduleDashboard(prisma, options), approve: options => approveRetailOwnerSchedule(prisma, options),
  prepareTest: options => prepareRetailOwnerScheduleTest(prisma, options) });
export const GET = handlers.GET;
export const POST = handlers.POST;
