import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentDigitalSignageDevice } from "@/lib/digital-signage-device-auth";
import { getR2Storage } from "@/lib/r2";
import { SIGNAGE_OFFLINE_GRACE_SECONDS } from "@/lib/digital-signage-delivery.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function streamBody(body) {
  if (!body) return null;
  return typeof body.transformToWebStream === "function" ? body.transformToWebStream() : body;
}

export async function GET(_request, { params }) {
  try {
    const device = await getCurrentDigitalSignageDevice();
    if (!device) return NextResponse.json({ error: "This display is not enrolled, disabled, or no longer entitled." }, { status: 401 });
    const instant = new Date();
    const graceStart = new Date(instant.getTime() - SIGNAGE_OFFLINE_GRACE_SECONDS * 1000);
    const asset = await prisma.digitalSignageAsset.findFirst({ where: {
      id: String(params.assetId || ""),
      organisationId: device.organisationId,
      status: "READY",
      playlistItems: { some: { playlist: { devices: { some: { deviceId: device.id } }, status: "PUBLISHED", OR: [{ endsAt: null }, { endsAt: { gt: graceStart } }] } } }
    }, select: { storageKey: true, mimeType: true, checksumSha256: true } });
    if (!asset) return NextResponse.json({ error: "This visual is not in the display's published delivery plan." }, { status: 404 });
    const r2 = getR2Storage();
    const object = await r2.client.send(new GetObjectCommand({ Bucket: r2.bucketName, Key: asset.storageKey }));
    const body = streamBody(object.Body);
    if (!body) return NextResponse.json({ error: "The visual storage response was empty." }, { status: 502 });
    return new NextResponse(body, { headers: {
      "Content-Type": object.ContentType || asset.mimeType || "application/octet-stream",
      "Cache-Control": "private, max-age=86400, immutable",
      ETag: `"${asset.checksumSha256}"`,
      "Content-Disposition": "inline"
    } });
  } catch (error) {
    console.error("Digital signage media delivery error:", error);
    return NextResponse.json({ error: "The visual could not be delivered." }, { status: 500 });
  }
}
