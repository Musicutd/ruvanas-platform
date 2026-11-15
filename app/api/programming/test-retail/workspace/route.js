import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/retail-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { retailSubscriberWorkspace, retailSubscriberPrepareWorkspace, retailSubscriberPublicError } from "@/lib/retail-subscriber-service.mjs";
import { retailSubscriberQuery, retailSubscriberCommand, retailSubscriberErrorStatus } from "@/lib/retail-subscriber-request.mjs";

export const dynamic = "force-dynamic";
const failure = error => { const body = retailSubscriberPublicError(error); return NextResponse.json(body, { status: retailSubscriberErrorStatus(body.code), headers }); };
export async function GET(request) {
  try {
    retailSubscriberQuery(request, []);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await retailSubscriberWorkspace(prisma, { context }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  try {
    retailSubscriberQuery(request, []);
    const input = await retailSubscriberCommand(request, "workspace");
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await retailSubscriberPrepareWorkspace(prisma, { context, input }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
