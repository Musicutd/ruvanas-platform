import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateCorrectionsEdge } from "@/lib/corrections-edge-service";
import { correctionsError } from "@/lib/corrections-http";

export const runtime = "nodejs";
const schema = z.object({ sequence: z.number().int().positive(), version: z.string().regex(/^[a-f0-9]{64}$/),
  downloaded: z.number().int().min(0).max(500), reused: z.number().int().min(0).max(500) });

export async function POST(request) {
  try {
    const node = await authenticateCorrectionsEdge(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Edge sync receipt." }, { status: 400 });
    const now = new Date();
    const manifest = await prisma.correctionsEdgeManifest.findFirst({ where: { nodeId: node.id,
      sequence: parsed.data.sequence, version: parsed.data.version, validUntil: { gt: now } },
      select: { id: true, payload: true } });
    if (!manifest) return NextResponse.json({ error: "The current signed Edge manifest was not applied." }, { status: 409 });
    const latest = await prisma.correctionsEdgeManifest.findFirst({ where: { nodeId: node.id }, orderBy: { sequence: "desc" },
      select: { id: true } });
    if (latest?.id !== manifest.id) return NextResponse.json({ error: "A newer Edge manifest is available." }, { status: 409 });
    if (parsed.data.downloaded + parsed.data.reused !== manifest.payload.content.length) {
      return NextResponse.json({ error: "The Edge receipt does not cover the authorised content." }, { status: 409 });
    }
    const changed = await prisma.correctionsEdgeNode.updateMany({ where: { id: node.id, status: "ACTIVE",
      credentialHash: node.credentialHash }, data: { lastSeenAt: now, lastSuccessfulSyncAt: now,
      lastSyncAt: now, syncStatus: "IDLE", cachedContentCount: manifest.payload.content.length } });
    if (changed.count !== 1) return NextResponse.json({ error: "The Edge machine was revoked or rotated." }, { status: 401 });
    await prisma.auditLog.create({ data: { organisationId: node.organisationId, action: "CORRECTIONS_EDGE_SYNC_CONFIRMED",
      entityType: "CorrectionsEdgeNode", entityId: node.id, details: { facilityId: node.facilityId,
        sequence: parsed.data.sequence, version: parsed.data.version, downloaded: parsed.data.downloaded,
        reused: parsed.data.reused, selfReported: true } } });
    return NextResponse.json({ ok: true, receivedAt: now.toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return correctionsError(error); }
}
