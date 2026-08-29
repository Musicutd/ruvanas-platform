import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { normaliseSchoolNoticeboardPost, SCHOOL_NOTICEBOARD_POLICY_VERSION } from "@/lib/school-noticeboard.mjs";

export const dynamic = "force-dynamic";

const includePost = {
  announcement: { select: { id: true, title: true, summary: true, status: true } },
  location: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true, location: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true, email: true } },
  cancelledBy: { select: { id: true, name: true, email: true } }
};

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const posts = await prisma.schoolNoticeboardPost.findMany({
    where: { organisationId: access.organisation.id },
    include: includePost,
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    take: 200
  });
  return NextResponse.json({ posts, role: access.membership.role, policyVersion: SCHOOL_NOTICEBOARD_POLICY_VERSION });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  let input;
  try {
    input = normaliseSchoolNoticeboardPost(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The noticeboard schedule is invalid." }, { status: 400 });
  }
  const organisationId = access.organisation.id;
  const [announcement, target, duplicate] = await Promise.all([
    prisma.schoolAnnouncement.findFirst({
      where: { id: input.announcementId, organisationId, status: "APPROVED" },
      select: { id: true, title: true }
    }),
    input.zoneId
      ? prisma.zone.findFirst({ where: { id: input.zoneId, location: { organisationId }, status: { not: "OFFLINE" } }, select: { id: true } })
      : prisma.location.findFirst({ where: { id: input.locationId, organisationId, status: { not: "CLOSED" } }, select: { id: true } }),
    prisma.schoolNoticeboardPost.findFirst({
      where: {
        organisationId,
        announcementId: input.announcementId,
        status: "SCHEDULED",
        locationId: input.locationId,
        zoneId: input.zoneId,
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt }
      },
      select: { id: true }
    })
  ]);
  if (!announcement) return NextResponse.json({ error: "Only a manager-approved announcement can be placed on a noticeboard." }, { status: 400 });
  if (!target) return NextResponse.json({ error: "Choose a location or zone belonging to this school." }, { status: 400 });
  if (duplicate) return NextResponse.json({ error: "This announcement already has an overlapping noticeboard schedule for that target." }, { status: 409 });

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.schoolNoticeboardPost.create({
      data: {
        organisationId,
        ...input,
        policyVersion: SCHOOL_NOTICEBOARD_POLICY_VERSION,
        createdByUserId: access.user.id
      },
      include: includePost
    });
    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId: access.user.id,
        action: "SCHOOL_NOTICEBOARD_SCHEDULED",
        entityType: "SchoolNoticeboardPost",
        entityId: created.id,
        details: {
          announcementId: input.announcementId,
          locationId: input.locationId,
          zoneId: input.zoneId,
          startsAt: input.startsAt.toISOString(),
          endsAt: input.endsAt.toISOString(),
          policyVersion: SCHOOL_NOTICEBOARD_POLICY_VERSION
        }
      }
    });
    return created;
  });
  return NextResponse.json({ post }, { status: 201 });
}
