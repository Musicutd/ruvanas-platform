import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { currentCorrectionsContributorSession } from "@/lib/corrections-contributor-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const access = await currentCorrectionsContributorSession();
  if (!access) return NextResponse.json({ error: "Session unavailable." }, { status: 403 });
  const id = (await params).mediaAssetId;
  const asset = await prisma.mediaAsset.findFirst({ where: {
    id, organisationId: access.session.organisationId, libraryType: "ORGANISATION_PROMO", status: "READY",
    OR: [
      { audioTakes: { some: { projectId: access.session.projectId, trashedAt: null } } },
      { audioRenderOutputs: { some: { projectId: access.session.projectId, status: "SUCCEEDED" } } }
    ]
  }, select: { storageKey: true, mimeType: true, sizeBytes: true } });
  if (!asset) return NextResponse.json({ error: "Audio unavailable." }, { status: 404 });
  const size = Number(asset.sizeBytes);
  const range = request.headers.get("range");
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    start = Number(match[1]); end = match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  try {
    const r2 = getR2Storage();
    const object = await r2.client.send(new GetObjectCommand({ Bucket: r2.bucketName, Key: asset.storageKey, ...(range ? { Range: `bytes=${start}-${end}` } : {}) }));
    const body = typeof object.Body?.transformToWebStream === "function" ? object.Body.transformToWebStream() : object.Body;
    return new NextResponse(body, { status: range ? 206 : 200, headers: {
      "Content-Type": asset.mimeType, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"
    } });
  } catch { return NextResponse.json({ error: "Audio unavailable." }, { status: 502 }); }
}
