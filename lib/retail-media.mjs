const PARTNER_KINDS = new Set(["ADVERTISER", "AGENCY"]);
const PRICE_MODELS = new Set(["FIXED_FEE", "PER_PLAY", "CPM", "CUSTOM"]);
const TARGET_TYPES = new Set(["BRAND", "LOCATION_GROUP", "ZONE"]);
const REVIEW_ACTIONS = new Set([
  "SUBMIT_ORDER",
  "APPROVE_CREATIVE",
  "REJECT_CREATIVE",
  "APPROVE_ORDER",
  "REJECT_ORDER",
  "CANCEL_ORDER"
]);

export const RETAIL_MEDIA_REPORTING_NOTICE =
  "Audio and visual plays are device-confirmed delivery events. They are not listeners, viewers, impressions or proof that media caused an operational outcome.";

function requiredText(value, label, maxLength = 160) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function optionalText(value, label, maxLength = 500) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function identifier(value, label) {
  const text = requiredText(value, label, 191);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function isoDate(value, label) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

function integer(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

export function normaliseRetailMediaPartner(input = {}) {
  const kind = String(input.kind || "").trim().toUpperCase();
  if (!PARTNER_KINDS.has(kind)) throw new Error("Partner type must be advertiser or agency.");
  const contactEmail = optionalText(input.contactEmail, "Contact email", 254)?.toLowerCase() || null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new Error("Contact email is invalid.");
  }
  return {
    organisationId: identifier(input.organisationId, "Organisation"),
    kind,
    name: requiredText(input.name, "Partner name", 160),
    legalName: optionalText(input.legalName, "Legal name", 200),
    contactName: optionalText(input.contactName, "Contact name", 160),
    contactEmail,
    contactPhone: optionalText(input.contactPhone, "Contact phone", 60),
    billingReference: optionalText(input.billingReference, "Billing reference", 120)
  };
}

export function normaliseInventoryTargets(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw new Error("Choose between 1 and 100 inventory targets.");
  }
  const targets = input.map((item) => {
    const targetType = String(item?.targetType || "").trim().toUpperCase();
    if (!TARGET_TYPES.has(targetType)) throw new Error("Inventory target type is invalid.");
    const targetId = identifier(item?.targetId, "Inventory target");
    return {
      targetType,
      brandId: targetType === "BRAND" ? targetId : null,
      locationGroupId: targetType === "LOCATION_GROUP" ? targetId : null,
      zoneId: targetType === "ZONE" ? targetId : null
    };
  });
  const keys = targets.map((target) => `${target.targetType}:${target.brandId || target.locationGroupId || target.zoneId}`);
  if (new Set(keys).size !== keys.length) throw new Error("Inventory targets must be unique.");
  return targets;
}

export function normaliseInventoryDayparts(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw new Error("Choose between 1 and 100 inventory dayparts.");
  }
  const dayparts = input.map((item) => {
    const weekday = integer(item?.weekday, "Weekday", 0, 6);
    const startMinute = integer(item?.startMinute, "Daypart start", 0, 1439);
    const endMinute = integer(item?.endMinute, "Daypart end", 1, 1440);
    if (endMinute <= startMinute) throw new Error("Each inventory daypart must end after it starts.");
    return { weekday, startMinute, endMinute };
  });
  const keys = dayparts.map((item) => `${item.weekday}:${item.startMinute}:${item.endMinute}`);
  if (new Set(keys).size !== keys.length) throw new Error("Inventory dayparts must be unique.");
  return dayparts;
}

export function normaliseRetailMediaInventory(input = {}) {
  const effectiveFrom = isoDate(input.effectiveFrom, "Inventory start date");
  const effectiveTo = isoDate(input.effectiveTo, "Inventory end date");
  if (effectiveTo < effectiveFrom) throw new Error("Inventory end date cannot be before its start date.");
  const priceModel = String(input.priceModel || "").trim().toUpperCase();
  if (!PRICE_MODELS.has(priceModel)) throw new Error("Inventory price model is invalid.");
  const currencyCode = optionalText(input.currencyCode, "Currency code", 3)?.toUpperCase() || null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Currency code must be a three-letter ISO code.");
  const unitPriceMinor = input.unitPriceMinor == null || input.unitPriceMinor === ""
    ? null
    : integer(input.unitPriceMinor, "Unit price", 0, 2_147_483_647);
  if (priceModel !== "CUSTOM" && (!currencyCode || unitPriceMinor == null)) {
    throw new Error("Choose a currency and unit price for this price model.");
  }
  return {
    organisationId: identifier(input.organisationId, "Organisation"),
    name: requiredText(input.name, "Inventory package name", 160),
    description: optionalText(input.description, "Description", 1000),
    priceModel,
    currencyCode,
    unitPriceMinor,
    maxPlays: integer(input.maxPlays, "Maximum plays", 1, 10_000_000),
    effectiveFrom,
    effectiveTo,
    restrictionNotes: optionalText(input.restrictionNotes, "Restriction notes", 2000),
    targets: normaliseInventoryTargets(input.targets),
    dayparts: normaliseInventoryDayparts(input.dayparts)
  };
}

export function normaliseRetailMediaOrder(input = {}) {
  const creativeIds = Array.isArray(input.creativePromoVersionIds)
    ? input.creativePromoVersionIds.map((value) => identifier(value, "Creative promo version"))
    : [];
  const visualCreativeIds = Array.isArray(input.visualAssetIds)
    ? input.visualAssetIds.map((value) => identifier(value, "Visual creative"))
    : [];
  if (creativeIds.length + visualCreativeIds.length < 1 || creativeIds.length + visualCreativeIds.length > 40) throw new Error("Choose between 1 and 40 approved audio or visual creatives for the order.");
  if (new Set(creativeIds).size !== creativeIds.length) throw new Error("Order creatives must be unique.");
  if (new Set(visualCreativeIds).size !== visualCreativeIds.length) throw new Error("Order visual creatives must be unique.");
  return {
    organisationId: identifier(input.organisationId, "Organisation"),
    advertiserId: identifier(input.advertiserId, "Advertiser"),
    agencyId: input.agencyId ? identifier(input.agencyId, "Agency") : null,
    inventoryPackageId: identifier(input.inventoryPackageId, "Inventory package"),
    campaignId: input.campaignId ? identifier(input.campaignId, "Campaign") : null,
    name: requiredText(input.name, "Order name", 160),
    purchaseOrderReference: optionalText(input.purchaseOrderReference, "Purchase-order reference", 120),
    creativePromoVersionIds: creativeIds,
    visualAssetIds: visualCreativeIds
  };
}

export function normaliseRetailMediaReview(input = {}) {
  const action = String(input.action || "").trim().toUpperCase();
  if (!REVIEW_ACTIONS.has(action)) throw new Error("Retail-media review action is invalid.");
  return {
    action,
    creativeId: action.includes("CREATIVE") ? identifier(input.creativeId, "Creative") : null,
    creativeType: action.includes("CREATIVE") && String(input.creativeType || "AUDIO").toUpperCase() === "VISUAL" ? "VISUAL" : "AUDIO",
    note: optionalText(input.note, "Review note", 1000)
  };
}

export function retailMediaOrderApprovalBlockers(order, now = new Date()) {
  const blockers = [];
  if (order?.status !== "SUBMITTED") blockers.push("Only a submitted order can be approved.");
  if (order?.inventoryPackage?.status !== "ACTIVE") blockers.push("The inventory package must be active.");
  const date = new Date(now).toISOString().slice(0, 10);
  const starts = order?.inventoryPackage?.effectiveFrom
    ? new Date(order.inventoryPackage.effectiveFrom).toISOString().slice(0, 10)
    : null;
  const ends = order?.inventoryPackage?.effectiveTo
    ? new Date(order.inventoryPackage.effectiveTo).toISOString().slice(0, 10)
    : null;
  if (!starts || !ends || date < starts || date > ends) blockers.push("The inventory package is outside its effective dates.");
  const creatives = [...(Array.isArray(order?.creatives) ? order.creatives : []), ...(Array.isArray(order?.visualCreatives) ? order.visualCreatives : [])];
  if (!creatives.length) blockers.push("The order needs at least one audio or visual creative.");
  if (creatives.some((creative) => creative.status !== "APPROVED")) {
    blockers.push("Every creative must be approved before the order can be approved.");
  }
  return blockers;
}
