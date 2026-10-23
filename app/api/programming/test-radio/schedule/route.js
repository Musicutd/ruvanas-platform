import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/test-radio-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { subscriberSchedule, subscriberSaveSchedule, subscriberMessage } from "@/lib/test-radio-subscriber-service.mjs";
import { subscriberCommand, subscriberQuery, subscriberErrorStatus } from "@/lib/test-radio-subscriber-request.mjs";

export const dynamic = "force-dynamic";
const failure = error => NextResponse.json({ error: subscriberMessage(error.code), code: error.code || "SUBSCRIBER_REQUEST_FAILED" }, { status: subscriberErrorStatus(error.code), headers });
export async function GET(request) {
  try {
    const query = subscriberQuery(request, ["channelId"]);
    const context = await getActiveOrganisationContext(TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await subscriberSchedule(prisma, { context, channelId: query.channelId }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  try {
    subscriberQuery(request, []);
    const input = await subscriberCommand(request, "schedule");
    const context = await getActiveOrganisationContext(TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await subscriberSaveSchedule(prisma, { context, input }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
