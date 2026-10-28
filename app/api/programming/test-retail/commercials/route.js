import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/retail-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { retailCommercialDraft, saveRetailCommercialDraft, retailCommercialPublicError } from "@/lib/retail-commercial-service.mjs";
import { retailCommercialQuery, retailCommercialCommand, retailCommercialErrorStatus } from "@/lib/retail-commercial-request.mjs";

export const dynamic = "force-dynamic";
const failure = error => { const body = retailCommercialPublicError(error); return NextResponse.json(body, { status: retailCommercialErrorStatus(body.code), headers }); };
export async function GET(request) {
  try {
    retailCommercialQuery(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await retailCommercialDraft(prisma, { context }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  try {
    retailCommercialQuery(request);
    const input = await retailCommercialCommand(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await saveRetailCommercialDraft(prisma, { context, input }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
