import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "./retail-subscriber-access.mjs";

export const retailDiagnosticAuditId = versionId => `retail-schedule-diagnostic:${versionId}`;
export async function retailDiagnosticDraft(db, version) {
  const row = await db.auditLog.findUnique({ where: { id: retailDiagnosticAuditId(version.id) } });
  if (!row) return null;
  if (row.organisationId !== ORG || row.entityType !== "ProgrammeScheduleVersion" || row.entityId !== version.id ||
    row.action !== "RETAIL_SCHEDULE_DIAGNOSTIC_DRAFT" || row.details?.stationId !== STATION || row.details?.versionId !== version.id)
    throw Object.assign(new Error("SUBSCRIBER_WORKSPACE_REVIEW_REQUIRED"), { code: "SUBSCRIBER_WORKSPACE_REVIEW_REQUIRED" });
  return row.details;
}

// Owner diagnostics never replace a subscriber's unfinished week. Version
// allocation still uses the global highest number, including diagnostic rows.
export async function retailNormalPlanningVersion(db, versions) {
  for (const version of versions || []) {
    if (await retailDiagnosticDraft(db, version)) continue;
    // A newer normal published version supersedes its older drafts too.
    return version;
  }
  return null;
}
