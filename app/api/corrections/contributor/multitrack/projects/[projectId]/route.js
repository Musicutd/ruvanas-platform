import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentCorrectionsContributorSession, sameOrigin } from "@/lib/corrections-contributor-auth";
import { correctionsMultitrackInclude, saveCorrectionsMultitrack, serializeCorrectionsMultitrack } from "@/lib/corrections-multitrack";
import { assertStudioMultitrackWriteAllowed } from "@/lib/multitrack-studio.mjs";

export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE"), state: z.record(z.unknown()), reason: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("QUEUE_RENDER"), state: z.record(z.unknown()), preset: z.enum(["SCHOOL_RADIO_MP3", "SPEECH_MP3"]) })
]);
async function load(projectId, access) {
  if (projectId !== access.session.projectId || access.session.project.type !== "MULTITRACK") return null;
  return prisma.audioProject.findFirst({ where: { id: projectId, organisationId: access.session.organisationId,
    type: "MULTITRACK", status: { not: "ARCHIVED" } }, include: correctionsMultitrackInclude });
}
export async function GET(_request, { params }) {
  const access = await currentCorrectionsContributorSession("EDIT");
  if (!access || !access.entitlements.studioProEnabled) return NextResponse.json({ error: "This supervised mixer is unavailable." }, { status: 403 });
  const project = await load((await params).projectId, access);
  return project ? NextResponse.json(serializeCorrectionsMultitrack(project, access.entitlements), { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ error: "Project unavailable." }, { status: 404 });
}
export async function POST(request, { params }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await currentCorrectionsContributorSession("EDIT");
  if (!access || !access.entitlements.studioProEnabled) return NextResponse.json({ error: "This supervised mixer is unavailable." }, { status: 403 });
  const projectId = (await params).projectId;
  if (projectId !== access.session.projectId || access.session.project.type !== "MULTITRACK") return NextResponse.json({ error: "Project unavailable." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The mixer request is invalid." }, { status: 400 });
  if (parsed.data.action === "QUEUE_RENDER" && !access.session.capabilityScope.includes("RENDER")) return NextResponse.json({ error: "Rendering is not available in this session." }, { status: 403 });
  try {
    assertStudioMultitrackWriteAllowed(parsed.data.state, access.entitlements);
    await prisma.$transaction(async (tx) => {
      const session = await tx.correctionsStudioSession.findFirst({ where: { id: access.session.id, projectId,
        status: "ACTIVE", accessTokenHash: access.session.accessTokenHash, expiresAt: { gt: new Date() },
        contributor: { status: "ACTIVE" }, programme: { status: { in: ["DRAFT", "CHANGES_REQUESTED", "REJECTED"] } } } });
      if (!session) throw new Error("Your supervised Studio session has ended.");
      const project = await tx.audioProject.findFirst({ where: { id: projectId, organisationId: session.organisationId,
        type: "MULTITRACK", status: { not: "ARCHIVED" } } });
      if (!project) throw new Error("The assigned mixer project is unavailable.");
      const version = await saveCorrectionsMultitrack(tx, { project, state: parsed.data.state, session,
        entitlements: access.entitlements, reason: parsed.data.action === "QUEUE_RENDER" ? "Corrections supervised mix render requested" : parsed.data.reason || "Corrections supervised mix edit" });
      if (parsed.data.action === "QUEUE_RENDER") await tx.audioRender.create({ data: { organisationId: session.organisationId,
        projectId, versionId: version.id, requestedByUserId: session.supervisorUserId, preset: parsed.data.preset } });
      await tx.auditLog.create({ data: { organisationId: session.organisationId,
        action: parsed.data.action === "QUEUE_RENDER" ? "CORRECTIONS_STUDIO_RENDER_QUEUED" : "CORRECTIONS_STUDIO_EDIT_SAVED",
        entityType: "CorrectionsStudioSession", entityId: session.id,
        details: { facilityId: session.facilityId, contributorId: session.contributorId, projectId, versionId: version.id } } });
    });
    const updated = await load(projectId, access);
    return NextResponse.json(serializeCorrectionsMultitrack(updated, access.entitlements), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error.message || "The supervised mix could not be saved." }, { status: 409 }); }
}
