import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { playerTokenHash } from "@/lib/player-auth";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { transitionPlayerLifecycle } from "@/lib/player-command-service";
import { canManageSubscriberPlayers, subscriberPlayerAllowance } from "@/lib/subscriber-player-setup.mjs";
import { getRequestId } from "@/lib/security-log";

const ENROLMENT_HOURS = 24;
const replacementSchema = z.object({
  note: z.string().trim().min(3).max(2_000),
  replacementName: z.string().trim().max(120).optional(),
  confirmReplacement: z.literal(true)
});

export async function POST(request, { params }) {
  try {
    const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership || !canManageSubscriberPlayers(context.membership.role)) {
      return NextResponse.json({ error: "Only organisation owners and managers can replace shop players." }, { status: 403 });
    }
    const allowance = subscriberPlayerAllowance(context.membership.organisation.subscription);
    if (!allowance.enabled || allowance.limit < 1) {
      return NextResponse.json({ error: "Shop-player replacement is unavailable for this subscription." }, { status: 403 });
    }
    const parsed = replacementSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Confirm the replacement and add a reason." }, { status: 400 });
    const { playerId } = await params;
    const organisationId = context.membership.organisationId;
    const current = await prisma.player.findFirst({
      where: { id: String(playerId || ""), organisationId, status: { not: "DISABLED" } },
      select: { id: true }
    });
    if (!current) return NextResponse.json({ error: "That active shop player was not found." }, { status: 404 });

    const token = createPlayerToken();
    const now = new Date();
    const result = await transitionPlayerLifecycle(prisma, {
      playerId: current.id,
      organisationId,
      action: "CREATE_REPLACEMENT",
      note: parsed.data.note,
      replacementName: parsed.data.replacementName,
      actorUserId: context.user.id,
      enrolmentTokenHash: playerTokenHash(token),
      enrolmentExpiresAt: new Date(now.getTime() + ENROLMENT_HOURS * 60 * 60 * 1000),
      requestId: getRequestId(request),
      now
    });
    return NextResponse.json({
      ok: true,
      replacement: {
        id: result.replacement.id,
        name: result.replacement.name,
        enrolmentCode: token,
        enrolmentExpiresAt: result.replacement.enrolmentExpiresAt
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["This player has already been disabled.", "A replacement already exists for this player.", "The player changed while this action was being completed."].includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("Subscriber player replacement error:", error);
    return NextResponse.json({ error: "Unable to replace the shop player." }, { status: 500 });
  }
}
