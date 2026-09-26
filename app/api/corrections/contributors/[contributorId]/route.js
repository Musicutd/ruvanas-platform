import { NextResponse } from "next/server";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { archiveCorrectionsContributor } from "@/lib/corrections-studio-service";

export const dynamic = "force-dynamic";
export async function DELETE(_request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try { return NextResponse.json({ ok: true, contributor: await archiveCorrectionsContributor(access, (await params).contributorId) }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 409 }); }
}
