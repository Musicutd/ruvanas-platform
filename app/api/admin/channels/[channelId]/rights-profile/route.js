import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

const RIGHTS_USES = new Set(["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO", "HEALTH_RADIO", "FAITH_RADIO", "ORGANISATIONS_RADIO"]);

export async function PUT(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    const { channelId } = await params;
    const { musicRightsUse } = await request.json().catch(() => ({}));
    if (!RIGHTS_USES.has(musicRightsUse)) return NextResponse.json({ error: "Choose a valid music-rights profile." }, { status: 400 });
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, organisationId: true, stationId: true, musicRightsUse: true } });
    if (!channel) return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    if (channel.stationId || channel.musicRightsUse) return NextResponse.json({ error: "This channel already has a rights profile or a linked station. Existing rights profiles cannot be changed here." }, { status: 409 });
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.channel.updateMany({ where: { id: channel.id, organisationId: channel.organisationId, stationId: null, musicRightsUse: null }, data: { musicRightsUse } });
      if (changed.count !== 1) return false;
      await tx.auditLog.create({ data: { organisationId: channel.organisationId, actorUserId: access.user.id, action: "CHANNEL_RIGHTS_PROFILE_CLASSIFIED", entityType: "Channel", entityId: channel.id, details: { musicRightsUse } } });
      return true;
    });
    if (!updated) return NextResponse.json({ error: "This channel changed. Refresh and try again." }, { status: 409 });
    return NextResponse.json({ ok: true, musicRightsUse });
  } catch (error) {
    console.error("Classify channel rights profile error:", error);
    return NextResponse.json({ error: "Unable to classify this channel." }, { status: 500 });
  }
}
