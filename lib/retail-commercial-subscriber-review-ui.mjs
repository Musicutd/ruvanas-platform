import { RETAIL_PLANNER_STATION_ID } from "./retail-weekly-planner-ui.mjs";
import { normaliseRetailCommercialDraft } from "./retail-commercial-policy.mjs";

export const RETAIL_COMMERCIAL_SCHEDULE_APPROVAL_ENDPOINT = "/api/programming/test-retail/commercials/approve";
const draftId = value => typeof value === "string" && /^retail-commercial-[a-f0-9]{40}$/.test(value);
const approvalId = value => typeof value === "string" && /^retail-commercial-approval-[a-f0-9]{40}$/.test(value);
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const fail = () => { throw new Error("The commercial schedule review could not be verified. Refresh the saved review before approving."); };

export function retailCommercialSubscriberReview(body) {
  if (body?.stationId !== RETAIL_PLANNER_STATION_ID || body.organisationId !== "cmvmeq5880005lf2knwtw1b93" || body.timezone !== "Europe/Malta" ||
      body.reviewOnly !== true || body.adminApprovalRequired !== false || body.subscriberApprovalRequired !== true || body.scheduleApprovalRequired !== "SUBSCRIBER" ||
      typeof body.canApprove !== "boolean" || !(body.baseApprovalId === null || approvalId(body.baseApprovalId)) || !(body.reviewHash === null || digest(body.reviewHash)) ||
      !Array.isArray(body.spots) || body.spots.length > 100 || body.spots.some(spot => !id(spot.id) || typeof spot.name !== "string" || spot.name.length > 160 ||
        !Number.isInteger(spot.version) || spot.version < 1 || !Number.isInteger(spot.durationSeconds) || spot.durationSeconds < 1 || spot.durationSeconds > 600) ||
      new Set(body.spots.map(spot => spot.id)).size !== body.spots.length) fail();
  let draft = null, approval = null;
  if (body.draft !== null) {
    if (!draftId(body.draft?.id) || !Number.isInteger(body.draft.version) || body.draft.version < 1 || !date(body.draft.savedAt)) fail();
    let values; try { values = normaliseRetailCommercialDraft({ name: body.draft.name, timezone: body.draft.timezone, rules: body.draft.rules }); } catch { fail(); }
    draft = { ...values, id: body.draft.id, version: body.draft.version, savedAt: body.draft.savedAt };
  }
  if (body.approval !== null) {
    const current = body.approval;
    if (!approvalId(current?.id) || !draftId(current.draftId) || !Number.isInteger(current.sequence) || current.sequence < 1 ||
        !Number.isInteger(current.draftVersion) || current.draftVersion < 1 || !date(current.approvedAt) || current.id !== body.baseApprovalId) fail();
    approval = { id: current.id, draftId: current.draftId, sequence: current.sequence, draftVersion: current.draftVersion, approvedAt: current.approvedAt };
  } else if (body.baseApprovalId !== null) fail();
  if (body.canApprove && (!draft || !digest(body.reviewHash) || approval?.draftId === draft.id || draft.rules.some(rule => rule.spotIds.some(spotId => !body.spots.some(spot => spot.id === spotId))))) fail();
  return { stationId: body.stationId, organisationId: body.organisationId, timezone: "Europe/Malta", reviewOnly: true,
    adminApprovalRequired: false, subscriberApprovalRequired: true, scheduleApprovalRequired: "SUBSCRIBER", canApprove: body.canApprove,
    draft, approval, baseApprovalId: body.baseApprovalId, reviewHash: body.reviewHash,
    spots: body.spots.map(({ id, name, version, durationSeconds }) => ({ id, name, version, durationSeconds })),
    warnings: (Array.isArray(body.warnings) ? body.warnings : []).filter(value => typeof value === "string" && value.length <= 500).slice(0, 20) };
}

export function retailCommercialSubscriberApprovalBody(view, { requestId, responsibilityConfirmed, savedDraftId, hasUnsavedChanges }) {
  if (hasUnsavedChanges || responsibilityConfirmed !== true || view?.canApprove !== true || view?.draft?.id !== savedDraftId || !digest(view.reviewHash) ||
      typeof requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId))
    throw new Error("Save your changes and review the exact saved schedule before approving it for air.");
  return { draftId: view.draft.id, reviewHash: view.reviewHash, baseApprovalId: view.baseApprovalId, requestId, responsibilityConfirmed: true };
}
