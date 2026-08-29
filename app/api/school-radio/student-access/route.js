import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import {
  SCHOOL_STUDENT_ACCESS_POLICY_VERSION,
  assertSchoolStudentInvitationEligibility,
  createSchoolStudentInvitation,
  hasCurrentSchoolStudentConsent,
  normalizeStudentEmail,
  schoolStudentSafetyBoundary
} from "@/lib/school-student-access.mjs";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("INVITE"),
    contributorId: z.string().cuid(),
    email: z.string().trim().min(3).max(254)
  }),
  z.object({
    action: z.literal("REVOKE"),
    accessId: z.string().cuid(),
    reason: z.string().trim().min(5).max(500)
  })
]);

const contributorInclude = {
  studentGroup: { select: { id: true, name: true, academicYear: true } },
  consentRecords: {
    where: { episodeId: null },
    orderBy: { createdAt: "desc" }
  },
  studentAccess: {
    select: {
      id: true,
      email: true,
      status: true,
      invitationExpiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true
    }
  }
};

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const [readiness, contributors] = await Promise.all([
    prisma.schoolSafeguardingReadiness.findUnique({
      where: { organisationId: access.organisation.id },
      select: { status: true, studentIdentityMode: true, updatedAt: true }
    }),
    prisma.studentContributor.findMany({
      where: { organisationId: access.organisation.id },
      orderBy: [{ studentGroup: { name: "asc" } }, { displayName: "asc" }],
      include: contributorInclude
    })
  ]);

  return NextResponse.json({
    readiness,
    contributors: contributors.map(({ consentRecords, ...contributor }) => ({
      ...contributor,
      hasCurrentConsent: hasCurrentSchoolStudentConsent(consentRecords)
    })),
    canInvite: readiness?.status === "APPROVED" && readiness.studentIdentityMode === "INVITATION_ONLY",
    safety: schoolStudentSafetyBoundary()
  });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the student-access details and try again." }, { status: 400 });

  try {
    if (parsed.data.action === "REVOKE") {
      const existing = await prisma.schoolStudentAccess.findFirst({
        where: { id: parsed.data.accessId, organisationId: access.organisation.id }
      });
      if (!existing) return NextResponse.json({ error: "The student access record was not found." }, { status: 404 });
      if (existing.status === "REVOKED") return NextResponse.json({ error: "Student access is already revoked." }, { status: 409 });

      const now = new Date();
      const revoked = await prisma.$transaction(async (tx) => {
        const value = await tx.schoolStudentAccess.update({
          where: { id: existing.id },
          data: {
            status: "REVOKED",
            invitationTokenHash: null,
            invitationExpiresAt: null,
            revokedAt: now
          }
        });
        if (value.userId) {
          await tx.session.updateMany({ where: { userId: value.userId, revokedAt: null }, data: { revokedAt: now } });
        }
        await tx.auditLog.create({
          data: {
            organisationId: access.organisation.id,
            actorUserId: access.user.id,
            action: "SCHOOL_STUDENT_ACCESS_REVOKED",
            entityType: "SchoolStudentAccess",
            entityId: existing.id,
            details: { reason: parsed.data.reason, policyVersion: SCHOOL_STUDENT_ACCESS_POLICY_VERSION }
          }
        });
        return value;
      });
      return NextResponse.json({ access: revoked });
    }

    const email = normalizeStudentEmail(parsed.data.email);
    const [readiness, contributor, existingUser] = await Promise.all([
      prisma.schoolSafeguardingReadiness.findUnique({ where: { organisationId: access.organisation.id } }),
      prisma.studentContributor.findFirst({
        where: { id: parsed.data.contributorId, organisationId: access.organisation.id },
        include: { consentRecords: { where: { episodeId: null }, orderBy: { createdAt: "desc" } }, studentAccess: true }
      }),
      prisma.user.findUnique({ where: { email }, select: { id: true } })
    ]);
    assertSchoolStudentInvitationEligibility({
      readiness,
      contributor,
      consentRecords: contributor?.consentRecords || [],
      existingAccess: contributor?.studentAccess || null
    });
    if (existingUser) throw new Error("That email address is already attached to a Ruvanas account.");
    if (contributor.studentAccess?.status === "REVOKED") {
      throw new Error("Revoked student access cannot be reissued automatically. Contact Ruvanas safeguarding support.");
    }

    const emailOwner = await prisma.schoolStudentAccess.findUnique({ where: { email }, select: { id: true, contributorId: true } });
    if (emailOwner && emailOwner.contributorId !== contributor.id) {
      throw new Error("That email address already has a student invitation.");
    }

    const invitation = createSchoolStudentInvitation();
    const studentAccess = await prisma.$transaction(async (tx) => {
      let value;
      if (contributor.studentAccess) {
        const update = await tx.schoolStudentAccess.updateMany({
          where: { id: contributor.studentAccess.id, status: "INVITED", userId: null, revokedAt: null },
          data: {
            email,
            status: "INVITED",
            invitationTokenHash: invitation.tokenHash,
            invitationExpiresAt: invitation.expiresAt,
            invitedByUserId: access.user.id,
            acceptedAt: null,
            revokedAt: null
          }
        });
        if (update.count !== 1) throw new Error("This invitation changed while it was being reissued. Reload and try again.");
        value = await tx.schoolStudentAccess.findUnique({ where: { id: contributor.studentAccess.id } });
      } else {
        value = await tx.schoolStudentAccess.create({
          data: {
            organisationId: access.organisation.id,
            contributorId: contributor.id,
            email,
            invitationTokenHash: invitation.tokenHash,
            invitationExpiresAt: invitation.expiresAt,
            invitedByUserId: access.user.id
          }
        });
      }
      await tx.auditLog.create({
        data: {
          organisationId: access.organisation.id,
          actorUserId: access.user.id,
          action: contributor.studentAccess ? "SCHOOL_STUDENT_INVITATION_REISSUED" : "SCHOOL_STUDENT_INVITATION_CREATED",
          entityType: "SchoolStudentAccess",
          entityId: value.id,
          details: {
            contributorId: contributor.id,
            expiresAt: invitation.expiresAt.toISOString(),
            policyVersion: SCHOOL_STUDENT_ACCESS_POLICY_VERSION
          }
        }
      });
      return value;
    });

    return NextResponse.json({
      access: studentAccess,
      invitationPath: `/school-student/accept#token=${invitation.token}`,
      warning: "This invitation link is shown once. Share it only through the school's approved private channel."
    }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That contributor or email already has student access." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Student access could not be updated." }, { status: 409 });
  }
}
