import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { createCorrectionsEdgeNode } from "@/lib/corrections-edge-service";
import { correctionsError } from "@/lib/corrections-http";
import { correctionsEdgeEffectiveStatus } from "@/lib/corrections-edge-status.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ organisationId: z.string().cuid(), facilityId: z.string().cuid(),
  name: z.string().trim().min(1).max(100) });

async function superAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok || access.user.role !== "SUPER_ADMIN") return null;
  return access.user;
}

export async function GET(request) {
  const actor = await superAdmin();
  if (!actor) return NextResponse.json({ error: "Super Admin access required." }, { status: 403 });
  const organisationId = new URL(request.url).searchParams.get("organisationId");
  const nodes = await prisma.correctionsEdgeNode.findMany({ where: organisationId ? { organisationId } : {},
    orderBy: { createdAt: "desc" }, take: 200, select: { id: true, organisationId: true, facilityId: true, name: true,
      status: true, keyVersion: true, enrolledAt: true, lastSeenAt: true, lastSyncAt: true, lastSuccessfulSyncAt: true,
      softwareVersion: true, storageHealth: true, syncStatus: true, pendingProofCount: true, cachedContentCount: true,
      revokedAt: true, lastProofSequence: true, organisation: { select: { name: true } },
      facility: { select: { name: true } }, manifests: { orderBy: { sequence: "desc" }, take: 1,
        select: { sequence: true, version: true, validUntil: true } } } });
  const now = new Date();
  return NextResponse.json({ nodes: nodes.map((node) => ({ ...node,
    effectiveStatus: correctionsEdgeEffectiveStatus(node, now) })) },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request) {
  const actor = await superAdmin();
  if (!actor) return NextResponse.json({ error: "Super Admin access required." }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select an organisation, facility and node name." }, { status: 400 });
  try {
    const result = await createCorrectionsEdgeNode({ ...parsed.data, actorUserId: actor.id });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return correctionsError(error); }
}
