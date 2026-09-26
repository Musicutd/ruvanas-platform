import { NextResponse } from "next/server";
import { z } from "zod";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { attachCorrectionsApprovedSource } from "@/lib/corrections-studio-service";

export const dynamic = "force-dynamic";
const schema = z.object({ promoVersionId: z.string().cuid() });

export async function POST(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!["OWNER", "MANAGER"].includes(access.context.membership.role)) return NextResponse.json({ error: "Facility manager access is required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an approved sound." }, { status: 400 });
  try { return NextResponse.json({ ok: true, source: await attachCorrectionsApprovedSource(access, (await params).sessionId, parsed.data.promoVersionId) }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 409 }); }
}
