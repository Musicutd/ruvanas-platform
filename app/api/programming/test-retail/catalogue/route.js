import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/retail-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { retailSubscriberCatalogue, retailSubscriberPublicError } from "@/lib/retail-subscriber-service.mjs";
import { retailSubscriberQuery, retailSubscriberErrorStatus } from "@/lib/retail-subscriber-request.mjs";

export const dynamic = "force-dynamic";
export async function GET(request) {
  try {
    const query = retailSubscriberQuery(request, ["q", "genre", "limit", "offset"]);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await retailSubscriberCatalogue(prisma, { context, query }), { status: 200, headers });
  } catch (error) {
    const body = retailSubscriberPublicError(error);
    return NextResponse.json(body, { status: retailSubscriberErrorStatus(body.code), headers });
  }
}
