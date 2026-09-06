import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { protectedAudioResponse } from "@/lib/protected-audio-response";
import { isCatalogueLicenceCurrent } from "@/lib/catalogue-upload.mjs";
import { isPlayerListenerTokenActive } from "@/lib/player-listener-lease.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED") return NextResponse.json({ error: "This player is not enrolled or has been disabled." }, { status: 401 });
    const listenerToken = request.nextUrl.searchParams.get("listener");
    const listenerActive = await isPlayerListenerTokenActive(prisma, { player, token: listenerToken });
    if (!listenerActive) {
      return NextResponse.json({ error: "This player does not have an active listener slot." }, { status: 429 });
    }

    const mediaAssetId = String(params.mediaAssetId || "");
    const instant = new Date();
    const { resolution, campaignPlayout, schoolPlayout } = await resolvePlayerProgramming(player, instant);
    const isEligibleMusic = (resolution.musicMode?.tracks || []).some(({ track }) =>
      track.status === "READY" &&
      track.mediaAsset?.id === mediaAssetId &&
      track.mediaAsset.status === "READY" &&
      track.mediaAsset.libraryType === "RUVANAS_CATALOGUE" &&
      track.mediaAsset.mediaType === "MUSIC" &&
      track.mediaAsset.organisationId === null &&
      isCatalogueLicenceCurrent(track.licenceExpiresAt, instant)
    );
    const isCurrentPromo = (campaignPlayout.insertions || []).some((item) => item.mediaAssetId === mediaAssetId);
    const isCurrentSchoolAnnouncement = (schoolPlayout.insertions || []).some((item) => item.mediaAssetId === mediaAssetId);
    const recentInsertionIntent = isCurrentPromo || isCurrentSchoolAnnouncement ? null : await prisma.playoutIntent.findFirst({
      where: {
        playerId: player.id,
        organisationId: player.organisationId,
        zoneId: player.zoneId,
        mediaAssetId,
        plannedStart: { gte: new Date(instant.getTime() - 15 * 60 * 1000) },
        expiresAt: { gt: instant }
      },
      select: { id: true }
    });
    if (!isEligibleMusic && !isCurrentPromo && !isCurrentSchoolAnnouncement && !recentInsertionIntent) {
      return NextResponse.json({ error: "This audio is not in the player's current playback plan." }, { status: 404 });
    }

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: mediaAssetId },
      select: { storageKey: true, mimeType: true, sizeBytes: true }
    });
    return protectedAudioResponse(request, asset);
  } catch (error) {
    console.error("Player media stream failed:", error);
    return NextResponse.json({ error: "The audio file could not be played." }, { status: 500 });
  }
}

