import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { currentCorrectionsContributorSession } from "@/lib/corrections-contributor-auth";
import { correctionsStudioSourcesAvailable } from "@/lib/corrections-studio-source-service";
import { correctionsStudioCurrentTakes, correctionsStudioSourceTakeSelect } from "@/lib/corrections-studio-sources.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const access = await currentCorrectionsContributorSession();
  if (!access) return NextResponse.json({ error: "Session unavailable." }, { status: 403 });
  const id = (await params).mediaAssetId;
  const organisationId = access.session.organisationId;
  const projectId = access.session.projectId;
  const [asset, takes, renders] = await Promise.all([
    prisma.mediaAsset.findFirst({ where: { id, organisationId, libraryType: "ORGANISATION_PROMO", status: "READY" },
      select: { storageKey: true, mimeType: true, sizeBytes: true } }),
    prisma.audioTake.findMany({ where: { mediaAssetId: id, organisationId, projectId }, select: correctionsStudioSourceTakeSelect }),
    prisma.audioRender.findMany({ where: { outputMediaAssetId: id, organisationId, projectId, status: "SUCCEEDED" },
      select: { version: { select: { state: true } } } })
  ]);
  let available = correctionsStudioCurrentTakes(takes).length > 0;
  for (const render of renders) {
    if (available) break;
    available = await correctionsStudioSourcesAvailable(prisma, { organisationId, projectId, versionState: render.version.state });
  }
  if (!asset || !available) return NextResponse.json({ error: "Audio unavailable." }, { status: 404 });
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
