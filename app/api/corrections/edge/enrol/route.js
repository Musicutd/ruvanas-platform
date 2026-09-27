import { NextResponse } from "next/server";
import { z } from "zod";
import { enrolCorrectionsEdge } from "@/lib/corrections-edge-service";
import { correctionsError } from "@/lib/corrections-http";

export const runtime = "nodejs";
const schema = z.object({ enrolmentCredential: z.string().min(20).max(150), softwareVersion: z.string().trim().max(60).optional() });

export async function POST(request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid one-time enrolment credential is required." }, { status: 400 });
  try { return NextResponse.json(await enrolCorrectionsEdge(parsed.data.enrolmentCredential, parsed.data),
    { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return correctionsError(error); }
}
