import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { onlineDraftSubscription } from "@/lib/private-preview-online-draft.mjs";

export async function contextForAdvancedScheduler({ allowOnlineDraft = false } = {}) {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (!context.membership) return { response: NextResponse.json({ error: "No active organisation is available." }, { status: 403 }) };
  const sandboxDraftOnly = onlineDraftSubscription(context.membership.organisation.subscription);
  if (sandboxDraftOnly && !allowOnlineDraft) return { response: NextResponse.json({ error: "Draft-only testing cannot publish or activate a programme schedule." }, { status: 403 }) };
  if (!resolveEntitlements(context.membership.organisation.subscription).serviceEnabled) {
    return { response: NextResponse.json({ error: "Advanced scheduling is unavailable while this service is inactive." }, { status: 403 }) };
  }
  return { context, sandboxDraftOnly };
}
