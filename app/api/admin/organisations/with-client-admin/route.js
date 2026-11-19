import { ordinaryOwnerHttp } from "@/lib/ordinary-owner-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request) {
  return ordinaryOwnerHttp.run(request);
}
