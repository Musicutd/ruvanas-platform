import { NextResponse } from "next/server";
import { z } from "zod";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { createCorrectionsContributor } from "@/lib/corrections-studio-service";

export const dynamic = "force-dynamic";
const schema = z.object({ facilityId: z.string().cuid(), displayName: z.string().trim().min(2).max(100), localReference: z.string().trim().max(80).optional().nullable() });

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a facility and a short contributor name." }, { status: 400 });
  try { return NextResponse.json({ ok: true, contributor: await createCorrectionsContributor(access, parsed.data) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 409 }); }
}
