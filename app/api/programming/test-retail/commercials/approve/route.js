import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/retail-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { assertRetailSubscriberCommercialApprovalAccess, reviewRetailSubscriberCommercialApproval, approveRetailSubscriberCommercialDraft, retailCommercialApprovalError } from "@/lib/retail-commercial-approval.mjs";
import { retailSubscriberCommercialApprovalQuery, retailSubscriberCommercialApprovalCommand } from "@/lib/retail-commercial-subscriber-approval-request.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const failure = error => { const { status, ...body } = retailCommercialApprovalError(error); return NextResponse.json(body, { status, headers }); };
export async function GET(request) {
  try {
    retailSubscriberCommercialApprovalQuery(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await reviewRetailSubscriberCommercialApproval(prisma, { context }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  try {
    retailSubscriberCommercialApprovalQuery(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    await assertRetailSubscriberCommercialApprovalAccess(prisma, { context });
    const input = await retailSubscriberCommercialApprovalCommand(request);
    return NextResponse.json(await approveRetailSubscriberCommercialDraft(prisma, { context, input }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
