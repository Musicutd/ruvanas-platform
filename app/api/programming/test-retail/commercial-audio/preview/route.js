import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { getR2Storage } from "@/lib/r2";
import { RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/retail-subscriber-access.mjs";
import { readRetailSubscriberRecordingForPreview } from "@/lib/retail-commercial-subscriber-review.mjs";
import { retailRecordingReviewError } from "@/lib/retail-commercial-subscriber-review-request.mjs";
import { retailPreviewRequest, retailPreviewRange, retailPreviewHeaders, boundedRetailPreviewBody } from "@/lib/retail-commercial-preview.mjs";
import { PREVIEW_RESPONSE_HEADERS } from "@/lib/private-preview-request.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function preview(request) {
  try {
    const versionId = retailPreviewRequest(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    const recording = await readRetailSubscriberRecordingForPreview(prisma, { context, versionId });
    const range = retailPreviewRange(request.headers.get("range"), recording.sizeBytes);
    if (range === "invalid") return new NextResponse(null, { status: 416, headers: { ...PREVIEW_RESPONSE_HEADERS, "Content-Range": `bytes */${recording.sizeBytes}` } });
    const headers = retailPreviewHeaders(recording, range), status = range ? 206 : 200;
    if (request.method === "HEAD") return new NextResponse(null, { status, headers });
    const r2 = getR2Storage();
    const object = await r2.client.send(new GetObjectCommand({ Bucket: r2.bucketName, Key: recording.storageKey,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }), { abortSignal: AbortSignal.timeout(15_000) });
    const length = Number(headers.get("Content-Length"));
    if (object.ContentLength !== length) { object.Body?.destroy?.(); throw new Error("Storage length mismatch"); }
    return new NextResponse(boundedRetailPreviewBody(object.Body, length), { status, headers });
  } catch (error) {
    const { status, ...body } = retailRecordingReviewError(error);
    return new NextResponse(request.method === "HEAD" ? null : JSON.stringify(body), { status,
      headers: { ...PREVIEW_RESPONSE_HEADERS, "Content-Type": "application/json" } });
  }
}
export const GET = preview;
export const HEAD = preview;
