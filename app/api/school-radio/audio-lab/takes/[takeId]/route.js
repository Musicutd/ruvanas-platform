import { NextResponse } from "next/server";
import { z } from "zod";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveStudio } from "@/lib/studio-access";
import { permanentlyDeleteAudioTake, restoreAudioTake, trashAudioTake } from "@/lib/audio-take-trash-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const actionSchema = z.object({ action: z.enum(["TRASH", "RESTORE", "DELETE_PERMANENTLY"]) });

export async function PATCH(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid recording action." }, { status: 400 });
  const takeId = String((await params).takeId || "");
  try {
    if (parsed.data.action === "TRASH") {
      const take = await trashAudioTake({ takeId, organisationId: access.organisation.id, userId: access.user.id });
      return NextResponse.json({ take, message: "Recording moved to Trash for 30 days." });
    }
    if (parsed.data.action === "RESTORE") {
      const take = await restoreAudioTake({ takeId, organisationId: access.organisation.id, userId: access.user.id });
      return NextResponse.json({ take, message: "Recording restored to your Studio library." });
    }
    const take = await permanentlyDeleteAudioTake({ takeId, organisationId: access.organisation.id, userId: access.user.id });
    return NextResponse.json({ take, message: "Recording permanently deleted." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The recording action could not be completed." },
      { status: error?.status || 409 }
    );
  }
}

