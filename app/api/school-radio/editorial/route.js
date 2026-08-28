import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { SCHOOL_RADIO_POLICY_VERSION, transitionSchoolEpisode } from "@/lib/school-radio.mjs";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_GROUP"), name: z.string().trim().min(2).max(120), academicYear: z.string().trim().max(40).optional().nullable(), notes: z.string().trim().max(500).optional().nullable() }),
  z.object({ action: z.literal("CREATE_CONTRIBUTOR"), studentGroupId: z.string().cuid(), displayName: z.string().trim().min(2).max(100), referenceCode: z.string().trim().max(80).optional().nullable() }),
  z.object({ action: z.literal("CREATE_PROGRAMME"), title: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).optional().nullable(), studentGroupId: z.string().cuid().optional().nullable() }),
  z.object({ action: z.literal("CREATE_EPISODE"), programmeId: z.string().cuid(), title: z.string().trim().min(2).max(160), summary: z.string().trim().max(1500).optional().nullable(), contributorIds: z.array(z.string().cuid()).max(50).default([]) }),
  z.object({ action: z.literal("SUBMIT_EPISODE"), episodeId: z.string().cuid(), promoVersionId: z.string().cuid(), notes: z.string().trim().max(1000).optional().nullable() }),
  z.object({ action: z.literal("RECORD_CONSENT"), contributorId: z.string().cuid(), episodeId: z.string().cuid().optional().nullable(), status: z.enum(["PENDING", "GRANTED", "REVOKED"]), notes: z.string().trim().max(1000).optional().nullable(), expiresAt: z.string().datetime().optional().nullable() })
]);

const episodeInclude = {
  programme: { select: { id: true, title: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  contributors: { include: { contributor: { select: { id: true, displayName: true, referenceCode: true, status: true } } } },
  submissions: {
    orderBy: { revision: "desc" },
    include: {
      submittedBy: { select: { id: true, name: true, email: true } },
      promoVersion: { select: { id: true, version: true, status: true, promoAsset: { select: { id: true, name: true } }, mediaAsset: { select: { id: true, originalName: true, mimeType: true } } } },
      reviews: { orderBy: { createdAt: "desc" }, include: { reviewer: { select: { id: true, name: true, email: true } } } }
    }
  }
};

function managerRequired(access) {
  return isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)
    ? null
    : NextResponse.json({ error: "An organisation owner or manager must complete this action." }, { status: 403 });
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

async function currentSupervisor(tx, access) {
  return tx.staffSupervisor.upsert({
    where: { organisationId_userId: { organisationId: access.organisation.id, userId: access.user.id } },
    create: { organisationId: access.organisation.id, userId: access.user.id, displayTitle: "Staff supervisor" },
    update: { active: true }
  });
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const canModerate = isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES);
  const [groups, programmes, episodes, audioVersions, consentRecords] = await Promise.all([
    prisma.studentGroup.findMany({
      where: { organisationId }, orderBy: { name: "asc" },
      include: { supervisor: { include: { user: { select: { id: true, name: true } } } }, contributors: { where: { status: "ACTIVE" }, orderBy: { displayName: "asc" } } }
    }),
    prisma.schoolProgramme.findMany({
      where: { organisationId, status: { not: "ARCHIVED" } }, orderBy: { title: "asc" },
      include: { studentGroup: { select: { id: true, name: true, academicYear: true } }, supervisor: { include: { user: { select: { id: true, name: true } } } }, _count: { select: { episodes: true } } }
    }),
    prisma.schoolEpisode.findMany({ where: { organisationId, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, include: episodeInclude }),
    prisma.promoVersion.findMany({
      where: { status: { in: ["IN_REVIEW", "APPROVED"] }, mediaAsset: { organisationId, status: "READY" }, promoAsset: { organisationId, status: "ACTIVE" } },
      orderBy: [{ promoAsset: { name: "asc" } }, { version: "desc" }],
      select: { id: true, version: true, status: true, durationSeconds: true, promoAsset: { select: { id: true, name: true } }, mediaAsset: { select: { originalName: true, mimeType: true } } }
    }),
    canModerate ? prisma.consentRecord.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" }, take: 250 }) : Promise.resolve([])
  ]);
  return NextResponse.json({
    role: access.membership.role,
    permissions: { canModerate },
    groups, programmes, episodes, audioVersions, consentRecords,
    safety: { publicationScope: "INTERNAL_ONLY", publicPublishingEnabled: false, policyVersion: SCHOOL_RADIO_POLICY_VERSION }
  });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the required editorial details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;
  const managerActions = new Set(["CREATE_GROUP", "CREATE_CONTRIBUTOR", "CREATE_PROGRAMME", "RECORD_CONSENT"]);
  if (managerActions.has(data.action)) {
    const denied = managerRequired(access);
    if (denied) return denied;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let entity;
      if (data.action === "CREATE_GROUP") {
        const supervisor = await currentSupervisor(tx, access);
        entity = await tx.studentGroup.create({ data: { organisationId, supervisorId: supervisor.id, name: data.name, academicYear: data.academicYear || null, notes: data.notes || null, createdByUserId: access.user.id } });
      } else if (data.action === "CREATE_CONTRIBUTOR") {
        const group = await tx.studentGroup.findFirst({ where: { id: data.studentGroupId, organisationId }, select: { id: true } });
        if (!group) throw notFound("The student group was not found.");
        entity = await tx.studentContributor.create({ data: { organisationId, studentGroupId: group.id, displayName: data.displayName, referenceCode: data.referenceCode || null } });
      } else if (data.action === "CREATE_PROGRAMME") {
        if (data.studentGroupId) {
          const group = await tx.studentGroup.findFirst({ where: { id: data.studentGroupId, organisationId }, select: { id: true } });
          if (!group) throw notFound("The student group was not found.");
        }
        const supervisor = await currentSupervisor(tx, access);
        entity = await tx.schoolProgramme.create({ data: { organisationId, studentGroupId: data.studentGroupId || null, supervisorId: supervisor.id, title: data.title, description: data.description || null, status: "ACTIVE", createdByUserId: access.user.id } });
      } else if (data.action === "CREATE_EPISODE") {
        const programme = await tx.schoolProgramme.findFirst({ where: { id: data.programmeId, organisationId, status: "ACTIVE" }, select: { id: true } });
        if (!programme) throw notFound("Choose an active programme.");
        const contributorIds = [...new Set(data.contributorIds)];
        if (contributorIds.length) {
          const count = await tx.studentContributor.count({ where: { id: { in: contributorIds }, organisationId, status: "ACTIVE" } });
          if (count !== contributorIds.length) throw new Error("One or more contributors are not active in this school.");
        }
        entity = await tx.schoolEpisode.create({
          data: { organisationId, programmeId: programme.id, title: data.title, summary: data.summary || null, publicationScope: "INTERNAL_ONLY", createdByUserId: access.user.id, contributors: { create: contributorIds.map((contributorId) => ({ contributorId })) } }
        });
      } else if (data.action === "SUBMIT_EPISODE") {
        const [episode, version] = await Promise.all([
          tx.schoolEpisode.findFirst({ where: { id: data.episodeId, organisationId }, include: { submissions: { orderBy: { revision: "desc" }, take: 1 } } }),
          tx.promoVersion.findFirst({ where: { id: data.promoVersionId, status: { in: ["IN_REVIEW", "APPROVED"] }, mediaAsset: { organisationId, status: "READY" }, promoAsset: { organisationId, status: "ACTIVE" } }, select: { id: true } })
        ]);
        if (!episode) throw notFound("The episode was not found.");
        if (!version) throw new Error("Choose school audio that is ready or approved for this organisation.");
        const transition = transitionSchoolEpisode({ currentStatus: episode.status, action: "SUBMIT", hasSubmission: true });
        await tx.schoolSubmission.updateMany({ where: { episodeId: episode.id, status: "SUBMITTED" }, data: { status: "SUPERSEDED" } });
        entity = await tx.schoolSubmission.create({ data: { organisationId, episodeId: episode.id, promoVersionId: version.id, revision: (episode.submissions[0]?.revision || 0) + 1, notes: data.notes || null, submittedByUserId: access.user.id } });
        await tx.schoolEpisode.update({ where: { id: episode.id }, data: transition });
      } else {
        const contributor = await tx.studentContributor.findFirst({ where: { id: data.contributorId, organisationId }, select: { id: true } });
        if (!contributor) throw notFound("The contributor was not found.");
        if (data.episodeId) {
          const episode = await tx.schoolEpisode.findFirst({ where: { id: data.episodeId, organisationId, contributors: { some: { contributorId: contributor.id } } }, select: { id: true } });
          if (!episode) throw notFound("The contributor is not assigned to that episode.");
        }
        const now = new Date();
        entity = await tx.consentRecord.create({ data: { organisationId, contributorId: contributor.id, episodeId: data.episodeId || null, status: data.status, notes: data.notes || null, policyVersion: SCHOOL_RADIO_POLICY_VERSION, recordedByUserId: access.user.id, grantedAt: data.status === "GRANTED" ? now : null, revokedAt: data.status === "REVOKED" ? now : null, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null } });
      }
      const entityTypes = { CREATE_GROUP: "StudentGroup", CREATE_CONTRIBUTOR: "StudentContributor", CREATE_PROGRAMME: "SchoolProgramme", CREATE_EPISODE: "SchoolEpisode", SUBMIT_EPISODE: "SchoolSubmission", RECORD_CONSENT: "ConsentRecord" };
      await tx.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `SCHOOL_EDITORIAL_${data.action}`, entityType: entityTypes[data.action], entityId: entity.id, details: { policyVersion: SCHOOL_RADIO_POLICY_VERSION } } });
      return entity;
    });
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That school editorial record already exists." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The editorial action could not be completed." }, { status: error?.status || 409 });
  }
}
