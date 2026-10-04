import { NextResponse } from "next/server";
import { authenticateCorrectionsEdge } from "@/lib/corrections-edge-service";
import { currentCorrectionsEdgeManifest } from "@/lib/corrections-edge-sync-service";
import { correctionsError } from "@/lib/corrections-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try { const node = await authenticateCorrectionsEdge(request);
    return NextResponse.json(await currentCorrectionsEdgeManifest(node), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return correctionsError(error); }
}
