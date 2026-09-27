import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/access-control";
import { rotateCorrectionsEdgeCredential, revokeCorrectionsEdgeNode } from "@/lib/corrections-edge-service";
import { correctionsError } from "@/lib/corrections-http";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok || access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Super Admin access required." }, { status: 403 });
  const action = (await request.json().catch(() => null))?.action;
  const { nodeId } = await params;
  try {
    if (action === "ROTATE_CREDENTIAL") return NextResponse.json(await rotateCorrectionsEdgeCredential(nodeId, access.user.id),
      { headers: { "Cache-Control": "no-store" } });
    if (action === "REVOKE" || action === "DECOMMISSION") return NextResponse.json(await revokeCorrectionsEdgeNode(nodeId, access.user.id, action === "DECOMMISSION"),
      { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "Choose a supported Edge action." }, { status: 400 });
  } catch (error) { return correctionsError(error); }
}
