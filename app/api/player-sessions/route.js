import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { listActivePlayerSessions, canManagePlayerSessions } from "@/lib/player-session-management.mjs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });

    const organisation = context.membership.organisation;
    const entitlements = resolveEntitlements(organisation.subscription);
    const sessions = await listActivePlayerSessions(prisma, { organisationId: organisation.id });
    return NextResponse.json({
      active: sessions.length,
      limit: entitlements.streamLimit,
      canManage: canManagePlayerSessions(context.membership.role),
      sessions
    });
  } catch (error) {
    console.error("Load active player sessions error:", error);
    return NextResponse.json({ error: "Unable to load active player sessions." }, { status: 500 });
  }
}
