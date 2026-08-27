export const PROMO_PROCESSING_JOB_TYPES = Object.freeze([
  "PREVIEW",
  "TRANSCODE",
  "LOUDNESS_ANALYSIS"
]);

const REVIEWABLE_STATUS = "IN_REVIEW";

export function normalizePromoLanguageCode(value) {
  const raw = String(value || "und").trim().replaceAll("_", "-");

  if (!raw || raw.toLowerCase() === "und") {
    return "und";
  }

  const parts = raw.split("-").filter(Boolean);

  if (
    parts.length > 3 ||
    !/^[A-Za-z]{2,3}$/.test(parts[0]) ||
    parts.slice(1).some((part) => !/^[A-Za-z0-9]{2,8}$/.test(part))
  ) {
    throw new Error("Enter a valid language code such as en, mt, or en-GB.");
  }

  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 2 || /^\d{3}$/.test(part)) return part.toUpperCase();
      if (part.length === 4) {
        return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
      }
      return part.toLowerCase();
    })
    .join("-");
}

export function nextPromoVersionNumber(versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    return 1;
  }

  const highest = Math.max(
    0,
    ...versions.map((version) => Number(version?.version || 0))
  );

  return highest + 1;
}

export function buildPromoProcessingJobs() {
  return PROMO_PROCESSING_JOB_TYPES.map((jobType) => ({
    jobType,
    status: "QUEUED"
  }));
}

export function reviewPromoVersion({ currentStatus, decision, notes }) {
  if (currentStatus !== REVIEWABLE_STATUS) {
    throw new Error("Only a version awaiting review can be approved or rejected.");
  }

  const cleanNotes = String(notes || "").trim();

  if (decision === "APPROVE") {
    return {
      status: "APPROVED",
      qcStatus: "PASSED",
      qcNotes: cleanNotes || null
    };
  }

  if (decision === "REJECT") {
    if (!cleanNotes) {
      throw new Error("Explain why the promotional audio failed review.");
    }

    return {
      status: "REJECTED",
      qcStatus: "FAILED",
      qcNotes: cleanNotes
    };
  }

  throw new Error("Choose approve or reject.");
}

