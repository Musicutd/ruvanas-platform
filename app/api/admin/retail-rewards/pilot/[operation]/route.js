import { pilotAdminHttp } from "@/lib/retail-rewards/pilot-admin-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request, context) {
  const { operation } = await context.params;
  return pilotAdminHttp.run(request, operation);
}
export const GET = handle;
export const POST = handle;
