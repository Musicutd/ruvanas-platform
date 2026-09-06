import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForAdvancedScheduler } from "@/lib/advanced-scheduler-access";
import { programmeScheduleInclude, programmeSchedulerSources, safeProgrammeSchedule } from "@/lib/advanced-scheduler-service";
import {
  buildProgrammeDirectorPlan,
  canRequestProgrammeDirector,
  canReviewProgrammeDirector,
  normalizeProgrammeDirectorRequest,
  PROGRAMME_DIRECTOR_DAILY_LIMIT,
  programmeDirectorDraftText,
  programmeDirectorProvenance
} from "@/lib/ai-programme-director.mjs";
import { getRequestId } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const jobInclude = {
  requestedBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  metadata: true,
  feedback: { select: { decision: true } }
};

function safeJob(job) {
  const plan = job.input?.programmePlan || null;
  return {
    id: job.id,
    status: job.status,
    assistantType: job.assistantType,
    draftText: job.draftText,
    approvedText: job.approvedText,
    reviewNote: job.reviewNote,
    createdAt: job.createdAt.toISOString(),
    reviewedAt: job.reviewedAt?.toISOString() || null,
    requestedBy: job.requestedBy,
    reviewedBy: job.reviewedBy,
    plan,
    controls: plan?.controls || null,
    applied: job.feedback?.some((entry) => entry.decision === "APPLIED_TO_DRAFT") || false
  };
}

export async function GET() {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { membership } = access.context;
    const organisationId = membership.organisationId;
    const [jobs, sources] = await Promise.all([
      prisma.aIJob.findMany({
        where: { organisationId, assistantType: "PROGRAMME_DIRECTOR" },
        include: jobInclude,
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      programmeSchedulerSources(organisationId)
    ]);
    return NextResponse.json({
      ok: true,
      jobs: jobs.map(safeJob),
      sources: { channels: sources.channels, musicModes: sources.musicModes },
      permissions: {
        canRequest: canRequestProgrammeDirector(membership.role),
        canReview: canReviewProgrammeDirector(membership.role),
        canApply: canReviewProgrammeDirector(membership.role)
      },
      dailyLimit: PROGRAMME_DIRECTOR_DAILY_LIMIT
    });
  } catch (error) {
    console.error("Programme Director list error:", error);
    return NextResponse.json({ error: "Unable to load the Programme Director." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForAdvancedScheduler();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canRequestProgrammeDirector(membership.role)) return NextResponse.json({ error: "Only owners, managers and content editors can request programme recommendations." }, { status: 403 });
    const input = normalizeProgrammeDirectorRequest(await request.json().catch(() => null));
    const organisationId = membership.organisationId;
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const recentCount = await prisma.aIJob.count({ where: { organisationId, assistantType: "PROGRAMME_DIRECTOR", createdAt: { gte: windowStart } } });
    if (recentCount >= PROGRAMME_DIRECTOR_DAILY_LIMIT) return NextResponse.json({ error: `This organisation has reached the ${PROGRAMME_DIRECTOR_DAILY_LIMIT}-recommendation daily safety limit.` }, { status: 429 });

    const [channel, eligibleSources] = await Promise.all([
      prisma.channel.findFirst({
        where: { id: input.channelId, organisationId, status: "ACTIVE" },
        select: { id: true, name: true, station: { select: { name: true } }, programmeSchedule: { include: programmeScheduleInclude } }
      }),
      programmeSchedulerSources(organisationId)
    ]);
    const fallbackMusicMode = eligibleSources.musicModes.find((mode) => mode.id === input.fallbackMusicModeId) || null;
    if (!channel) return NextResponse.json({ error: "Choose an active channel owned by this organisation." }, { status: 404 });
    if (!fallbackMusicMode) return NextResponse.json({ error: "Choose an active, playable continuity music mode." }, { status: 404 });
    const schedule = channel.programmeSchedule ? safeProgrammeSchedule(channel.programmeSchedule) : null;
    const plan = buildProgrammeDirectorPlan({ request: input, channel, fallbackMusicMode, schedule });
    const draftText = programmeDirectorDraftText(plan);
    const provenance = programmeDirectorProvenance(plan);
    const operationRequestId = getRequestId(request);

    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.aIJob.create({
        data: {
          organisationId,
          requestedByUserId: user.id,
          assistantType: "PROGRAMME_DIRECTOR",
          dataClassification: "CUSTOMER_CONTENT",
          providerKey: "RUVANAS_PROGRAMME_RULES_V1",
          providerDataUseApproved: false,
          privateDataSent: false,
          input: { request: input, programmePlan: plan },
          draftText,
          metadata: { create: { providerKey: "RUVANAS_PROGRAMME_RULES_V1", modelKey: "programme-director-rules-v1", provenance } }
        },
        include: jobInclude
      });
      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: user.id,
          action: "AI_PROGRAMME_RECOMMENDATION_CREATED",
          entityType: "AIJob",
          entityId: created.id,
          details: { channelId: plan.channelId, scheduleId: plan.scheduleId, baselineVersionId: plan.baselineVersionId, itemCount: plan.items.length, privateDataSent: false, externalProviderUsed: false, autoPublishAllowed: false, requestId: operationRequestId }
        }
      });
      return created;
    });
    return NextResponse.json({ ok: true, job: safeJob(job), notice: "Recommendation created for human review. Live programming has not changed." }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /required|characters|supported|timezone|channel|music mode|too many|usable plan/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Programme Director creation error:", error);
    return NextResponse.json({ error: "Unable to create the programme recommendation." }, { status: 500 });
  }
}
