import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateCorrectionsEdge, recordCorrectionsEdgeHeartbeat } from "@/lib/corrections-edge-service";
import { correctionsError } from "@/lib/corrections-http";

export const runtime = "nodejs";
const schema = z.object({ softwareVersion: z.string().trim().min(1).max(60),
  storageHealth: z.enum(["HEALTHY", "DEGRADED", "FAILED"]),
  syncStatus: z.enum(["IDLE", "SYNCING", "DEGRADED"]),
  pendingProofCount: z.number().int().min(0).max(1_000_000),
  cachedContentCount: z.number().int().min(0).max(1_000_000) });

export async function POST(request) {
  try {
    const node = await authenticateCorrectionsEdge(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid bounded Edge health report." }, { status: 400 });
    return NextResponse.json(await recordCorrectionsEdgeHeartbeat(node, parsed.data),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return correctionsError(error); }
}
