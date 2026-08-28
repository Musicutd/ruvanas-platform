import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const session = await prisma.schoolAudioUploadSession.findFirst({
    where: { id: String(params.uploadId || ""), organisationId: access.organisation.id, createdByUserId: access.user.id },
    select: { id: true, status: true, partSizeBytes: true, partCount: true, expiresAt: true, parts: { orderBy: { partNumber: "asc" }, select: { partNumber: true, sizeBytes: true } } }
  });
  if (!session) return NextResponse.json({ error: "The upload session was not found." }, { status: 404 });
  return NextResponse.json({ session });
}

