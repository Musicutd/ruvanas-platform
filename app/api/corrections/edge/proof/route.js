import { NextResponse } from "next/server";
import { authenticateCorrectionsEdge } from "@/lib/corrections-edge-service";
import { ingestCorrectionsEdgeProof } from "@/lib/corrections-edge-proof-service";
import { correctionsError } from "@/lib/corrections-http";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const node = await authenticateCorrectionsEdge(request);
    const body = await request.json();
    return NextResponse.json(await ingestCorrectionsEdgeProof(node, body?.records),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return correctionsError(error); }
}
