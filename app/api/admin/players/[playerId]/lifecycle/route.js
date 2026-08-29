import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { playerTokenHash } from "@/lib/player-auth";
import { transitionPlayerLifecycle } from "@/lib/player-command-service";
import { getRequestId } from "@/lib/security-log";

const ENROLMENT_HOURS = 24;
const lifecycleSchema = z.object({
  action: z.enum(["REVOKE_SESSION", "CREATE_REPLACEMENT"]),
  note: z.string().trim().min(3).max(2_000),
  replacementName: z.string().trim().max(120).optional()
});

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can revoke or replace a player." }, { status: 403 });
    }
    const parsed = lifecycleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a lifecycle action and add an operational reason." }, { status: 400 });
    const { playerId } = await params;
    const now = new Date();
    const token = parsed.data.action === "CREATE_REPLACEMENT" ? createPlayerToken() : null;
    const result = await transitionPlayerLifecycle(prisma, {
      playerId: String(playerId || ""),
      action: parsed.data.action,
      note: parsed.data.note,
      replacementName: parsed.data.replacementName,
      actorUserId: access.user.id,
      enrolmentTokenHash: token ? playerTokenHash(token) : null,
      enrolmentExpiresAt: token ? new Date(now.getTime() + ENROLMENT_HOURS * 60 * 60 * 1000) : null,
      requestId: getRequestId(request),
      now
    });
    return NextResponse.json({
      ok: true,
      action: parsed.data.action,
      replacement: result.replacement ? { id: result.replacement.id, name: result.replacement.name, enrolmentCode: token, enrolmentExpiresAt: result.replacement.enrolmentExpiresAt } : null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Player not found.") return NextResponse.json({ error: message }, { status: 404 });
    if ([
      "This player has already been disabled.",
      "A replacement already exists for this player.",
      "The player changed while this action was being completed."
    ].includes(message)) return NextResponse.json({ error: message }, { status: 409 });
    console.error("Player lifecycle error:", error);
    return NextResponse.json({ error: "Unable to update the player lifecycle." }, { status: 500 });
  }
}
