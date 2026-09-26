import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CORRECTIONS_STUDIO_COOKIE, sameOrigin } from "@/lib/corrections-contributor-auth";
import { findCorrectionsContributorSession } from "@/lib/corrections-studio-service";
import { submitCorrectionsStudioWork } from "@/lib/corrections-studio-submission";
import { correctionsStudioCan } from "@/lib/corrections-studio-policy.mjs";

export const dynamic = "force-dynamic";
const schema = z.object({ renderId: z.string().cuid() });

export async function POST(request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a completed review render." }, { status: 400 });
  const token = (await cookies()).get(CORRECTIONS_STUDIO_COOKIE)?.value || "";
  if ((await cookies()).get("ruvanas_session")) return NextResponse.json({ error: "Use a separate contributor browser window." }, { status: 403 });
  const access = await findCorrectionsContributorSession(token, { allowSubmitted: true });
  if (!access || !correctionsStudioCan(access.session, "SUBMIT") || !["ACTIVE", "SUBMITTED"].includes(access.session.status)) return NextResponse.json({ error: "Your supervised Studio session is unavailable." }, { status: 403 });
  if (access.session.status === "SUBMITTED") {
    const prior = access.session.submission;
    return prior ? NextResponse.json({ ok: true, submission: { id: prior.id, revision: prior.revision, status: prior.status, repeated: true } }) : NextResponse.json({ error: "Submission is being finalised. Please retry." }, { status: 409 });
  }
  try { return NextResponse.json({ ok: true, submission: await submitCorrectionsStudioWork(access, parsed.data.renderId) }); }
  catch (error) { return NextResponse.json({ error: error.message || "The submission could not be completed." }, { status: 409 }); }
}
