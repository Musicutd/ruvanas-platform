export const CORRECTIONS_OVERRIDE_CATEGORIES = Object.freeze([
  "OPERATIONAL_INFORMATION", "URGENT_FACILITY_NOTICE", "SAFETY_INSTRUCTION",
  "EMERGENCY_INSTRUCTION", "TEST_DRILL"
]);

export function correctionsAnnouncementPermission({ role, grant, action, facility, tier }) {
  if (!facility || tier < 1 || !["OWNER", "MANAGER", "CONTENT_EDITOR", "VIEWER"].includes(role)) return false;
  const manager = role === "MANAGER" && grant?.permission === "MANAGER";
  const editor = role === "CONTENT_EDITOR" && grant?.permission === "EDITOR";
  if (action === "READ") return role === "OWNER" || manager || editor || (role === "VIEWER" && grant?.permission === "VIEWER");
  if (action === "CREATE") return role === "OWNER" || manager || editor;
  if (action === "APPROVE" || action === "SCHEDULE") return role === "OWNER" || manager;
  if (action === "PRIORITY_ACTIVATE" || action === "PRIORITY_STOP") {
    if (!facility.priorityEnabled) return false;
    return role === "OWNER" || (manager && grant?.[action === "PRIORITY_ACTIVATE" ? "canPriorityActivate" : "canPriorityStop"] === true);
  }
  if (action === "EMERGENCY_ACTIVATE" || action === "EMERGENCY_CLEAR") {
    if (tier < 2 || !facility.emergencyEnabled) return false;
    return (role === "OWNER" || manager) && grant?.[action === "EMERGENCY_ACTIVATE" ? "canEmergencyActivate" : "canEmergencyClear"] === true;
  }
  return false;
}

export function correctionsAnnouncementApproval({ announcement, mode, reviewerId, second = false }) {
  if (!announcement || announcement.status !== "DRAFT" || !reviewerId) return null;
  if (mode === "DUAL") {
    if (second) return announcement.approvedByUserId && announcement.approvedByUserId !== reviewerId && announcement.createdByUserId !== reviewerId ? "APPROVED" : null;
    return !announcement.approvedByUserId && announcement.createdByUserId !== reviewerId ? "FIRST" : null;
  }
  if (mode === "EXPLICIT" && announcement.createdByUserId === reviewerId) return null;
  return "APPROVED";
}

export function chooseCorrectionsOverride(overrides = [], zoneId, instant = new Date()) {
  return overrides.filter((item) => item.status === "ACTIVE" && item.startedAt <= instant && item.expiresAt > instant && item.targetZoneIds.includes(zoneId))
    .sort((a, b) => Number(b.type === "EMERGENCY") - Number(a.type === "EMERGENCY") || b.startedAt - a.startedAt || b.id.localeCompare(a.id))[0] || null;
}

export function correctionsOverrideConflict(active, requestedType) {
  if (!active) return null;
  if (active.type === "EMERGENCY") return "An Emergency override is already active for this area.";
  if (active.type === "PRIORITY" && requestedType === "PRIORITY") return "A Priority override is already active for this area.";
  return null;
}
