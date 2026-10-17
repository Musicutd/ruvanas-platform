import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canAuthorSmartPlaylist } from "@/lib/smart-playlists.mjs";
import { onlineDraftSubscription } from "@/lib/private-preview-online-draft.mjs";

export async function simplePlaylistAccess({ write = false, allowOnlineDraft = false } = {}) {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context) return { response: NextResponse.json({ error: "Sign in to manage playlists." }, { status: 401 }) };
  if (!context.membership) return { response: NextResponse.json({ error: "Choose your organisation." }, { status: 403 }) };
  const entitlements = resolveEntitlements(context.membership.organisation.subscription);
  const sandboxDraftOnly = onlineDraftSubscription(context.membership.organisation.subscription);
  if (write && sandboxDraftOnly && !allowOnlineDraft) return { response: NextResponse.json({ error: "Draft-only testing cannot schedule playback or enable AutoDJ." }, { status: 403 }) };
  if (!entitlements.serviceEnabled) return { response: NextResponse.json({ error: "Your audio service is not active." }, { status: 403 }) };
  if (write && !canAuthorSmartPlaylist(context.membership.role)) return { response: NextResponse.json({ error: "Only an owner, manager or content editor can change playlists." }, { status: 403 }) };
  return { context, entitlements, sandboxDraftOnly };
}
