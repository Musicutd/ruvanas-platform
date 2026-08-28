import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { assessConnectionQuality, automaticLiveFallback, transitionLiveStudio, validateLiveRecording, validateLiveWindow } from "@/lib/school-podcast-live.mjs";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE"), title: z.string().trim().min(2).max(180), programmeId: z.string().cuid(), episodeId: z.string().cuid().optional().nullable(), channelId: z.string().cuid(), fallbackPromoVersionId: z.string().cuid(), scheduledStart: z.string().datetime(), scheduledEnd: z.string().datetime(), recordEnabled: z.boolean().default(false), retentionApproved: z.boolean().default(false) }),
  z.object({ action: z.literal("START_SOUNDCHECK"), sessionId: z.string().cuid() }),
  z.object({ action: z.literal("SAVE_SOUNDCHECK"), sessionId: z.string().cuid(), deviceLabel: z.string().trim().max(200).optional().nullable(), latencyMs: z.number().min(0).max(10000), packetLossPercent: z.number().min(0).max(100), microphoneDetected: z.boolean(), levelDetected: z.boolean() }),
  z.object({ action: z.enum(["APPROVE_CONNECTION", "GO_LIVE", "FORCE_FALLBACK", "END"]), sessionId: z.string().cuid(), reason: z.string().trim().max(1000).optional().nullable() })
]);

const include = {
  programme: { select: { id: true, title: true } },
  episode: { select: { id: true, title: true } },
  channel: { select: { id: true, name: true, status: true } },
  fallbackPromoVersion: { select: { id: true, version: true, status: true, promoAsset: { select: { id: true, name: true } } } },
  supervisor: { select: { id: true, name: true, email: true } },
  recordingMediaAsset: { select: { id: true, name: true, durationSeconds: true } }
};

function managerRequired(access) {
  return isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)
    ? null
    : NextResponse.json({ error: "An organisation owner or manager must supervise this live control action." }, { status: 403 });
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const [sessions, programmes, episodes, channels, fallbackVersions] = await Promise.all([
    prisma.liveStudioSession.findMany({ where: { organisationId }, orderBy: { scheduledStart: "desc" }, take: 100, include }),
    prisma.schoolProgramme.findMany({ where: { organisationId, status: "ACTIVE" }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.schoolEpisode.findMany({ where: { organisationId, status: { in: ["DRAFT", "IN_REVIEW", "APPROVED"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, programmeId: true } }),
    prisma.channel.findMany({ where: { organisationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.promoVersion.findMany({ where: { status: "APPROVED", promoAsset: { organisationId, status: "ACTIVE" }, mediaAsset: { organisationId, status: "READY" } }, orderBy: [{ promoAsset: { name: "asc" } }, { version: "desc" }], take: 150, select: { id: true, version: true, promoAsset: { select: { id: true, name: true } } } })
  ]);
  return NextResponse.json({ sessions, programmes, episodes, channels, fallbackVersions, permissions: { canSupervise: isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES) }, safety: { automaticFallbackRequired: true, recordingRequiresRetentionApproval: true, certifiedEmergencySystem: false } });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the live studio details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = access.organisation.id;
  try {
    let result;
    let goLiveToken = null;
    if (data.action === "CREATE") {
      const denied = managerRequired(access);
      if (denied) return denied;
      const window = validateLiveWindow(data);
      validateLiveRecording(data);
      const [programme, episode, channel, fallback] = await Promise.all([
        prisma.schoolProgramme.findFirst({ where: { id: data.programmeId, organisationId, status: "ACTIVE" }, select: { id: true } }),
        data.episodeId ? prisma.schoolEpisode.findFirst({ where: { id: data.episodeId, organisationId, programmeId: data.programmeId }, select: { id: true } }) : null,
        prisma.channel.findFirst({ where: { id: data.channelId, organisationId, status: "ACTIVE" }, select: { id: true } }),
        prisma.promoVersion.findFirst({ where: { id: data.fallbackPromoVersionId, status: "APPROVED", promoAsset: { organisationId, status: "ACTIVE" }, mediaAsset: { organisationId, status: "READY" } }, select: { id: true } })
      ]);
      if (!programme || (data.episodeId && !episode) || !channel || !fallback) throw new Error("Choose an active programme, matching episode, channel, and approved fallback audio from this school.");
      result = await prisma.liveStudioSession.create({ data: { organisationId, programmeId: programme.id, episodeId: episode?.id || null, channelId: channel.id, fallbackPromoVersionId: fallback.id, supervisorUserId: access.user.id, title: data.title, scheduledStart: window.scheduledStart, scheduledEnd: window.scheduledEnd, recordEnabled: data.recordEnabled, retentionApproved: data.retentionApproved } });
    } else {
      const session = await prisma.liveStudioSession.findFirst({ where: { id: data.sessionId, organisationId } });
      if (!session) return NextResponse.json({ error: "The live studio session was not found." }, { status: 404 });
      if (data.action === "SAVE_SOUNDCHECK") {
        if (!new Set(["SOUNDCHECK", "ON_AIR"]).has(session.status)) throw new Error("Start the soundcheck before saving connection results.");
        const quality = assessConnectionQuality(data);
        const fallback = automaticLiveFallback({ currentStatus: session.status, connectionQuality: quality });
        result = await prisma.liveStudioSession.update({ where: { id: session.id }, data: { connectionQuality: quality, soundcheckJson: { deviceLabel: data.deviceLabel || null, latencyMs: data.latencyMs, packetLossPercent: data.packetLossPercent, microphoneDetected: data.microphoneDetected, levelDetected: data.levelDetected, checkedAt: new Date().toISOString() }, ...fallback } });
      } else {
        if (data.action !== "START_SOUNDCHECK") {
          const denied = managerRequired(access);
          if (denied) return denied;
        }
        if (data.action === "GO_LIVE") {
          const now = new Date();
          if (now < new Date(session.scheduledStart.getTime() - 30 * 60 * 1000) || now >= session.scheduledEnd) throw new Error("This go-live token is available only from 30 minutes before the scheduled window until its end.");
        }
        const transition = transitionLiveStudio({ currentStatus: session.status, action: data.action, connectionQuality: session.connectionQuality, reason: data.reason });
        const updates = { ...transition };
        if (data.action === "GO_LIVE") {
          goLiveToken = randomBytes(32).toString("hex");
          updates.goLiveTokenHash = createHash("sha256").update(goLiveToken).digest("hex");
          updates.goLiveTokenExpiresAt = new Date(Math.min(session.scheduledEnd.getTime(), Date.now() + 15 * 60 * 1000));
        }
        if (new Set(["FORCE_FALLBACK", "END"]).has(data.action)) {
          updates.goLiveTokenHash = null;
          updates.goLiveTokenExpiresAt = null;
        }
        result = await prisma.liveStudioSession.update({ where: { id: session.id }, data: updates });
      }
    }
    await prisma.auditLog.create({ data: { organisationId, actorUserId: access.user.id, action: `LIVE_STUDIO_${data.action}`, entityType: "LiveStudioSession", entityId: result.id, details: { status: result.status, connectionQuality: result.connectionQuality, reason: data.reason || null } } });
    const hydrated = await prisma.liveStudioSession.findUnique({ where: { id: result.id }, include });
    return NextResponse.json({ session: hydrated, goLiveToken, tokenNotice: goLiveToken ? "This short-lived token is shown once and is scoped to this session and time window." : null }, { status: data.action === "CREATE" ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The live studio action could not be completed." }, { status: 409 });
  }
}

