import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import {
  SCHOOL_STUDENT_ACCESS_POLICY_VERSION,
  assertSchoolStudentInvitationEligibility,
  hashSchoolStudentInvitationToken
} from "@/lib/school-student-access.mjs";

const acceptSchema = z.object({
  token: z.string().trim().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(12).max(128)
});

export async function POST(request) {
  const parsed = acceptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Use the complete invitation link and choose a password of at least 12 characters." }, { status: 400 });
  }

  const rateLimit = await consumeRateLimit({
    key: createRateLimitKey("school-student-accept", request, parsed.data.token.slice(0, 16)),
    limit: 8,
    windowMs: 30 * 60 * 1000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Ask your school to issue a new invitation later." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  }

  try {
    const tokenHash = hashSchoolStudentInvitationToken(parsed.data.token);
    const invitation = await prisma.schoolStudentAccess.findUnique({
      where: { invitationTokenHash: tokenHash },
      include: {
        organisation: { include: { schoolSafeguardingReadiness: true } },
        contributor: { include: { consentRecords: { where: { episodeId: null }, orderBy: { createdAt: "desc" } } } }
      }
    });
    const now = new Date();
    if (!invitation || invitation.status !== "INVITED" || !invitation.invitationExpiresAt || invitation.invitationExpiresAt <= now) {
      return NextResponse.json({ error: "This invitation is invalid or has expired. Ask your school to issue a new one." }, { status: 410 });
    }
    assertSchoolStudentInvitationEligibility({
      readiness: invitation.organisation.schoolSafeguardingReadiness,
      contributor: invitation.contributor,
      consentRecords: invitation.contributor.consentRecords,
      existingAccess: invitation,
      now
    });

    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    if (existingUser) throw new Error("This email is already in use. Ask your school to contact Ruvanas safeguarding support.");
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const student = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: invitation.contributor.displayName,
          email: invitation.email,
          passwordHash,
          role: "STUDENT"
        }
      });
      const activation = await tx.schoolStudentAccess.updateMany({
        where: {
          id: invitation.id,
          status: "INVITED",
          userId: null,
          revokedAt: null,
          invitationTokenHash: tokenHash,
          invitationExpiresAt: { gt: now }
        },
        data: {
          userId: user.id,
          status: "ACTIVE",
          invitationTokenHash: null,
          invitationExpiresAt: null,
          acceptedAt: now,
          revokedAt: null
        }
      });
      if (activation.count !== 1) throw new Error("This invitation changed while it was being accepted. Ask your school for a new link.");
      await tx.auditLog.create({
        data: {
          organisationId: invitation.organisationId,
          actorUserId: user.id,
          action: "SCHOOL_STUDENT_INVITATION_ACCEPTED",
          entityType: "SchoolStudentAccess",
          entityId: invitation.id,
          details: { contributorId: invitation.contributorId, policyVersion: SCHOOL_STUDENT_ACCESS_POLICY_VERSION }
        }
      });
      return user;
    });

    await createSession(student.id);
    return NextResponse.json({ success: true, destination: "/school-student" });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "This invitation can no longer be accepted. Ask your school for help." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The invitation could not be accepted." }, { status: 409 });
  }
}
