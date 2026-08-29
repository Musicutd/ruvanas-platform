import crypto from "node:crypto";

export const SCHOOL_STUDENT_ACCESS_POLICY_VERSION = "school-student-access-v1";
export const SCHOOL_STUDENT_INVITATION_TTL_DAYS = 7;
export const SCHOOL_STUDENT_INVITATION_MAX_TTL_DAYS = 14;

export function normalizeStudentEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid student email address.");
  }
  return email;
}

export function hashSchoolStudentInvitationToken(token) {
  const value = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("This student invitation is invalid.");
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createSchoolStudentInvitation(now = new Date(), ttlDays = SCHOOL_STUDENT_INVITATION_TTL_DAYS) {
  const days = Number(ttlDays);
  if (!Number.isInteger(days) || days < 1 || days > SCHOOL_STUDENT_INVITATION_MAX_TTL_DAYS) {
    throw new Error(`Student invitations must expire within ${SCHOOL_STUDENT_INVITATION_MAX_TTL_DAYS} days.`);
  }
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashSchoolStudentInvitationToken(token),
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  };
}

export function hasCurrentSchoolStudentConsent(records = [], now = new Date()) {
  const latestSchoolLevelRecord = records
    .filter((record) => !record.episodeId)
    .map((record, position) => ({ record, position }))
    .sort((left, right) => {
      const timeDifference = new Date(right.record.createdAt || 0).getTime() - new Date(left.record.createdAt || 0).getTime();
      return timeDifference || left.position - right.position;
    })[0]?.record;
  return Boolean(
    latestSchoolLevelRecord &&
    latestSchoolLevelRecord.status === "GRANTED" &&
    !latestSchoolLevelRecord.revokedAt &&
    (!latestSchoolLevelRecord.expiresAt || new Date(latestSchoolLevelRecord.expiresAt) > now)
  );
}

export function assertSchoolStudentInvitationEligibility({ readiness, contributor, consentRecords = [], existingAccess = null, now = new Date() } = {}) {
  if (readiness?.status !== "APPROVED") {
    throw new Error("Ruvanas must approve the school safeguarding pack before student invitations are enabled.");
  }
  if (readiness.studentIdentityMode !== "INVITATION_ONLY") {
    throw new Error("The approved safeguarding pack must use invitation-only student identity.");
  }
  if (!contributor || contributor.status !== "ACTIVE") {
    throw new Error("Choose an active student contributor in this school.");
  }
  if (!hasCurrentSchoolStudentConsent(consentRecords, now)) {
    throw new Error("Record current school-level consent for this contributor before inviting them.");
  }
  if (existingAccess?.status === "ACTIVE") {
    throw new Error("This contributor already has active student access.");
  }
  return true;
}

export function assertSchoolStudentAccessActive({ access, now = new Date() } = {}) {
  if (!access || access.status !== "ACTIVE" || access.revokedAt) {
    throw new Error("Student access is not active.");
  }
  assertSchoolStudentInvitationEligibility({
    readiness: access.organisation?.schoolSafeguardingReadiness,
    contributor: access.contributor,
    consentRecords: access.contributor?.consentRecords || [],
    existingAccess: null,
    now
  });
  return true;
}

export function schoolStudentSafetyBoundary() {
  return Object.freeze({
    staffDashboardAccess: false,
    administrationAccess: false,
    directMessagingEnabled: false,
    publicPublishingEnabled: false,
    crossSchoolAuthority: false,
    workspaceMode: "PRIVATE_READ_ONLY"
  });
}
