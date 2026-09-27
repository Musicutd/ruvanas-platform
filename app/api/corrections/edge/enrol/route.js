import { NextResponse } from "next/server";
import { z } from "zod";
import { enrolCorrectionsEdge } from "@/lib/corrections-edge-service";
import { parseEdgeCredential } from "@/lib/corrections-edge-identity.mjs";
import { correctionsError } from "@/lib/corrections-http";

export const runtime = "nodejs";
const schema = z.object({ enrolmentCredential: z.string().min(20).max(150), softwareVersion: z.string().trim().max(60).optional(),
  proofPublicKeyPem: z.string().min(80).max(500) });

export async function POST(request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid one-time enrolment credential is required." }, { status: 400 });
  const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!parseEdgeCredential(bearer, "enrolment") || bearer !== parsed.data.enrolmentCredential) {
    return NextResponse.json({ error: "A matching one-time Edge enrolment credential is required." }, { status: 401 });
  }
  try { return NextResponse.json(await enrolCorrectionsEdge(parsed.data.enrolmentCredential, parsed.data),
    { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return correctionsError(error); }
}
