import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

export async function contextForRadioClocks() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (!context.membership) return { response: NextResponse.json({ error: "No active organisation is available." }, { status: 403 }) };
  if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
    return { response: NextResponse.json({ error: "Radio Clocks are unavailable while this service is inactive." }, { status: 403 }) };
  }
  return { context };
}
