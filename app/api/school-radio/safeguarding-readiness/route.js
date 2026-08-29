import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import {
  assertSchoolSafeguardingReadyForReview,
  isSchoolSafeguardingPackLocked,
  normalizeSchoolSafeguardingReadiness,
  schoolSafeguardingReadinessGaps,
  schoolStudentAccessSafetyState
} from "@/lib/school-safeguarding-readiness.mjs";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  action: z.enum(["SAVE_DRAFT", "SUBMIT_FOR_REVIEW"]),
  targetCountries: z.array(z.string()).max(20).default([]),
  minimumStudentAge: z.union([z.number(), z.string(), z.null()]).optional(),
  maximumStudentAge: z.union([z.number(), z.string(), z.null()]).optional(),
  consentModel: z.enum(["SCHOOL_POLICY", "PARENT_OR_GUARDIAN", "BOTH"]).optional().nullable(),
  studentIdentityMode: z.enum(["DISABLED", "INVITATION_ONLY", "IDENTITY_FEDERATION"]).default("DISABLED"),
  privacyContactEmail: z.string().trim().max(254).optional().nullable(),
  rawRecordingRetentionDays: z.union([z.number(), z.string(), z.null()]).optional(),
  consentEvidenceRetentionDays: z.union([z.number(), z.string(), z.null()]).optional(),
  localPolicyReference: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(3000).optional().nullable(),
  staffModerationConfirmed: z.boolean().default(false),
  noDirectMessagingConfirmed: z.boolean().default(false),
  privateByDefaultConfirmed: z.boolean().default(false)
});

function emptyReadiness(organisationId) {
  return {
    organisationId,
    status: "DRAFT",
    targetCountries: [],
    minimumStudentAge: null,
    maximumStudentAge: null,
    consentModel: null,
    studentIdentityMode: "DISABLED",
    privacyContactEmail: null,
    rawRecordingRetentionDays: null,
    consentEvidenceRetentionDays: null,
    localPolicyReference: null,
    notes: null,
    staffModerationConfirmed: false,
    noDirectMessagingConfirmed: false,
    privateByDefaultConfirmed: false,
    submittedAt: null
  };
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const readiness = await prisma.schoolSafeguardingReadiness.findUnique({
    where: { organisationId: access.organisation.id },
    include: {
      reviews: {
        include: { reviewer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5
      }
    }
  });
  const value = readiness || emptyReadiness(access.organisation.id);
  const locked = isSchoolSafeguardingPackLocked(value.status);
  return NextResponse.json({
    readiness: value,
    gaps: schoolSafeguardingReadinessGaps(value),
    safety: schoolStudentAccessSafetyState(value),
    permissions: {
      canManage: ORGANISATION_MANAGER_ROLES.includes(access.membership.role) && !locked,
      locked,
      lockedReason: value.status === "READY_FOR_REVIEW" ? "Submitted packs are locked while Ruvanas reviews them." : value.status === "APPROVED" ? "Approved packs are preserved as reviewed evidence." : null
    }
  });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the safeguarding-readiness details and try again." }, { status: 400 });
  try {
    const existing = await prisma.schoolSafeguardingReadiness.findUnique({ where: { organisationId: access.organisation.id }, select: { status: true } });
    if (existing && isSchoolSafeguardingPackLocked(existing.status)) {
      return NextResponse.json({ error: existing.status === "APPROVED" ? "This approved readiness pack is locked as reviewed evidence." : "This readiness pack is currently under Ruvanas review." }, { status: 409 });
    }
    const normalized = normalizeSchoolSafeguardingReadiness(parsed.data);
    if (parsed.data.action === "SUBMIT_FOR_REVIEW") assertSchoolSafeguardingReadyForReview(normalized);
    const status = parsed.data.action === "SUBMIT_FOR_REVIEW" ? "READY_FOR_REVIEW" : "DRAFT";
    const now = new Date();
    const readiness = await prisma.$transaction(async (tx) => {
      const saved = await tx.schoolSafeguardingReadiness.upsert({
        where: { organisationId: access.organisation.id },
        create: {
          organisationId: access.organisation.id,
          ...normalized,
          status,
          submittedAt: status === "READY_FOR_REVIEW" ? now : null,
          submittedByUserId: status === "READY_FOR_REVIEW" ? access.user.id : null
        },
        update: {
          ...normalized,
          status,
          submittedAt: status === "READY_FOR_REVIEW" ? now : null,
          submittedByUserId: status === "READY_FOR_REVIEW" ? access.user.id : null
        }
      });
      await tx.auditLog.create({ data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: status === "READY_FOR_REVIEW" ? "SCHOOL_SAFEGUARDING_READINESS_SUBMITTED" : "SCHOOL_SAFEGUARDING_READINESS_SAVED",
        entityType: "SchoolSafeguardingReadiness",
        entityId: saved.id,
        details: {
          status,
          targetCountries: normalized.targetCountries,
          studentIdentityMode: normalized.studentIdentityMode,
          directStudentAccessEnabled: false,
          publicPublishingEnabled: false
        }
      } });
      return saved;
    });
    return NextResponse.json({ readiness, gaps: schoolSafeguardingReadinessGaps(readiness), safety: schoolStudentAccessSafetyState(readiness) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The readiness pack could not be saved." }, { status: 409 });
  }
}
