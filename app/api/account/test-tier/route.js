import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE } from "@/lib/retail-subscriber-access.mjs";
import { PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";
import { getRetailTestTiers, selectRetailTestTier, readRetailTestTierCommand, validateRetailTestTierQuery, retailTestTierPublicError } from "@/lib/retail-test-tier-service.mjs";

export const dynamic = "force-dynamic";
const failure = error => { const { body, status } = retailTestTierPublicError(error); return NextResponse.json(body, { status, headers }); };
export async function GET(request) {
  try {
    validateRetailTestTierQuery(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await getRetailTestTiers(prisma, { context }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  try {
    const input = await readRetailTestTierCommand(request);
    const context = await getActiveOrganisationContext(RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE);
    return NextResponse.json(await selectRetailTestTier(prisma, { context, input }), { status: 200, headers });
  } catch (error) { return failure(error); }
}
