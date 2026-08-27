import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { SCHOOL_RADIO_POLICY_VERSION } from "@/lib/school-radio.mjs";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().max(1000).optional().nullable(),
  promoVersionId: z.string().cuid(),
  submitForReview: z.boolean().default(true)
});

function announcementInclude() {
  return {
    promoVersion: {
      select: {
        id: true,
        version: true,
        durationSeconds: true,
        promoAsset: { select: { id: true, name: true } },
        mediaAsset: { select: { id: true, originalName: true, mimeType: true } }
      }
    },
    createdBy: { select: { id: true, name: true, email: true } },
    reviewedBy: { select: { id: true, name: true, email: true } },
    broadcastSlots: {
      orderBy: { startsAt: "asc" },
      include: {
        location: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true, location: { select: { id: true, name: true } } } }
      }
    }
  };
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const [profile, announcements, audioVersions, locations] = await Promise.all([
    prisma.schoolProfile.findUnique({ where: { organisationId } }),
    prisma.schoolAnnouncement.findMany({
      where: { organisationId, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
      include: announcementInclude()
    }),
    prisma.promoVersion.findMany({
      where: {
        status: "APPROVED",
        mediaAsset: { organisationId, status: "READY" },
        promoAsset: { organisationId, status: "ACTIVE" }
      },
      orderBy: [{ promoAsset: { name: "asc" } }, { version: "desc" }],
      select: {
        id: true,
        version: true,
        durationSeconds: true,
        promoAsset: { select: { id: true, name: true } },
        mediaAsset: { select: { originalName: true, mimeType: true } }
      }
    }),
    prisma.location.findMany({
      where: { organisationId, status: { not: "CLOSED" } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        timezone: true,
        zones: { where: { status: { not: "OFFLINE" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }
      }
    })
  ]);
  return NextResponse.json({
    organisation: { id: organisationId, name: access.organisation.name },
    role: access.membership.role,
    profile: profile || { displayName: access.organisation.name, publishingPolicy: "PRIVATE", policyVersion: SCHOOL_RADIO_POLICY_VERSION },
    announcements,
    audioVersions,
    locations
  });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Provide a title and choose approved audio." }, { status: 400 });
  const organisationId = access.organisation.id;
  const version = await prisma.promoVersion.findFirst({
    where: {
      id: parsed.data.promoVersionId,
      status: "APPROVED",
      mediaAsset: { organisationId, status: "READY" },
      promoAsset: { organisationId, status: "ACTIVE" }
    },
    select: { id: true }
  });
  if (!version) return NextResponse.json({ error: "Choose audio that is approved for this organisation." }, { status: 400 });
  const now = new Date();
  const announcement = await prisma.$transaction(async (tx) => {
    await tx.schoolProfile.upsert({
      where: { organisationId },
      create: { organisationId, displayName: access.organisation.name },
      update: {}
    });
    const created = await tx.schoolAnnouncement.create({
      data: {
        organisationId,
        promoVersionId: version.id,
        title: parsed.data.title,
        summary: parsed.data.summary || null,
        status: parsed.data.submitForReview ? "IN_REVIEW" : "DRAFT",
        submittedAt: parsed.data.submitForReview ? now : null,
        createdByUserId: access.user.id,
        policyVersion: SCHOOL_RADIO_POLICY_VERSION
      },
      include: announcementInclude()
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId: access.user.id,
        action: parsed.data.submitForReview ? "SCHOOL_ANNOUNCEMENT_SUBMITTED" : "SCHOOL_ANNOUNCEMENT_CREATED",
        entityType: "SchoolAnnouncement",
        entityId: created.id,
        details: { promoVersionId: version.id, policyVersion: SCHOOL_RADIO_POLICY_VERSION }
      }
    });
    return created;
  });
  return NextResponse.json({ announcement }, { status: 201 });
}
