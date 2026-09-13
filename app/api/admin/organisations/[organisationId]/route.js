import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  deleteTrialOrganisation,
  TrialOrganisationDeletionError
} from "@/lib/trial-organisation-deletion.mjs";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  confirmation: z.string().trim().min(1).max(220)
}).strict();

export async function DELETE(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can delete a trial organisation." }, { status: 403 });
    }

    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter the displayed confirmation phrase exactly." }, { status: 400 });
    }
    const { organisationId } = await params;
    const result = await deleteTrialOrganisation(prisma, {
      actor: access.user,
      organisationId,
      confirmation: parsed.data.confirmation
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Delete trial organisation error:", error);
    if (error instanceof TrialOrganisationDeletionError) {
      const status = error.code === "ORGANISATION_NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error?.code === "P2003") {
      return NextResponse.json({ error: "This organisation is linked to shared network records and cannot be deleted automatically." }, { status: 409 });
    }
    return NextResponse.json({ error: "The organisation could not be deleted. No partial deletion was retained." }, { status: 500 });
  }
}
