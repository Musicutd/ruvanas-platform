import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CORRECTIONS_STUDIO_COOKIE, currentCorrectionsContributorSession, safeContributorWorkspace, sameOrigin } from "@/lib/corrections-contributor-auth";
import { findCorrectionsContributorSession } from "@/lib/corrections-studio-service";

export const dynamic = "force-dynamic";
const schema = z.object({ accessCode: z.string().min(40).max(64) });

export async function GET() {
  const access = await currentCorrectionsContributorSession();
  if (!access) return NextResponse.json({ error: "Enter a current supervised Studio access code." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true, ...safeContributorWorkspace(access) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Open this page from Ruvanas to continue." }, { status: 403 });
  if ((await cookies()).get("ruvanas_session")) return NextResponse.json({ error: "Open the contributor workspace in a separate private browser window without a staff sign-in." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the access code supplied by your supervisor." }, { status: 400 });
  const access = await findCorrectionsContributorSession(parsed.data.accessCode);
  if (!access) return NextResponse.json({ error: "This supervised session is unavailable or has expired." }, { status: 403 });
  const response = NextResponse.json({ ok: true, ...safeContributorWorkspace(access) }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(CORRECTIONS_STUDIO_COOKIE, parsed.data.accessCode, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/",
    maxAge: Math.max(1, Math.floor((new Date(access.session.expiresAt).getTime() - Date.now()) / 1000))
  });
  await prisma.auditLog.create({ data: { organisationId: access.session.organisationId, action: "CORRECTIONS_STUDIO_OPENED", entityType: "CorrectionsStudioSession", entityId: access.session.id, details: { facilityId: access.session.facilityId, contributorId: access.session.contributorId } } });
  return response;
}

export async function DELETE(request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CORRECTIONS_STUDIO_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
