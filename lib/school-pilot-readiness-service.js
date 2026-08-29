import { prisma } from "@/lib/prisma";
import {
  deriveSchoolPilotReadiness,
  normalizeSchoolRetentionHold,
  schoolRetentionCandidatePreview
} from "@/lib/school-pilot-readiness.mjs";

function retentionCutoff(days, now) {
  const number = Number(days);
  if (!Number.isInteger(number) || number <= 0) return null;
  return new Date(now.getTime() - number * 86_400_000);
}

export async function assertSchoolRetentionHoldReference(organisationId, input) {
  const hold = normalizeSchoolRetentionHold(input);
  if (hold.scope === "ORGANISATION") return hold;
  const lookups = {
    EPISODE: () => prisma.schoolEpisode.findFirst({ where: { id: hold.referenceId, organisationId }, select: { id: true } }),
    CONTRIBUTOR: () => prisma.studentContributor.findFirst({ where: { id: hold.referenceId, organisationId }, select: { id: true } }),
    MEDIA_ASSET: () => prisma.mediaAsset.findFirst({ where: { id: hold.referenceId, organisationId }, select: { id: true } })
  };
  const record = await lookups[hold.scope]();
  if (!record) throw new Error("The referenced school record was not found in this organisation.");
  return hold;
}

export async function loadSchoolPilotReadiness(organisationId, now = new Date()) {
  const [safeguarding, checklist, holds, activeHoldCount, currentPublicEpisodes] = await Promise.all([
    prisma.schoolSafeguardingReadiness.findUnique({
      where: { organisationId },
      select: { status: true, rawRecordingRetentionDays: true, consentEvidenceRetentionDays: true, updatedAt: true }
    }),
    prisma.schoolPilotReadiness.findUnique({ where: { organisationId } }),
    prisma.schoolRetentionHold.findMany({
      where: { organisationId, releasedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { createdBy: { select: { name: true, email: true } } }
    }),
    prisma.schoolRetentionHold.count({ where: { organisationId, releasedAt: null } }),
    prisma.schoolPodcastEpisode.count({ where: { organisationId, status: "PUBLISHED", publicationScope: "PUBLIC" } })
  ]);

  const rawCutoff = retentionCutoff(safeguarding?.rawRecordingRetentionDays, now);
  const consentCutoff = retentionCutoff(safeguarding?.consentEvidenceRetentionDays, now);
  const [rawRecordings, consentEvidence] = await Promise.all([
    rawCutoff ? prisma.audioTake.count({ where: { organisationId, createdAt: { lt: rawCutoff } } }) : 0,
    consentCutoff ? prisma.consentRecord.count({ where: { organisationId, createdAt: { lt: consentCutoff } } }) : 0
  ]);

  const value = checklist || {
    status: "IN_PROGRESS",
    staffTrainingConfirmed: false,
    emergencyWithdrawalDrillConfirmed: false,
    retentionReviewConfirmed: false,
    supportContactsConfirmed: false,
    recoveryPlanConfirmed: false,
    notes: null,
    readyAt: null,
    updatedAt: null
  };
  const readiness = deriveSchoolPilotReadiness({ checklist: value, safeguarding: safeguarding || {}, activeHoldCount });
  const retention = schoolRetentionCandidatePreview({ safeguarding: safeguarding || {}, counts: { rawRecordings, consentEvidence }, now });

  return {
    checklist: value,
    readiness,
    retention,
    holds,
    operations: {
      currentPublicEpisodes,
      emergencyWithdrawalRequiresManager: true,
      recoveryCheckRequired: true,
      automaticDeletionEnabled: false
    },
    safeguarding: safeguarding || {
      status: "NOT_CONFIGURED",
      rawRecordingRetentionDays: null,
      consentEvidenceRetentionDays: null,
      updatedAt: null
    }
  };
}

