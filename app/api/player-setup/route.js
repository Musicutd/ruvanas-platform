import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { playerTokenHash } from "@/lib/player-auth";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { canManageSubscriberPlayers, createSubscriberPlayer } from "@/lib/subscriber-player-setup.mjs";

const ENROLMENT_HOURS = 24;
const playerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  zoneId: z.string().trim().min(1).max(200)
});

export async function POST(request) {
  try {
    const context = await getActiveOrganisationContext();
    if (!context) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    if (!context.membership) return NextResponse.json({ error: "No active organisation is available." }, { status: 403 });
    if (!canManageSubscriberPlayers(context.membership.role)) {
      return NextResponse.json({ error: "Only organisation owners and managers can prepare shop players." }, { status: 403 });
    }
    const parsed = playerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Add a player name and choose its location and zone." }, { status: 400 });

    const token = createPlayerToken();
    const now = new Date();
    const enrolmentExpiresAt = new Date(now.getTime() + ENROLMENT_HOURS * 60 * 60 * 1000);
    const result = await createSubscriberPlayer(prisma, {
      organisationId: context.membership.organisationId,
      actorUserId: context.user.id,
      input: parsed.data,
      enrolmentTokenHash: playerTokenHash(token),
      enrolmentExpiresAt,
      instant: now
    });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json({
      ok: true,
      player: { id: result.player.id, name: result.player.name, enrolmentCode: token, enrolmentExpiresAt },
      configured: result.configured,
      limit: result.limit
    }, { status: 201 });
  } catch (error) {
    console.error("Subscriber player setup error:", error);
    return NextResponse.json({ error: "Unable to prepare the shop player." }, { status: 500 });
  }
}
