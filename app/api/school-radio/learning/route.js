import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import {
  ASSIGNMENT_TEMPLATE_CODES,
  ASSIGNMENT_TEMPLATES,
  normalizeAssessment,
  normalizePortfolioEvidence,
  normalizeRubricCriteria,
  validateAssignmentSubmission,
  validateAssignmentWindow
} from "@/lib/school-learning.mjs";

export const dynamic = "force-dynamic";

const criterionSchema = z.object({ label: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional().nullable(), maxScore: z.coerce.number().int().min(1).max(100) });
const scoreSchema = z.object({ criterionId: z.string().cuid(), score: z.coerce.number().int().min(0), notes: z.string().trim().max(1000).optional().nullable() });
const annotationSchema = z.object({ positionMs: z.coerce.number().int().min(0), endMs: z.coerce.number().int().min(0).optional().nullable(), note: z.string().trim().min(1).max(2000) });

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_ASSIGNMENT"), studentGroupId: z.string().cuid(), programmeId: z.string().cuid().optional().nullable(), title: z.string().trim().min(2).max(160), brief: z.string().trim().max(5000).optional().nullable(), templateCode: z.enum(ASSIGNMENT_TEMPLATE_CODES), dueAt: z.string().datetime().optional().nullable(), allowedTools: z.array(z.string().trim().min(1).max(80)).max(20).default([]), criteria: z.array(criterionSchema).max(12).default([]), openNow: z.boolean().default(true) }),
  z.object({ action: z.literal("SET_ASSIGNMENT_STATUS"), assignmentId: z.string().cuid(), status: z.enum(["OPEN", "CLOSED", "ARCHIVED"]) }),
  z.object({ action: z.literal("SUBMIT_ASSIGNMENT"), assignmentId: z.string().cuid(), contributorIds: z.array(z.string().cuid()).min(1).max(20), audioProjectId: z.string().cuid().optional().nullable(), episodeId: z.string().cuid().optional().nullable(), reflection: z.string().trim().max(3000).optional().nullable(), projectRoles: z.record(z.string().trim().max(120)).default({}) }),
  z.object({ action: z.literal("ASSESS_SUBMISSION"), submissionId: z.string().cuid(), scores: z.array(scoreSchema).min(1).max(12), annotations: z.array(annotationSchema).max(100).default([]), narrativeNotes: z.string().trim().max(5000).optional().nullable(), revisionRequest: z.string().trim().max(3000).optional().nullable(), release: z.boolean().default(true) }),
  z.object({ action: z.literal("ADD_PORTFOLIO_ENTRY"), submissionId: z.string().cuid(), contributorId: z.string().cuid(), title: z.string().trim().min(2).max(160), projectRole: z.string().trim().max(120).optional().nullable(), reflection: z.string().trim().max(3000).optional().nullable(), skills: z.array(z.string().trim().min(1).max(80)).max(20).default([]) })
]);

const assignmentInclude = {
  studentGroup: { select: { id: true, name: true, academicYear: true } },
  programme: { select: { id: true, title: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  rubric: { include: { criteria: { orderBy: { position: "asc" } } } },
  submissions: {
    orderBy: { submittedAt: "desc" },
    include: {
      contributors: { include: { contributor: { select: { id: true, displayName: true, referenceCode: true } } } },
      audioProject: { select: { id: true, title: true, status: true } },
      episode: { select: { id: true, title: true, status: true } },
      recordedBy: { select: { id: true, name: true, email: true } },
      assessment: { include: { scores: true, annotations: { orderBy: { positionMs: "asc" } }, assessedBy: { select: { id: true, name: true, email: true } } } },
      portfolios: { include: { contributor: { select: { id: true, displayName: true } } } }
    }
  }
};

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

function assertStatusTransition(currentStatus, nextStatus) {
  const allowed = { DRAFT: new Set(["OPEN", "ARCHIVED"]), OPEN: new Set(["CLOSED", "ARCHIVED"]), CLOSED: new Set(["OPEN", "ARCHIVED"]), ARCHIVED: new Set() };
  if (!allowed[currentStatus]?.has(nextStatus)) throw new Error(`A ${currentStatus.toLowerCase()} assignment cannot move to ${nextStatus.toLowerCase()}.`);
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const [groups, programmes, audioProjects, episodes, assignments, portfolios] = await Promise.all([
    prisma.studentGroup.findMany({ where: { organisationId }, orderBy: { name: "asc" }, include: { contributors: { where: { status: "ACTIVE" }, orderBy: { displayName: "asc" } } } }),
    prisma.schoolProgramme.findMany({ where: { organisationId, status: "ACTIVE" }, orderBy: { title: "asc" }, select: { id: true, title: true, studentGroupId: true } }),
    prisma.audioProject.findMany({ where: { organisationId, status: { in: ["READY", "SUBMITTED"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, status: true, studentGroupId: true, programmeId: true, episodeId: true } }),
    prisma.schoolEpisode.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, status: true, programmeId: true, programme: { select: { studentGroupId: true } } } }),
    prisma.assignment.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], include: assignmentInclude }),
    prisma.portfolioEntry.findMany({ where: { organisationId, status: "PRIVATE" }, orderBy: { updatedAt: "desc" }, include: { contributor: { select: { id: true, displayName: true, studentGroup: { select: { id: true, name: true } } } }, submission: { select: { id: true, assignment: { select: { id: true, title: true } } } }, assessment: { select: { totalScore: true, maximumScore: true, status: true } } } })
  ]);
  return NextResponse.json({
    templates: ASSIGNMENT_TEMPLATES,
    groups,
    programmes,
    audioProjects,
    episodes,
    assignments,
    portfolios,
    safety: { staffManagedOnly: true, directStudentAccessEnabled: false, portfolioScope: "PRIVATE", publicPublishingEnabled: false }
  });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the learning-workspace details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;
  try {
    const result = await prisma.$transaction(async (tx) => {
      let entity;
      if (data.action === "CREATE_ASSIGNMENT") {
        const group = await tx.studentGroup.findFirst({ where: { id: data.studentGroupId, organisationId }, select: { id: true } });
        if (!group) throw notFound("Choose a class or student group from this school.");
        if (data.programmeId) {
          const programme = await tx.schoolProgramme.findFirst({ where: { id: data.programmeId, organisationId, status: "ACTIVE", OR: [{ studentGroupId: group.id }, { studentGroupId: null }] }, select: { id: true } });
          if (!programme) throw notFound("Choose a programme available to this class.");
        }
        const criteria = normalizeRubricCriteria(data.criteria, data.templateCode);
        entity = await tx.assignment.create({
          data: {
            organisationId,
            studentGroupId: group.id,
            programmeId: data.programmeId || null,
            title: data.title,
            brief: data.brief || null,
            templateCode: data.templateCode,
            allowedTools: [...new Set(data.allowedTools)],
            dueAt: validateAssignmentWindow({ dueAt: data.dueAt }),
            status: data.openNow ? "OPEN" : "DRAFT",
            createdByUserId: access.user.id,
            rubric: { create: { title: `${data.title} rubric`, criteria: { create: criteria } } }
          }
        });
      } else if (data.action === "SET_ASSIGNMENT_STATUS") {
        const assignment = await tx.assignment.findFirst({ where: { id: data.assignmentId, organisationId } });
        if (!assignment) throw notFound("The assignment was not found.");
        assertStatusTransition(assignment.status, data.status);
        entity = await tx.assignment.update({ where: { id: assignment.id }, data: { status: data.status } });
      } else if (data.action === "SUBMIT_ASSIGNMENT") {
        const assignment = await tx.assignment.findFirst({ where: { id: data.assignmentId, organisationId }, include: { _count: { select: { submissions: true } } } });
        if (!assignment) throw notFound("The assignment was not found.");
        const contributorIds = validateAssignmentSubmission({ assignmentStatus: assignment.status, contributorIds: data.contributorIds, audioProjectId: data.audioProjectId, episodeId: data.episodeId });
        const contributorCount = await tx.studentContributor.count({ where: { id: { in: contributorIds }, organisationId, studentGroupId: assignment.studentGroupId, status: "ACTIVE" } });
        if (contributorCount !== contributorIds.length) throw new Error("Every contributor must be active in the assignment class.");
        if (data.audioProjectId) {
          const project = await tx.audioProject.findFirst({ where: { id: data.audioProjectId, organisationId, status: { in: ["READY", "SUBMITTED"] }, OR: [{ studentGroupId: assignment.studentGroupId }, { studentGroupId: null }] }, select: { id: true } });
          if (!project) throw notFound("Choose a ready AudioLab project available to this class.");
        }
        if (data.episodeId) {
          const episode = await tx.schoolEpisode.findFirst({ where: { id: data.episodeId, organisationId, programme: { OR: [{ studentGroupId: assignment.studentGroupId }, { studentGroupId: null }] } }, select: { id: true } });
          if (!episode) throw notFound("Choose a school episode available to this class.");
        }
        entity = await tx.assignmentSubmission.create({ data: { organisationId, assignmentId: assignment.id, audioProjectId: data.audioProjectId || null, episodeId: data.episodeId || null, revision: assignment._count.submissions + 1, reflection: data.reflection || null, recordedByUserId: access.user.id, contributors: { create: contributorIds.map((contributorId) => ({ contributorId, projectRole: data.projectRoles[contributorId] || null })) } } });
      } else if (data.action === "ASSESS_SUBMISSION") {
        const submission = await tx.assignmentSubmission.findFirst({ where: { id: data.submissionId, organisationId, status: { not: "WITHDRAWN" } }, include: { assignment: { include: { rubric: { include: { criteria: true } } } } } });
        if (!submission) throw notFound("The assignment submission was not found.");
        const assessment = normalizeAssessment({ criteria: submission.assignment.rubric?.criteria || [], scores: data.scores, annotations: data.annotations, narrativeNotes: data.narrativeNotes, revisionRequest: data.revisionRequest });
        const saved = await tx.assessment.upsert({
          where: { submissionId: submission.id },
          create: { organisationId, submissionId: submission.id, status: data.release ? "RELEASED" : "DRAFT", totalScore: assessment.totalScore, maximumScore: assessment.maximumScore, narrativeNotes: assessment.narrativeNotes, revisionRequest: assessment.revisionRequest, assessedByUserId: access.user.id, releasedAt: data.release ? new Date() : null },
          update: { status: data.release ? "RELEASED" : "DRAFT", totalScore: assessment.totalScore, maximumScore: assessment.maximumScore, narrativeNotes: assessment.narrativeNotes, revisionRequest: assessment.revisionRequest, assessedByUserId: access.user.id, assessedAt: new Date(), releasedAt: data.release ? new Date() : null }
        });
        await tx.assessmentScore.deleteMany({ where: { assessmentId: saved.id } });
        await tx.assessmentAnnotation.deleteMany({ where: { assessmentId: saved.id } });
        await tx.assessmentScore.createMany({ data: assessment.scores.map((score) => ({ assessmentId: saved.id, ...score })) });
        if (assessment.annotations.length) await tx.assessmentAnnotation.createMany({ data: assessment.annotations.map((annotation) => ({ assessmentId: saved.id, ...annotation })) });
        await tx.assignmentSubmission.update({ where: { id: submission.id }, data: { status: assessment.revisionRequest ? "REVISION_REQUESTED" : "ASSESSED" } });
        entity = saved;
      } else {
        const submission = await tx.assignmentSubmission.findFirst({ where: { id: data.submissionId, organisationId, status: "ASSESSED", contributors: { some: { contributorId: data.contributorId } } }, include: { assessment: true } });
        if (!submission?.assessment) throw new Error("Assess the submission before adding private portfolio evidence.");
        const evidence = normalizePortfolioEvidence(data);
        entity = await tx.portfolioEntry.upsert({ where: { submissionId_contributorId: { submissionId: submission.id, contributorId: data.contributorId } }, create: { organisationId, contributorId: data.contributorId, submissionId: submission.id, assessmentId: submission.assessment.id, title: evidence.title, projectRole: evidence.projectRole, reflection: evidence.reflection, skillsJson: evidence.skills, status: "PRIVATE", createdByUserId: access.user.id }, update: { assessmentId: submission.assessment.id, title: evidence.title, projectRole: evidence.projectRole, reflection: evidence.reflection, skillsJson: evidence.skills, status: "PRIVATE", createdByUserId: access.user.id } });
      }
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `SCHOOL_LEARNING_${data.action}`, entityType: data.action.includes("ASSIGNMENT") && !data.action.includes("SUBMISSION") ? "Assignment" : data.action === "ASSESS_SUBMISSION" ? "Assessment" : data.action === "ADD_PORTFOLIO_ENTRY" ? "PortfolioEntry" : "AssignmentSubmission", entityId: entity.id, details: { staffManagedOnly: true, publicPublishingEnabled: false } } });
      return entity;
    });
    return NextResponse.json({ result }, { status: new Set(["CREATE_ASSIGNMENT", "SUBMIT_ASSIGNMENT", "ADD_PORTFOLIO_ENTRY"]).has(data.action) ? 201 : 200 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That learning-workspace record already exists." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The learning action could not be completed." }, { status: error?.status || 409 });
  }
}
