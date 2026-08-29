import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { SCHOOL_PUBLICATION_POLICY_VERSION } from "@/lib/school-publication.mjs";

const schema = z.object({ enabled: z.boolean().nullable() });

export async function PATCH(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can change public School Radio publishing." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose whether controlled public school publishing is enabled." }, { status: 400 });
  const { organisationId } = await params;

  try {
    const organisation = await prisma.organisation.findUnique({
      where: { id: String(organisationId || "") },
      include: { subscription: { include: { plan: true } } }
    });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    if (!organisation.subscription) return NextResponse.json({ error: "Add a subscription before enabling public publishing." }, { status: 409 });

    const subscription = organisation.subscription;
    const previousOverride = subscription.schoolPublicPublishingEnabled;
    const previousEffective = Boolean(previousOverride ?? subscription.plan.schoolPublicPublishingEnabled);
    const nextOverride = parsed.data.enabled;
    const nextEffective = Boolean(nextOverride ?? subscription.plan.schoolPublicPublishingEnabled);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({ where: { id: subscription.id }, data: { schoolPublicPublishingEnabled: nextOverride } });
      const withdrawn = !nextEffective
        ? await tx.schoolPodcastEpisode.findMany({ where: { organisationId: organisation.id, status: "PUBLISHED", publicationScope: "PUBLIC" }, select: { id: true, publicationRevision: true } })
        : [];
      if (withdrawn.length) {
        await tx.schoolPodcastEpisode.updateMany({
          where: { id: { in: withdrawn.map((item) => item.id) } },
          data: { status: "UNPUBLISHED", unpublishedAt: now, lastPolicyCheckAt: now, unpublishReason: "Public publishing capability disabled." }
        });
        await tx.schoolPublicationDecision.createMany({ data: withdrawn.map((item) => ({
          organisationId: organisation.id,
          podcastEpisodeId: item.id,
          actorUserId: access.user.id,
          decision: "AUTO_WITHDRAWN",
          reason: "Public publishing capability disabled.",
          policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION,
          policySnapshot: { previousEffective, nextEffective, publicationRevision: item.publicationRevision }
        })) });
      }
      await tx.auditLog.create({ data: {
        organisationId: organisation.id,
        actorUserId: access.user.id,
        action: nextOverride == null ? "SCHOOL_PUBLIC_PUBLISHING_ENTITLEMENT_RESET" : nextEffective ? "SCHOOL_PUBLIC_PUBLISHING_ENTITLEMENT_ENABLED" : "SCHOOL_PUBLIC_PUBLISHING_ENTITLEMENT_DISABLED",
        entityType: "Subscription",
        entityId: subscription.id,
        details: { previousOverride, nextOverride, previousEffective, nextEffective, withdrawnPodcastCount: withdrawn.length, policyVersion: SCHOOL_PUBLICATION_POLICY_VERSION }
      } });
      return { updated, withdrawnCount: withdrawn.length };
    });

    return NextResponse.json({
      ok: true,
      subscription: { id: result.updated.id, schoolPublicPublishingEnabled: result.updated.schoolPublicPublishingEnabled, effectiveSchoolPublicPublishingEnabled: nextEffective },
      withdrawnPodcastCount: result.withdrawnCount
    });
  } catch (error) {
    console.error("Update controlled school publishing entitlement error:", error);
    return NextResponse.json({ error: "Unable to update controlled public school publishing." }, { status: 500 });
  }
}
