import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { transitionSchoolEpisode } from "@/lib/school-radio.mjs";

const schema = z.object({ action: z.enum(["APPROVE", "REQUEST_CHANGES", "REJECT", "ARCHIVE"]), notes: z.string().trim().max(1000).optional().nullable() });

export async function PATCH(request, { params }) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid moderation decision." }, { status: 400 });
  const organisationId = access.organisation.id;
  const episode = await prisma.schoolEpisode.findFirst({
    where: { id: String(params.episodeId || ""), organisationId },
    include: { submissions: { where: { status: "SUBMITTED" }, orderBy: { revision: "desc" }, take: 1, include: { promoVersion: { select: { status: true } } } } }
  });
  if (!episode) return NextResponse.json({ error: "The episode was not found." }, { status: 404 });
  const submission = episode.submissions[0];
  if (!submission && parsed.data.action !== "ARCHIVE") return NextResponse.json({ error: "The episode has no current submission." }, { status: 409 });
  if (parsed.data.action === "APPROVE" && submission.promoVersion.status !== "APPROVED") {
    return NextResponse.json({ error: "The submitted audio must pass the existing audio approval check before the episode can be approved." }, { status: 409 });
  }
  let transition;
  try {
    transition = transitionSchoolEpisode({ currentStatus: episode.status, action: parsed.data.action, notes: parsed.data.notes, hasSubmission: Boolean(submission) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "This decision is not allowed." }, { status: 409 });
  }
  const decision = { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", REJECT: "REJECTED" }[parsed.data.action];
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.schoolEpisode.update({ where: { id: episode.id }, data: transition });
    if (decision) await tx.schoolModerationReview.create({ data: { organisationId, episodeId: episode.id, submissionId: submission.id, reviewerUserId: access.user.id, decision, notes: parsed.data.notes || null } });
    await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `SCHOOL_EPISODE_${parsed.data.action}`, entityType: "SchoolEpisode", entityId: episode.id, details: { fromStatus: episode.status, toStatus: item.status, submissionId: submission?.id || null, notes: parsed.data.notes || null } } });
    return item;
  });
  return NextResponse.json({ episode: updated });
}
