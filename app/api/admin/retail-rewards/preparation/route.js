import { pilotPreparationHttp } from "@/lib/retail-rewards/pilot-preparation-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handle = request => pilotPreparationHttp.run(request);
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
