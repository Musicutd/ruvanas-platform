import { NextResponse } from "next/server";
import { z } from "zod";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { createCorrectionsStudioSession, listCorrectionsStudio } from "@/lib/corrections-studio-service";

export const dynamic = "force-dynamic";
const schema = z.object({ facilityId: z.string().cuid(), contributorId: z.string().cuid(), programmeId: z.string().cuid(), priorProjectId: z.string().cuid().optional().nullable(), title: z.string().trim().min(2).max(160).optional().nullable(), projectType: z.enum(["QUICK_RECORD", "MULTITRACK"]).default("QUICK_RECORD") });

export async function GET() {
  const access = await correctionsRequestContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!["OWNER", "MANAGER"].includes(access.context.membership.role)) return NextResponse.json({ error: "Studio supervision requires facility manager access." }, { status: 403 });
  try { return NextResponse.json({ ok: true, ...(await listCorrectionsStudio(access)) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: error.message || "Studio sessions could not be loaded." }, { status: error.status || 500 }); }
}

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a facility, contributor and programme." }, { status: 400 });
  try { return NextResponse.json({ ok: true, session: await createCorrectionsStudioSession(access, parsed.data) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 409 }); }
}
