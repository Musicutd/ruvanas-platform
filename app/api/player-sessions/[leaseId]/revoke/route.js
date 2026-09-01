import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";
import { canManagePlayerSessions, revokePlayerSession } from "@/lib/player-session-management.mjs";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!canManagePlayerSessions(context.membership.role)) {
      return NextResponse.json({ error: "Only an organisation owner or manager can stop an active player session." }, { status: 403 });
    }

    const { leaseId } = await params;
    if (typeof leaseId !== "string" || leaseId.length < 1 || leaseId.length > 100) {
      return NextResponse.json({ error: "Choose a valid active player session." }, { status: 400 });
    }
    const result = await revokePlayerSession(prisma, {
      organisationId: context.membership.organisationId,
      leaseId,
      actorUserId: context.user.id
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) return NextResponse.redirect(new URL("/dashboard/player-sessions?released=1", request.url), 303);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Revoke active player session error:", error);
    return NextResponse.json({ error: "Unable to stop the active player session." }, { status: 500 });
  }
}
