import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

const schema = z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]) });

export async function PATCH(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can change music mode status." }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid music mode status." }, { status: 400 });
    const existing = await prisma.musicMode.findUnique({ where: { id: params.musicModeId }, include: { _count: { select: { tracks: true } } } });
    if (!existing) return NextResponse.json({ error: "Music mode not found." }, { status: 404 });
    if (parsed.data.status === "ACTIVE" && existing._count.tracks === 0) return NextResponse.json({ error: "Add at least one approved track before activating this music mode." }, { status: 400 });

    const mode = await prisma.$transaction(async (tx) => {
      const updated = await tx.musicMode.update({ where: { id: existing.id }, data: { status: parsed.data.status } });
      await tx.auditLog.create({ data: {
        organisationId: existing.organisationId,
        actorUserId: access.user.id,
        action: parsed.data.status === "ACTIVE" ? "MUSIC_MODE_ACTIVATED" : "MUSIC_MODE_ARCHIVED",
        entityType: "MusicMode",
        entityId: existing.id,
        details: { previousStatus: existing.status, status: parsed.data.status }
      } });
      return updated;
    });
    return NextResponse.json({ ok: true, mode });
  } catch (error) {
    console.error("Update music mode status error:", error);
    return NextResponse.json({ error: "Unable to update the music mode." }, { status: 500 });
  }
}
