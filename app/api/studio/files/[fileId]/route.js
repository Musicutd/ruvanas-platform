import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getR2Storage } from "@/lib/r2";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveStudio } from "@/lib/studio-access";
import { safeStudioDownloadName } from "@/lib/studio-files.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const file = await prisma.productionOrderFile.findFirst({
    where: { id: String(params.fileId || ""), organisationId: access.organisation.id },
    select: { storageKey: true, originalName: true, mimeType: true, sizeBytes: true, kind: true }
  });
  if (!file) return NextResponse.json({ error: "The Studio file was not found." }, { status: 404 });
  try {
    const r2 = getR2Storage();
    const object = await r2.client.send(new GetObjectCommand({ Bucket: r2.bucketName, Key: file.storageKey }));
    const body = typeof object.Body?.transformToWebStream === "function" ? object.Body.transformToWebStream() : object.Body;
    if (!body) return NextResponse.json({ error: "The Studio storage response was empty." }, { status: 502 });
    const disposition = file.kind === "BRIEF_ATTACHMENT" ? "attachment" : "inline";
    return new NextResponse(body, { headers: { "Content-Type": object.ContentType || file.mimeType, "Content-Length": String(file.sizeBytes), "Content-Disposition": `${disposition}; filename="${safeStudioDownloadName(file.originalName)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("Studio file delivery failed:", error);
    return NextResponse.json({ error: "The Studio file could not be opened." }, { status: 502 });
  }
}

