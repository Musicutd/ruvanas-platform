import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayer } from "@/lib/player-auth";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { getR2Storage } from "@/lib/r2";
import { isCatalogueLicenceCurrent } from "@/lib/catalogue-upload.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseRange(header, length) {
  if (!header || !header.startsWith("bytes=")) return null;
  const [startValue, endValue] = header.slice(6).split("-", 2);
  const start = Number.parseInt(startValue, 10);
  const end = endValue ? Number.parseInt(endValue, 10) : length - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= length) return "invalid";
  return { start, end: Math.min(end, length - 1) };
}

function streamBody(body) {
  if (!body) return null;
  return typeof body.transformToWebStream === "function" ? body.transformToWebStream() : body;
}

export async function GET(request, { params }) {
  try {
    const player = await getCurrentPlayer();
    if (!player || player.status === "DISABLED") return NextResponse.json({ error: "This player is not enrolled or has been disabled." }, { status: 401 });

    const mediaAssetId = String(params.mediaAssetId || "");
    const instant = new Date();
    const { resolution, campaignPlayout } = await resolvePlayerProgramming(player, instant);
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
    const recentPromoIntent = isCurrentPromo ? null : await prisma.playoutIntent.findFirst({
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
    if (!isEligibleMusic && !isCurrentPromo && !recentPromoIntent) {
      return NextResponse.json({ error: "This audio is not in the player's current playback plan." }, { status: 404 });
    }

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: mediaAssetId },
      select: { storageKey: true, mimeType: true, sizeBytes: true }
    });
    if (!asset) return NextResponse.json({ error: "The audio file was not found." }, { status: 404 });
    const totalLength = Number(asset.sizeBytes);
    if (!Number.isFinite(totalLength) || totalLength <= 0) return NextResponse.json({ error: "The audio file has an invalid size." }, { status: 500 });
    const range = parseRange(request.headers.get("range"), totalLength);
    if (range === "invalid") return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${totalLength}` } });

    const r2 = getR2Storage();
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucketName,
      Key: asset.storageKey,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {})
    }));
    const body = streamBody(object.Body);
    if (!body) return NextResponse.json({ error: "The audio storage response was empty." }, { status: 502 });
    const contentLength = range ? range.end - range.start + 1 : totalLength;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": object.ContentType || asset.mimeType || "audio/mpeg",
      "Content-Length": String(contentLength),
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline"
    });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${totalLength}`);
    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    console.error("Player media stream failed:", error);
    return NextResponse.json({ error: "The audio file could not be played." }, { status: 500 });
  }
}

