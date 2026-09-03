export const PROMOTION_WEEKDAYS = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
]);

const DRAFT_ROLES = Object.freeze(["OWNER", "MANAGER", "CONTENT_EDITOR"]);
const PUBLISH_ROLES = Object.freeze(["OWNER", "MANAGER"]);

export function canDraftSubscriberPromotions(role) {
  return DRAFT_ROLES.includes(role);
}

export function canPublishSubscriberPromotions(role) {
  return PUBLISH_ROLES.includes(role);
}

export function requirePromotionPreview({ previewAcknowledged }) {
  if (previewAcknowledged !== true) {
    throw new Error("Review the campaign preview before saving this promotion.");
  }
  return true;
}

export function subscriberPromotionInput(body, organisationId) {
  return {
    organisationId,
    promoVersionId: body.promoVersionId,
    name: body.name,
    priority: body.priority || "NORMAL",
    schedulingMode: body.schedulingMode || "PLAYS_PER_HOUR",
    playsPerHour: body.playsPerHour ?? 2,
    intervalMinutes: body.intervalMinutes ?? 30,
    effectiveFrom: body.effectiveFrom,
    effectiveTo: body.effectiveTo,
    maxPromoMinutesPerHour: 12,
    minSamePromoGapMinutes: 15,
    minAnyPromoGapMinutes: 2,
    mandatory: false,
    respectOpeningHours: body.respectOpeningHours !== false,
    exactTimeHardStart: false,
    targets: body.targets,
    schedules: body.schedules
  };
}

export function describePromotionTarget(target, lookup = {}) {
  if (!target) return "Listening area";
  if (target.targetType === "ALL_LOCATIONS") return "All active locations";
  const id = target.brandId || target.locationGroupId || target.locationId || target.zoneId;
  return lookup[id] || "Selected listening area";
}

export function promotionStatusLabel(campaign, today = new Date().toISOString().slice(0, 10)) {
  if (campaign.status === "PUBLISHED" && String(campaign.effectiveFrom).slice(0, 10) > today) return "UPCOMING";
  if (campaign.status === "PUBLISHED" && String(campaign.effectiveTo).slice(0, 10) < today) return "ENDED";
  return campaign.status;
}

