import { reportingHttp } from "@/lib/retail-rewards/reporting-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = request => reportingHttp.exportReport(request);
