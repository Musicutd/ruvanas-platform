import { reversalHttp } from "@/lib/retail-rewards/reversal-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = request => reversalHttp.locations(request);
