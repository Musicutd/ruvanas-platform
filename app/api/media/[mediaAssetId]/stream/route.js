import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess, requireOrganisationProductAccess } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getR2Storage } from "@/lib/r2";
import { generalStudioMediaAssetIds } from "@/lib/studio-general-asset-boundary.mjs";
import { correctionsPrivateMediaPreviewScope } from "@/lib/corrections-private-media-preview.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function streamToWebBody(body) {
  if (!body) {
    return null;
  }

  if (typeof body.transformToWebStream === "function") {
    return body.transformToWebStream();
  }

  return body;
}

function parseRange(rangeHeader, contentLength) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [startValue, endValue] = rangeHeader
    .replace("bytes=", "")
    .split("-", 2);

  const start = Number.parseInt(startValue, 10);
  const end = endValue
    ? Number.parseInt(endValue, 10)
    : contentLength - 1;

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end < start ||
    start >= contentLength
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, contentLength - 1)
  };
}

export async function GET(request, { params }) {
  try {
    const mediaAssetId = String(params.mediaAssetId || "");

    if (!mediaAssetId) {
      return NextResponse.json(
        { error: "Missing media asset ID." },
        { status: 400 }
      );
    }

    const asset = await prisma.mediaAsset.findUnique({
      where: {
        id: mediaAssetId
      },
      select: {
        id: true,
        organisationId: true,
        libraryType: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        audioTakes: { where: { trashedAt: { not: null } }, take: 1, select: { id: true } }
      }
    });

    if (!asset) {
      return NextResponse.json(
        { error: "The audio file was not found." },
        { status: 404 }
      );
    }

    if (
      asset.libraryType !== "ORGANISATION_PROMO" ||
      asset.status !== "READY" ||
      asset.audioTakes.length > 0
    ) {
      return NextResponse.json(
        { error: "This audio file is not available for playback." },
        { status: 404 }
      );
    }

    if (!asset.organisationId) {
      return NextResponse.json(
        { error: "This audio file has no organisation owner." },
        { status: 409 }
      );
    }

    const access = await requireOrganisationAccess(asset.organisationId);

    if (!access.ok) {
      return accessDenied(access);
    }

    // Only ordinary media uses the general organisation stream. Submitted
    // render review remains available to authorised facility staff, but raw
    // supervised takes/renders cannot be previewed through this generic URL.
    const [ordinaryIds, scope] = await Promise.all([
      generalStudioMediaAssetIds(prisma, asset.organisationId, [asset.id]),
      correctionsPrivateMediaPreviewScope(prisma, asset.id)
    ]);
    if (!ordinaryIds.has(asset.id) || scope.protectedUse) {
      if (!scope.available) return NextResponse.json({ error: "This audio file is not available for playback." }, { status: 404 });
      const insideAccess = await requireOrganisationProductAccess(asset.organisationId, "CORRECTIONS");
      if (!insideAccess.ok || !insideAccess.membership) return accessDenied(insideAccess.ok ? { ok: false, status: 403, error: "Inside facility access is required." } : insideAccess);
      if (insideAccess.membership.role !== "OWNER") {
        if (scope.ownerOnly || !scope.facilityIds.length) return NextResponse.json({ error: "Inside facility access is required." }, { status: 403 });
        const assigned = await prisma.correctionsFacilityGrant.findMany({
          where: { organisationId: asset.organisationId, organisationMemberId: insideAccess.membership.id, facilityId: { in: scope.facilityIds } },
          select: { facilityId: true }
        });
        if (new Set(assigned.map(({ facilityId }) => facilityId)).size !== scope.facilityIds.length) return NextResponse.json({ error: "Inside facility access is required." }, { status: 403 });
      }
    }

    const totalLength = Number(asset.sizeBytes);

    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      return NextResponse.json(
        { error: "The audio file has an invalid size." },
        { status: 500 }
      );
    }

    const range = parseRange(request.headers.get("range"), totalLength);

    if (range === "invalid") {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${totalLength}`
        }
      });
    }

    const r2 = getR2Storage();
    const object = await r2.client.send(
      new GetObjectCommand({
        Bucket: r2.bucketName,
        Key: asset.storageKey,
        ...(range
          ? {
              Range: `bytes=${range.start}-${range.end}`
            }
          : {})
      })
    );

    const body = streamToWebBody(object.Body);

    if (!body) {
      return NextResponse.json(
        { error: "The audio storage response was empty." },
        { status: 502 }
      );
    }

    const contentLength = range
      ? range.end - range.start + 1
      : totalLength;

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": object.ContentType || asset.mimeType || "audio/mpeg",
      "Content-Length": String(contentLength),
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline"
    });

    if (range) {
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${totalLength}`
      );
    }

    return new NextResponse(body, {
      status: range ? 206 : 200,
      headers
    });
  } catch (error) {
    console.error("Protected media stream failed:", error);

    return NextResponse.json(
      { error: "The audio file could not be played." },
      { status: 500 }
    );
  }
}

