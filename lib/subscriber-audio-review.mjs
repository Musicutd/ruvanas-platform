export const SUBSCRIBER_AUDIO_EDITOR_ROLES = Object.freeze([
  "OWNER",
  "MANAGER",
  "CONTENT_EDITOR"
]);

const FAILED_JOB_STATUSES = new Set(["FAILED", "CANCELLED"]);
const ACTIVE_JOB_STATUSES = new Set(["QUEUED", "RUNNING"]);

export function canManageSubscriberAudio(role) {
  return SUBSCRIBER_AUDIO_EDITOR_ROLES.includes(role);
}

export function subscriberAudioProcessingSummary(version) {
  const jobs = Array.isArray(version?.processingJobs)
    ? version.processingJobs
    : [];
  const failed = jobs.filter((job) => FAILED_JOB_STATUSES.has(job.status));
  const active = jobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status));

  if (version?.mediaAsset?.status !== "READY") {
    return {
      state: "PROCESSING",
      label: "Securing audio",
      canSubmit: false,
      message: "The audio file is still being secured. Refresh shortly."
    };
  }

  if (failed.length > 0) {
    return {
      state: "FAILED",
      label: "Needs attention",
      canSubmit: false,
      message: "A technical audio check needs attention before this version can be submitted."
    };
  }

  if (active.length > 0) {
    return {
      state: "CHECKING",
      label: "Checks continuing",
      canSubmit: version?.status === "DRAFT",
      message: "The file passed its secure upload checks. Technical analysis will continue during review."
    };
  }

  return {
    state: "READY",
    label: "Checks complete",
    canSubmit: version?.status === "DRAFT",
    message: "The audio is ready to submit for Ruvanas review."
  };
}

export function subscriberAudioReviewState(version) {
  const processing = subscriberAudioProcessingSummary(version);

  if (version?.status === "DRAFT") {
    return {
      key: processing.state === "FAILED" ? "ACTION_REQUIRED" : "DRAFT",
      label: processing.canSubmit ? "Ready to submit" : processing.label,
      description: processing.message,
      canSubmit: processing.canSubmit,
      canReplace: processing.state === "FAILED"
    };
  }

  if (version?.status === "IN_REVIEW") {
    return {
      key: "IN_REVIEW",
      label: "With Ruvanas for review",
      description: "Ruvanas is completing the final quality and rights review.",
      canSubmit: false,
      canReplace: false
    };
  }

  if (version?.status === "APPROVED") {
    return {
      key: "APPROVED",
      label: "Approved",
      description: "This version can now be scheduled in the Promotions Planner.",
      canSubmit: false,
      canReplace: false
    };
  }

  if (version?.status === "REJECTED") {
    return {
      key: "REJECTED",
      label: "Changes requested",
      description: version.qcNotes || "Upload a corrected replacement for another review.",
      canSubmit: false,
      canReplace: true
    };
  }

  return {
    key: "SUPERSEDED",
    label: "Previous version",
    description: "A newer approved version has replaced this one.",
    canSubmit: false,
    canReplace: false
  };
}

export function prepareSubscriberPromoSubmission(version) {
  if (version?.status !== "DRAFT") {
    throw new Error("Only a draft audio version can be submitted for review.");
  }

  const processing = subscriberAudioProcessingSummary(version);
  if (!processing.canSubmit) {
    throw new Error(processing.message);
  }

  return {
    status: "IN_REVIEW",
    qcStatus: "PENDING"
  };
}
