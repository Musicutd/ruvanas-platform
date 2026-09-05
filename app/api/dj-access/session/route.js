import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clearDjAccessCookie, DJ_ACCESS_COOKIE, getCurrentDjAccessSession, setDjAccessCookie } from "@/lib/dj-access-auth";
import { prisma } from "@/lib/prisma";
import { validateDjAccessToken } from "@/lib/dj-access-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeSession(session) {
  return { grantId: session.grantId, label: session.label, channel: session.channel, capabilities: session.capabilities, startsAt: session.startsAt, endsAt: session.endsAt, tokenExpiresAt: session.tokenExpiresAt };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use DJ access." }, { status: 401 });
  const session = await getCurrentDjAccessSession({ userId: user.id, markUsed: true });
  if (!session) return NextResponse.json({ error: "No active DJ access is available in this browser." }, { status: 403 });
  return NextResponse.json({ ok: true, session: safeSession(session) });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in with the presenter account before opening the private DJ link." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const rawToken = String(body.token || "").trim();
  const session = await validateDjAccessToken(prisma, { rawToken, userId: user.id, markUsed: true });
  if (!session) return NextResponse.json({ error: "This DJ link is invalid, expired, revoked or belongs to another presenter." }, { status: 403 });
  setDjAccessCookie(rawToken, session.tokenExpiresAt);
  return NextResponse.json({ ok: true, session: safeSession(session), cookie: DJ_ACCESS_COOKIE });
}

export async function DELETE() {
  clearDjAccessCookie();
  return NextResponse.json({ ok: true });
}

