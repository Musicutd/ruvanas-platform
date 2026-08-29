import { prisma } from "@/lib/prisma";
import { deriveSchoolPilotReadiness } from "@/lib/school-pilot-readiness.mjs";
import { schoolPilotOperationsSummary } from "@/lib/school-pilot-operations.mjs";

export async function loadCurrentSchoolPilotReadiness(organisationId) {
  const [checklist, safeguarding, activeHoldCount] = await Promise.all([
    prisma.schoolPilotReadiness.findUnique({ where: { organisationId } }),
    prisma.schoolSafeguardingReadiness.findUnique({
      where: { organisationId },
      select: { status: true, rawRecordingRetentionDays: true, consentEvidenceRetentionDays: true }
    }),
    prisma.schoolRetentionHold.count({ where: { organisationId, releasedAt: null } })
  ]);
  return deriveSchoolPilotReadiness({ checklist: checklist || {}, safeguarding: safeguarding || {}, activeHoldCount });
}

export async function loadSchoolPilotOperations(organisationId) {
  const [runs, events, readiness, operationalRun, plannedRuns, openIncidents, criticalOpenIncidents, recordedDrills] = await Promise.all([
    prisma.schoolPilotRun.findMany({
      where: { organisationId },
      orderBy: [{ plannedStartAt: "desc" }, { createdAt: "desc" }],
      take: 30,
      include: {
        createdBy: { select: { name: true, email: true } },
        updatedBy: { select: { name: true, email: true } },
        _count: { select: { events: true } }
      }
    }),
    prisma.schoolPilotEvent.findMany({
      where: { organisationId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        pilotRun: { select: { id: true, title: true, status: true } },
        createdBy: { select: { name: true, email: true } },
        acknowledgedBy: { select: { name: true, email: true } },
        resolvedBy: { select: { name: true, email: true } }
      }
    }),
    loadCurrentSchoolPilotReadiness(organisationId),
    prisma.schoolPilotRun.findFirst({
      where: { organisationId, status: { in: ["ACTIVE", "PAUSED"] } },
      select: { id: true, status: true }
    }),
    prisma.schoolPilotRun.count({ where: { organisationId, status: "PLANNED" } }),
    prisma.schoolPilotEvent.count({ where: { organisationId, kind: "INCIDENT", status: { not: "RESOLVED" } } }),
    prisma.schoolPilotEvent.count({ where: { organisationId, kind: "INCIDENT", severity: "CRITICAL", status: { not: "RESOLVED" } } }),
    prisma.schoolPilotEvent.count({ where: { organisationId, kind: "DRILL" } })
  ]);

  const listSummary = schoolPilotOperationsSummary({ runs, events });

  return {
    readiness,
    summary: {
      ...listSummary,
      operationalRunId: operationalRun?.id || null,
      operationalRunStatus: operationalRun?.status || null,
      plannedRuns,
      openIncidents,
      criticalOpenIncidents,
      recordedDrills
    },
    runs,
    events,
    safeguards: {
      managerRecordedOnly: true,
      contentWithdrawalPerformed: false,
      externalNotificationsSent: false,
      serviceShutdownPerformed: false,
      destructiveActionPerformed: false,
      studentIdentitiesIncluded: false
    }
  };
}
