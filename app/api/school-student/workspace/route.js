import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveSchoolStudent } from "@/lib/school-student-access";
import { schoolStudentSafetyBoundary } from "@/lib/school-student-access.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const student = await requireActiveSchoolStudent();
  if (!student.ok) return NextResponse.json({ error: student.error }, { status: student.status });
  const organisationId = student.organisation.id;
  const contributorId = student.contributor.id;
  const studentGroupId = student.contributor.studentGroupId;

  const [assignments, episodes, submissions, portfolio] = await Promise.all([
    prisma.assignment.findMany({
      where: { organisationId, studentGroupId, status: "OPEN" },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        brief: true,
        templateCode: true,
        allowedTools: true,
        dueAt: true,
        programme: { select: { id: true, title: true } },
        rubric: { select: { title: true, criteria: { orderBy: { position: "asc" }, select: { label: true, description: true, maxScore: true, position: true } } } }
      }
    }),
    prisma.schoolEpisode.findMany({
      where: { organisationId, status: { not: "ARCHIVED" }, contributors: { some: { contributorId } } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, summary: true, status: true, publicationScope: true, updatedAt: true, programme: { select: { title: true } } }
    }),
    prisma.assignmentSubmission.findMany({
      where: { organisationId, contributors: { some: { contributorId } } },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        status: true,
        revision: true,
        reflection: true,
        submittedAt: true,
        assignment: { select: { id: true, title: true } },
        assessment: {
          select: {
            status: true,
            totalScore: true,
            maximumScore: true,
            narrativeNotes: true,
            revisionRequest: true,
            releasedAt: true,
            scores: { select: { score: true, notes: true, criterion: { select: { label: true, maxScore: true, position: true } } } }
          }
        }
      }
    }),
    prisma.portfolioEntry.findMany({
      where: { organisationId, contributorId, status: "PRIVATE" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, projectRole: true, reflection: true, skillsJson: true, updatedAt: true }
    })
  ]);

  return NextResponse.json({
    student: {
      displayName: student.contributor.displayName,
      group: {
        name: student.contributor.studentGroup.name,
        academicYear: student.contributor.studentGroup.academicYear
      }
    },
    school: { name: student.organisation.name },
    assignments,
    episodes,
    submissions: submissions.map((submission) => ({
      ...submission,
      assessment: submission.assessment?.status === "RELEASED" ? submission.assessment : null
    })),
    portfolio,
    safety: schoolStudentSafetyBoundary()
  });
}
