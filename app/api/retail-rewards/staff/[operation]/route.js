import { staffAdminHttp } from "@/lib/retail-rewards/staff-admin-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request, context) { return staffAdminHttp.run(request, (await context.params).operation); }
export async function POST(request, context) { return staffAdminHttp.run(request, (await context.params).operation); }
