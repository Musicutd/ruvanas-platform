import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/test-radio-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { subscriberCatalogue, subscriberMessage } from "@/lib/test-radio-subscriber-service.mjs";
import { subscriberQuery, subscriberErrorStatus } from "@/lib/test-radio-subscriber-request.mjs";

export const dynamic = "force-dynamic";
export async function GET(request) {
  try {
    const context = await getActiveOrganisationContext(TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE);
    const result = await subscriberCatalogue(prisma, { context, query: subscriberQuery(request, ["q", "genre", "limit", "offset"]) });
    return NextResponse.json(result, { status: 200, headers });
  } catch (error) { return NextResponse.json({ error: subscriberMessage(error.code), code: error.code || "SUBSCRIBER_REQUEST_FAILED" }, { status: subscriberErrorStatus(error.code), headers }); }
}
