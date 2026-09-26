import { NextResponse } from "next/server";
import { z } from "zod";
import { correctionsRequestContext } from "@/lib/corrections-access";
import { activateCorrectionsStudioSession, closeCorrectionsStudioSession, revokeCorrectionsStudioSession } from "@/lib/corrections-studio-service";

export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACTIVATE"), minutes: z.number().int().min(15).max(240) }),
  z.object({ action: z.literal("REVOKE") }),
  z.object({ action: z.literal("CLOSE") })
]);

export async function POST(request, { params }) {
  const access = await correctionsRequestContext();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid session action." }, { status: 400 });
  const id = (await params).sessionId;
  try {
    const result = parsed.data.action === "ACTIVATE" ? await activateCorrectionsStudioSession(access, id, parsed.data.minutes)
      : parsed.data.action === "REVOKE" ? await revokeCorrectionsStudioSession(access, id) : await closeCorrectionsStudioSession(access, id);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 409 }); }
}
