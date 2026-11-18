// Browser-safe projection for the separately approved Test Retail pilot.
// Never expose stored grants, signatures, provider secrets or media paths.
export const RETAIL_PILOT_ACCESS_ORGANISATION = "cmvmeq5880005lf2knwtw1b93";
export const isRetailPilotAccessOrganisation = value => value === RETAIL_PILOT_ACCESS_ORGANISATION;
const invalid = () => { throw new Error("Retail music access could not be verified. Refresh access status before continuing."); };

export function safeRetailPilotAccessView(value, organisationId) {
  if (!isRetailPilotAccessOrganisation(organisationId) || !value ||
      !["eligible", "approved", "canApprove", "canRevoke"].every(key => typeof value[key] === "boolean") ||
      value.territory !== "MT" || value.catalogueLevel !== "FOCUSED" ||
      !Array.isArray(value.sourceScopes) || value.sourceScopes.length !== 2 ||
      !value.sourceScopes.includes("RUVANAS_CORE") || !value.sourceScopes.includes("LICENSED_CATALOGUE") ||
      !Number.isSafeInteger(value.eligibleTrackCount) || value.eligibleTrackCount < 0 || value.eligibleTrackCount >= 5000 ||
      value.blocker != null && (typeof value.blocker !== "string" || !/^RETAIL_PILOT_ACCESS_[A-Z_]{1,80}$/.test(value.blocker))) invalid();
  let expiresAt = null;
  if (value.expiresAt != null) {
    if (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) invalid();
    expiresAt = new Date(value.expiresAt).toISOString();
  }
  if (value.approved && (!value.eligible || !expiresAt || value.canApprove || value.blocker) ||
      value.canApprove && (!value.eligible || !expiresAt || value.approved || value.blocker)) invalid();
  return { eligible: value.eligible, approved: value.approved, canApprove: value.canApprove, canRevoke: value.canRevoke,
    territory: "MT", catalogueLevel: "FOCUSED", sourceScopes: ["RUVANAS_CORE", "LICENSED_CATALOGUE"],
    eligibleTrackCount: value.eligibleTrackCount, expiresAt, blocker: value.blocker || null };
}

export function retailPilotAccessRequest(action, confirmed, view, organisationId) {
  const safe = safeRetailPilotAccessView(view, organisationId);
  if (confirmed !== true || !["approve", "revoke"].includes(action) ||
      action === "approve" && !safe.canApprove || action === "revoke" && !safe.canRevoke) {
    throw new Error("Refresh Retail access and confirm this action before continuing.");
  }
  return { action, confirmed: true };
}

const notices = Object.freeze({
  OWNER_REQUIRED: "Only the current owner administrator can approve Retail music access.",
  TARGET_UNAVAILABLE: "Test Retail’s saved connection needs review before music access can be approved. An existing pilot permission can still be revoked.",
  TESTER_UNAVAILABLE: "Test Retail’s private account or access period needs review before music access can be approved.",
  STOP_REQUIRED: "Confirm that this Retail stream is stopped before changing its music access.",
  CONFIRMATION_REQUIRED: "Confirm the Retail-only access change before continuing.",
  SIGNING_UNAVAILABLE: "Retail access approval is not available on this host yet.",
  CATALOGUE_REVIEW_REQUIRED: "The proposed catalogue access needs review. Existing music-rights checks remain in place.",
  ORIGIN_REQUIRED: "Refresh this page from the Ruvanas website before trying again.",
  UNAVAILABLE: "Retail music access could not be verified. Refresh access status before continuing."
});
export function retailPilotAccessNotice(value) {
  const key = typeof value === "string" ? value.replace(/^RETAIL_PILOT_ACCESS_/, "") : "";
  return Object.hasOwn(notices, key) ? notices[key] : notices.UNAVAILABLE;
}
