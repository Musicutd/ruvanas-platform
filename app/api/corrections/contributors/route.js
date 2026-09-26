import { NextResponse } from "next/server";
import { z } from "zod";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { createCorrectionsContributor } from "@/lib/corrections-studio-service";
import { prisma } from "@/lib/prisma";
import { correctionsC5Features } from "@/lib/corrections-c5-policy.mjs";

export const dynamic = "force-dynamic";
const schema = z.object({ facilityId: z.string().cuid(), displayName: z.string().trim().min(2).max(100), localReference: z.string().trim().max(80).optional().nullable() });

export async function GET() {
  const access = await correctionsRequestContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!correctionsC5Features(access.entitlements).development) return NextResponse.json({ error: "Contributor development requires Tier 2 or above." }, { status: 403 });
  const grants = access.context.membership.role === "OWNER" ? null : await prisma.correctionsFacilityGrant.findMany({ where: { organisationId: access.organisationId, organisationMemberId: access.context.membership.id }, select: { facilityId: true } });
  const contributors = await prisma.correctionsContributor.findMany({ where: { organisationId: access.organisationId, ...(grants ? { facilityId: { in: grants.map((item) => item.facilityId) } } : {}) }, orderBy: { displayName: "asc" }, take: 100, select: { id: true, displayName: true, facilityId: true, status: true } });
  return NextResponse.json({ ok: true, contributors }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a facility and a short contributor name." }, { status: 400 });
  try { return NextResponse.json({ ok: true, contributor: await createCorrectionsContributor(access, parsed.data) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 409 }); }
}
