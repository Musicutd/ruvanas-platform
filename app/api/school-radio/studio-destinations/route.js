import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { ORGANISATION_CONTENT_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { transitionSchoolEpisode } from "@/lib/school-radio.mjs";
import {
  STUDIO_PRODUCT_DESTINATIONS,
  assertStudioRenderReady,
  studioDestinationAvailability,
  studioHandoffKey,
  studioWorkflowPath
} from "@/lib/studio-product-handoff.mjs";
import { GENERAL_STUDIO_AUDIO_PROJECT_WHERE, assertGeneralStudioAudioProject, generalStudioUsableMediaAssetIds, lockGeneralStudioAudioProject } from "@/lib/studio-general-asset-boundary.mjs";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  renderId: z.string().cuid(),
  destination: z.enum(["RETAIL_PROMOTION", "SCHOOL_EPISODE", "ONLINE_PODCAST", "HEALTH_ANNOUNCEMENT", "HEALTH_PODCAST", "FAITH_SERMON", "FAITH_ANNOUNCEMENT", "FAITH_PODCAST", "ORGANISATIONS_ANNOUNCEMENT", "ORGANISATIONS_PODCAST", "ORGANISATIONS_EVENT"])
});

async function requireActiveStudio() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context?.membership) return { ok: false, status: 401, error: "Sign in and choose your organisation." };
  if (!isOrganisationRoleAllowed(context.membership.role, ORGANISATION_CONTENT_ROLES)) return { ok: false, status: 403, error: "You do not have permission to send Studio outputs." };
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.serviceEnabled) return { ok: false, status: 403, error: "Studio is unavailable while this service is inactive." };
  return { ok: true, user: context.user, membership: context.membership, organisation, entitlements };
}

const renderInclude = {
  project: { select: { id: true, title: true, episodeId: true, currentVersion: true } },
  outputMediaAsset: { select: { id: true, name: true, status: true, durationSeconds: true } },
  outputPromoVersion: { select: { id: true, version: true, status: true, qcStatus: true, promoAssetId: true, mediaAssetId: true } }
};

async function findRender(database, renderId, organisationId) {
  return database.audioRender.findFirst({
    where: { id: renderId, organisationId, project: { is: { type: "MULTITRACK", status: { not: "ARCHIVED" }, ...GENERAL_STUDIO_AUDIO_PROJECT_WHERE } } },
    include: renderInclude
  });
}

async function lockedGeneralRender(tx, renderId, organisationId) {
  // C3 submission takes this same project lock before making a render private.
  // ReadCommitted gives the checks after the lock a fresh statement snapshot.
  // Serializable would retain the locator's pre-C3 snapshot if C3 only locked
  // the project row and inserted a submission without updating that row.
  const locator = await tx.audioRender.findFirst({
    where: { id: renderId, organisationId },
    select: { projectId: true }
  });
  if (!locator) return null;
  await lockGeneralStudioAudioProject(tx, organisationId, locator.projectId);
  return findRender(tx, renderId, organisationId);
}

async function runLockedHandoffTransaction(operation) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      // An identical handoff can win the unique key, or a concurrent School
      // rundown edit can deadlock with the project-first handoff lock order.
      // Both roll back atomically; replay the entire locked decision so every
      // approval, visibility and destination check runs again.
      const deadlock = error?.code === "P2034" || (error?.code === "P2010" && error?.meta?.code === "40P01");
      if ((error?.code !== "P2002" && !deadlock) || attempt === 3) throw error;
    }
  }
}

async function assertGeneralHandoffOutput(database, organisationId, render) {
  await assertGeneralStudioAudioProject(database, organisationId, render.projectId);
  const ids = [...new Set([render.outputMediaAsset?.id, render.outputPromoVersion?.mediaAssetId].filter(Boolean))];
  const usable = await generalStudioUsableMediaAssetIds(database, organisationId, ids);
  if (usable.size !== ids.length) throw Object.assign(new Error("This Studio output is unavailable in general Studio."), { status: 403 });
}

function publicHandoff(handoff) {
  return {
    id: handoff.id,
    destination: handoff.destination,
    workflowPath: handoff.workflowPath,
    targetEpisodeId: handoff.targetEpisodeId,
    createdAt: handoff.createdAt
  };
}

export async function GET(request) {
  const access = await requireActiveStudio();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const renderId = new URL(request.url).searchParams.get("renderId");
  if (!renderId) return NextResponse.json({ error: "Choose a Studio output." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const render = await lockedGeneralRender(tx, renderId, access.organisation.id);
      if (!render) return null;
      await assertGeneralHandoffOutput(tx, access.organisation.id, render);
      const handoffs = await tx.studioProductHandoff.findMany({ where: { renderId, organisationId: access.organisation.id }, orderBy: { createdAt: "asc" } });
      return { render, handoffs };
    }, { isolationLevel: "ReadCommitted" });
    if (!result) return NextResponse.json({ error: "The Studio output was not found." }, { status: 404 });
    return NextResponse.json({
      destinations: studioDestinationAvailability({ entitlements: access.entitlements, project: result.render.project }),
      handoffs: result.handoffs.map(publicHandoff)
    });
  } catch (error) {
    if (error?.code === "CORRECTIONS_STUDIO_OUTPUT_BLOCKED") {
      return NextResponse.json({ error: "The Studio output was not found." }, { status: 404 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "This Studio output is unavailable." }, { status: error?.status || 403 });
  }
}

export async function POST(request) {
  const access = await requireActiveStudio();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a Studio output and product destination." }, { status: 400 });
  const { renderId, destination } = parsed.data;
  const definition = STUDIO_PRODUCT_DESTINATIONS[destination];

  try {
    const result = await runLockedHandoffTransaction(async (tx) => {
      const render = assertStudioRenderReady(await lockedGeneralRender(tx, renderId, access.organisation.id));
      await assertGeneralHandoffOutput(tx, access.organisation.id, render);
      if (!access.entitlements[definition.entitlement]) {
        throw Object.assign(new Error(`${definition.label} is not included in this organisation's current plan.`), { status: 403 });
      }
      const targetEpisodeId = destination === "SCHOOL_EPISODE" ? render.project.episodeId : null;
      if (destination === "SCHOOL_EPISODE" && !targetEpisodeId) throw new Error("Link this Studio project to a School episode first.");
      const destinationKey = studioHandoffKey({ renderId, destination, targetEpisodeId });
      const existing = await tx.studioProductHandoff.findUnique({ where: { destinationKey } });
      if (existing) return { handoff: existing, reused: true };

      const workflowPath = studioWorkflowPath({
        destination,
        promoVersionId: render.outputPromoVersion.id,
        mediaAssetId: render.outputMediaAsset.id,
        targetEpisodeId
      });
      let schoolSubmission = null;
      if (destination === "SCHOOL_EPISODE") {
        const episode = await tx.schoolEpisode.findFirst({
          where: { id: targetEpisodeId, organisationId: access.organisation.id },
          include: { submissions: { orderBy: { revision: "desc" }, take: 1 } }
        });
        if (!episode) throw new Error("The linked School episode was not found.");
        const transition = transitionSchoolEpisode({ currentStatus: episode.status, action: "SUBMIT", hasSubmission: true });
        await tx.schoolSubmission.updateMany({ where: { episodeId: episode.id, status: "SUBMITTED" }, data: { status: "SUPERSEDED" } });
        schoolSubmission = await tx.schoolSubmission.create({ data: {
          organisationId: access.organisation.id,
          episodeId: episode.id,
          promoVersionId: render.outputPromoVersion.id,
          revision: (episode.submissions[0]?.revision || 0) + 1,
          notes: `Studio F handoff from ${render.project.title}.`,
          submittedByUserId: access.user.id
        } });
        await tx.schoolEpisode.update({ where: { id: episode.id }, data: transition });
        await tx.audioProject.update({ where: { id: render.project.id }, data: { status: "SUBMITTED" } });
      }

      const created = await tx.studioProductHandoff.create({ data: {
        organisationId: access.organisation.id,
        projectId: render.project.id,
        renderId: render.id,
        promoVersionId: render.outputPromoVersion.id,
        mediaAssetId: render.outputMediaAsset.id,
        targetEpisodeId,
        destination,
        destinationKey,
        workflowPath,
        snapshot: {
          projectTitle: render.project.title,
          projectVersion: render.project.currentVersion,
          renderPreset: render.preset,
          outputName: render.outputMediaAsset.name,
          outputDurationSeconds: render.outputMediaAsset.durationSeconds,
          promoVersion: render.outputPromoVersion.version,
          product: definition.product,
          schoolSubmissionId: schoolSubmission?.id || null,
          billingMutation: false,
          publicPublication: false
        },
        createdByUserId: access.user.id
      } });
      await tx.auditLog.create({ data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: "STUDIO_PRODUCT_HANDOFF_CREATED",
        entityType: "StudioProductHandoff",
        entityId: created.id,
        details: { destination, renderId: render.id, projectId: render.project.id, targetEpisodeId, publicPublication: false, billingMutation: false }
      } });
      return { handoff: created, reused: false };
    });
    return NextResponse.json({ handoff: publicHandoff(result.handoff), reused: result.reused }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The Studio handoff could not be created." }, { status: error?.status || 409 });
  }
}
