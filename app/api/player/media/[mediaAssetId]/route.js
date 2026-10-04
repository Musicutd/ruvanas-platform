import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { protectedAudioResponse } from "@/lib/protected-audio-response";
import { isCatalogueLicenceCurrent } from "@/lib/catalogue-upload.mjs";
import { isPlayerListenerTokenActive } from "@/lib/player-listener-lease.mjs";
import { GENERAL_STUDIO_MEDIA_ASSET_WHERE } from "@/lib/studio-general-asset-boundary.mjs";
import { schoolMediaIntentIsCurrent } from "@/lib/school-player-media.mjs";

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
    const { resolution, campaignPlayout, schoolPlayout, correctionsPlayout } = await resolvePlayerProgramming(player, instant);
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
    const isCurrentInsideAudio = (correctionsPlayout?.insertions || []).some((item) => item.mediaAssetId === mediaAssetId);
    const recentInsertionIntents = resolution.reason === "CORRECTIONS_PRIVATE" || isCurrentPromo || isCurrentSchoolAnnouncement || isCurrentInsideAudio ? [] : await prisma.playoutIntent.findMany({
      where: {
        playerId: player.id,
        organisationId: player.organisationId,
        zoneId: player.zoneId,
        mediaAssetId,
        cancelledAt: null,
        correctionsRequestId: null,
        correctionsRehabContentId: null,
        correctionsProgrammeId: null,
        correctionsSubmissionId: null,
        correctionsTrackId: null,
        correctionsAnnouncementId: null,
        correctionsOverrideId: null,
        plannedStart: { gte: new Date(instant.getTime() - 15 * 60 * 1000) },
        expiresAt: { gt: instant }
      },
      select: {
        scheduleItemId: true, schoolBroadcastSlotId: true, schoolRundownItemId: true,
        mediaAssetId: true, promoVersionId: true, publicationRevision: true,
        sourceRevision: true, plannedStart: true, expiresAt: true
      }
    });
    let recentInsertionIntent = false;
    for (const intent of recentInsertionIntents) {
      if (!intent.schoolBroadcastSlotId && !intent.schoolRundownItemId) {
        recentInsertionIntent = true;
        break;
      }
      if (await schoolMediaIntentIsCurrent(prisma, { player, intent, instant })) {
        recentInsertionIntent = true;
        break;
      }
    }
    if (!isEligibleMusic && !isCurrentPromo && !isCurrentSchoolAnnouncement && !isCurrentInsideAudio && !recentInsertionIntent) {
      return NextResponse.json({ error: "This audio is not in the player's current playback plan." }, { status: 404 });
    }

    // Private facility delivery has its own approved insertion authority.
    // Every ordinary player path, including a recently persisted intent, must
    // recheck current source privacy before opening the storage object.
    const asset = resolution.reason === "CORRECTIONS_PRIVATE" && isCurrentInsideAudio
      ? await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId }, select: { storageKey: true, mimeType: true, sizeBytes: true } })
      : await prisma.mediaAsset.findFirst({
        where: {
          id: mediaAssetId,
          status: "READY",
          ...GENERAL_STUDIO_MEDIA_ASSET_WHERE
        },
        select: { storageKey: true, mimeType: true, sizeBytes: true }
      });
    if (!asset) return NextResponse.json({ error: "This audio is not in the player's current playback plan." }, { status: 404 });
    return protectedAudioResponse(request, asset);
  } catch (error) {
    console.error("Player media stream failed:", error);
    return NextResponse.json({ error: "The audio file could not be played." }, { status: 500 });
  }
}

