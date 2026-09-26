import { NextResponse } from "next/server";
import { currentCorrectionsContributorSession } from "@/lib/corrections-contributor-auth";

export const dynamic = "force-dynamic";
export async function GET() {
  const access = await currentCorrectionsContributorSession();
  if (!access) return NextResponse.json({ error: "Your supervised Studio session is unavailable." }, { status: 403 });
  const { session, entitlements } = access;
  return NextResponse.json({ projects: [{ id: session.projectId, title: session.project.title, type: session.project.type }], studioLevel: entitlements.studioLevel, studioProEnabled: entitlements.studioProEnabled }, { headers: { "Cache-Control": "private, no-store" } });
}
