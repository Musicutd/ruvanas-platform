import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { SCHOOL_PUBLICATION_POLICY_VERSION } from "@/lib/school-publication.mjs";

export const dynamic = "force-dynamic";

const schema = z.object({ publishingPolicy: z.enum(["PRIVATE", "PUBLIC"]), reason: z.string().trim().min(8).max(1000) });

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const [profile, readiness, publicCount] = await Promise.all([
    prisma.schoolProfile.findUnique({ where: { organisationId: access.organisation.id } }),
    prisma.schoolSafeguardingReadiness.findUnique({ where: { organisationId: access.organisation.id }, select: { status: true, updatedAt: true } }),
    prisma.schoolPodcastEpisode.count({ where: { organisationId: access.organisation.id, status: "PUBLISHED", publicationScope: "PUBLIC" } })
  ]);
  return NextResponse.json({
    profile: profile || { displayName: access.organisation.name, publishingPolicy: "PRIVATE", policyVersion: "school-radio-v1" },
    readiness,
    publicPublishingEnabled: access.entitlements.schoolPublicPublishingEnabled,
    publicEpisodeCount: publicCount,
    publicUrl: `/school-radio/${access.organisation.slug}`,
    policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION
  });
}

export async function PATCH(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_MANAGER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a policy and record the reason for the change." }, { status: 400 });
  const organisationId = access.organisation.id;
  const now = new Date();

  try {
    const readiness = await prisma.schoolSafeguardingReadiness.findUnique({ where: { organisationId }, select: { status: true } });
    if (parsed.data.publishingPolicy === "PUBLIC") {
      if (!access.entitlements.schoolPublicPublishingEnabled) return NextResponse.json({ error: "Ruvanas must enable controlled public School Radio publishing first." }, { status: 403 });
      if (readiness?.status !== "APPROVED") return NextResponse.json({ error: "The safeguarding pack must remain approved before the school policy can be public." }, { status: 409 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const profile = await tx.schoolProfile.upsert({
        where: { organisationId },
        create: { organisationId, displayName: access.organisation.name, publishingPolicy: parsed.data.publishingPolicy, policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION },
        update: { publishingPolicy: parsed.data.publishingPolicy, policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION }
      });
      const withdrawn = parsed.data.publishingPolicy === "PRIVATE"
        ? await tx.schoolPodcastEpisode.findMany({ where: { organisationId, status: "PUBLISHED", publicationScope: "PUBLIC" }, select: { id: true, publicationRevision: true } })
        : [];
      if (withdrawn.length) {
        await tx.schoolPodcastEpisode.updateMany({ where: { id: { in: withdrawn.map((item) => item.id) } }, data: { status: "UNPUBLISHED", unpublishedAt: now, lastPolicyCheckAt: now, unpublishReason: parsed.data.reason } });
        await tx.schoolPublicationDecision.createMany({ data: withdrawn.map((item) => ({
          organisationId, podcastEpisodeId: item.id, actorUserId: access.user.id, decision: "AUTO_WITHDRAWN", reason: parsed.data.reason,
          policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION,
          policySnapshot: { publishingPolicy: "PRIVATE", publicationRevision: item.publicationRevision }
        })) });
      }
      await tx.auditLog.create({ data: {
        organisationId, actorUserId: access.user.id, action: `SCHOOL_PUBLICATION_POLICY_${parsed.data.publishingPolicy}`,
        entityType: "SchoolProfile", entityId: profile.id,
        details: { reason: parsed.data.reason, withdrawnPodcastCount: withdrawn.length, policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION }
      } });
      return { profile, withdrawnCount: withdrawn.length };
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("School publication policy error:", error);
    return NextResponse.json({ error: "The school publication policy could not be updated." }, { status: 500 });
  }
}
