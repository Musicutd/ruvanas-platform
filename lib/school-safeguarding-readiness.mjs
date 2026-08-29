export const SCHOOL_SAFEGUARDING_READINESS_POLICY_VERSION = "school-safeguarding-readiness-v1";

export const SCHOOL_CONSENT_MODELS = Object.freeze([
  "SCHOOL_POLICY",
  "PARENT_OR_GUARDIAN",
  "BOTH"
]);

export const SCHOOL_STUDENT_IDENTITY_MODES = Object.freeze([
  "DISABLED",
  "INVITATION_ONLY",
  "IDENTITY_FEDERATION"
]);

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function optionalInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error("Age and retention values must be whole numbers.");
  return number;
}

export function normalizeTargetCountries(values) {
  if (!Array.isArray(values)) throw new Error("Target countries must be provided as a list.");
  const countries = [...new Set(values.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))];
  if (countries.length > 20) throw new Error("Choose no more than 20 target countries.");
  if (countries.some((country) => !/^[A-Z]{2}$/.test(country))) {
    throw new Error("Use two-letter country codes, for example MT, GB or US.");
  }
  return countries;
}

export function normalizeSchoolSafeguardingReadiness(input = {}) {
  const minimumStudentAge = optionalInteger(input.minimumStudentAge);
  const maximumStudentAge = optionalInteger(input.maximumStudentAge);
  if ((minimumStudentAge === null) !== (maximumStudentAge === null)) {
    throw new Error("Provide both the minimum and maximum student age.");
  }
  if (minimumStudentAge !== null && (minimumStudentAge < 3 || maximumStudentAge > 24 || minimumStudentAge > maximumStudentAge)) {
    throw new Error("Student ages must form a valid range between 3 and 24.");
  }

  const rawRecordingRetentionDays = optionalInteger(input.rawRecordingRetentionDays);
  if (rawRecordingRetentionDays !== null && (rawRecordingRetentionDays < 1 || rawRecordingRetentionDays > 3650)) {
    throw new Error("Raw-recording retention must be between 1 and 3650 days.");
  }
  const consentEvidenceRetentionDays = optionalInteger(input.consentEvidenceRetentionDays);
  if (consentEvidenceRetentionDays !== null && (consentEvidenceRetentionDays < 30 || consentEvidenceRetentionDays > 3650)) {
    throw new Error("Consent-evidence retention must be between 30 and 3650 days.");
  }

  const consentModel = input.consentModel || null;
  if (consentModel && !SCHOOL_CONSENT_MODELS.includes(consentModel)) throw new Error("Choose a supported consent model.");
  const studentIdentityMode = input.studentIdentityMode || "DISABLED";
  if (!SCHOOL_STUDENT_IDENTITY_MODES.includes(studentIdentityMode)) throw new Error("Choose a supported student identity approach.");

  const privacyContactEmail = optionalText(input.privacyContactEmail)?.toLowerCase() || null;
  if (privacyContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyContactEmail)) {
    throw new Error("Provide a valid school privacy contact email.");
  }

  return {
    targetCountries: normalizeTargetCountries(input.targetCountries || []),
    minimumStudentAge,
    maximumStudentAge,
    consentModel,
    studentIdentityMode,
    privacyContactEmail,
    rawRecordingRetentionDays,
    consentEvidenceRetentionDays,
    localPolicyReference: optionalText(input.localPolicyReference),
    notes: optionalText(input.notes),
    staffModerationConfirmed: Boolean(input.staffModerationConfirmed),
    noDirectMessagingConfirmed: Boolean(input.noDirectMessagingConfirmed),
    privateByDefaultConfirmed: Boolean(input.privateByDefaultConfirmed)
  };
}

export function schoolSafeguardingReadinessGaps(record = {}) {
  const gaps = [];
  if (!Array.isArray(record.targetCountries) || !record.targetCountries.length) gaps.push("Add at least one target country.");
  if (record.minimumStudentAge === null || record.minimumStudentAge === undefined || record.maximumStudentAge === null || record.maximumStudentAge === undefined) gaps.push("Confirm the student age range.");
  if (!record.consentModel) gaps.push("Choose the school and guardian consent model.");
  if (!record.privacyContactEmail) gaps.push("Add the school privacy contact.");
  if (!record.rawRecordingRetentionDays) gaps.push("Set the raw-recording retention period.");
  if (!record.consentEvidenceRetentionDays) gaps.push("Set the consent-evidence retention period.");
  if (!record.localPolicyReference) gaps.push("Reference the approved local safeguarding or privacy policy.");
  if (!record.staffModerationConfirmed) gaps.push("Confirm staff moderation before publishing or sharing.");
  if (!record.noDirectMessagingConfirmed) gaps.push("Confirm that direct student messaging remains disabled.");
  if (!record.privateByDefaultConfirmed) gaps.push("Confirm that student work remains private by default.");
  return gaps;
}

export function assertSchoolSafeguardingReadyForReview(record) {
  const gaps = schoolSafeguardingReadinessGaps(record);
  if (gaps.length) throw new Error(gaps[0]);
  return { status: "READY_FOR_REVIEW", gaps: [] };
}

export function schoolStudentAccessSafetyState(record = {}) {
  return {
    requestedIdentityMode: record.studentIdentityMode || "DISABLED",
    directStudentAccessEnabled: false,
    publicPublishingEnabled: false,
    directMessagingEnabled: false,
    readinessStatus: record.status || "DRAFT"
  };
}
