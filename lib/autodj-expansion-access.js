import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canAuthorSmartPlaylist, canPublishSmartPlaylist } from "@/lib/smart-playlists.mjs";

export async function contextForAutoDjExpansion() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (!context.membership) return { response: NextResponse.json({ error: "No active organisation is available." }, { status: 403 }) };
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  if (!entitlements.serviceEnabled) return { response: NextResponse.json({ error: "AutoDJ is unavailable while this service is inactive." }, { status: 403 }) };
  return { context, entitlements, canAuthor: canAuthorSmartPlaylist(context.membership.role), canPublish: canPublishSmartPlaylist(context.membership.role) };
}
