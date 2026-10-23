import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/test-radio-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { subscriberLibrary, subscriberPreviewRecipe, subscriberCreateRecipe, subscriberMessage } from "@/lib/test-radio-subscriber-service.mjs";
import { subscriberCommand, subscriberQuery, subscriberErrorStatus } from "@/lib/test-radio-subscriber-request.mjs";

export const dynamic = "force-dynamic";
const failure = error => NextResponse.json({ error: subscriberMessage(error.code), code: error.code || "SUBSCRIBER_REQUEST_FAILED" }, { status: subscriberErrorStatus(error.code), headers });
export async function GET(request) {
  try {
    subscriberQuery(request, []);
    const context = await getActiveOrganisationContext(TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await subscriberLibrary(prisma, { context }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  try {
    subscriberQuery(request, []);
    const input = await subscriberCommand(request, "library");
    const context = await getActiveOrganisationContext(TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE);
    const fn = input.action === "preview" ? subscriberPreviewRecipe : subscriberCreateRecipe;
    return NextResponse.json(await fn(prisma, { context, input }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
