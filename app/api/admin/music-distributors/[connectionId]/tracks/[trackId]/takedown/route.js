import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

const schema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export async function POST(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can apply an emergency takedown." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Record a takedown reason." }, { status: 400 });
  const item = await prisma.musicDistributorTrack.findFirst({ where: { id: params.trackId, connectionId: params.connectionId } });
  if (!item) return NextResponse.json({ error: "Distributor track not found." }, { status: 404 });
  if (item.status === "TAKEN_DOWN") return NextResponse.json({ result: { alreadyTakenDown: true } });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.musicDistributorTrack.update({ where: { id: item.id }, data: { status: "TAKEN_DOWN", takedownReason: parsed.data.reason, takenDownAt: now, revision: { increment: 1 } } });
    if (item.trackId) await tx.track.updateMany({ where: { id: item.trackId }, data: { status: "ARCHIVED" } });
    await tx.musicDistributorReconciliationEvent.create({ data: { connectionId: item.connectionId, distributorTrackId: item.id, externalTrackId: item.externalTrackId, action: "TAKEN_DOWN", previousChecksum: item.metadataChecksum, currentChecksum: item.metadataChecksum, details: { source: "SUPER_ADMIN", reason: parsed.data.reason } } });
    await tx.auditLog.create({ data: { actorUserId: access.user.id, action: "MUSIC_DISTRIBUTOR_TRACK_TAKEN_DOWN", entityType: "MusicDistributorTrack", entityId: item.id, details: { providerTrackId: item.externalTrackId, reason: parsed.data.reason } } });
  });
  return NextResponse.json({ result: { takenDown: true }, notice: "The track was removed from eligibility immediately." });
}
