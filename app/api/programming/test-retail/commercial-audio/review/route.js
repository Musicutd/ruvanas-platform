import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/retail-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { assertRetailCommercialUploadAccess } from "@/lib/retail-commercial-upload-service.mjs";
import { reviewRetailSubscriberRecording } from "@/lib/retail-commercial-subscriber-review.mjs";
import { retailRecordingReviewBoundary, readRetailRecordingReview, retailRecordingReviewError } from "@/lib/retail-commercial-subscriber-review-request.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request) {
  try {
    retailRecordingReviewBoundary(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    await assertRetailCommercialUploadAccess(prisma, { context });
    const input = await readRetailRecordingReview(request);
    return NextResponse.json(await reviewRetailSubscriberRecording(prisma, { context, input }), { status: 200, headers });
  } catch (error) {
    const { status, ...body } = retailRecordingReviewError(error);
    return NextResponse.json(body, { status, headers });
  }
}
