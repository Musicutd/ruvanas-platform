import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { playerTokenHash, setPlayerCookie } from "@/lib/player-auth";
import { enrolPlayerCode } from "@/lib/player-enrolment.mjs";
import { readPrivatePreviewBody, PREVIEW_RESPONSE_HEADERS as headers } from "@/lib/private-preview-request.mjs";

export async function POST(request) {
  try {
    const expectedOrigin = process.env.RUVANAS_PRIVATE_PREVIEW_ENABLED === "1" ? "https://www.ruvanas.com" : new URL(request.url).origin;
    if (request.headers.get("origin") !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "This request is not permitted." }, { status: 403, headers });
    }
    let body;
    try { body = await readPrivatePreviewBody(request, ["code"]); }
    catch { return NextResponse.json({ error: "Enter the player enrolment code." }, { status: 400, headers }); }
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) return NextResponse.json({ error: "Enter the player enrolment code." }, { status: 400, headers });
    const sessionToken = createPlayerToken();
    const player = await enrolPlayerCode(prisma, { enrolmentTokenHash: playerTokenHash(code), sessionTokenHash: playerTokenHash(sessionToken) });
    if (!player) return NextResponse.json({ error: "This enrolment code is invalid, expired, or already used." }, { status: 400, headers });
    await setPlayerCookie(sessionToken);
    return NextResponse.json({ ok: true, playerId: player.id }, { headers });
  } catch {
    return NextResponse.json({ error: "Unable to enrol this player." }, { status: 503, headers });
  }
}
