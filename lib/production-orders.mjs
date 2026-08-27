const STATUS_TRANSITIONS = Object.freeze({
  SUBMIT: { from: new Set(["DRAFT", "CHANGES_REQUESTED"]), to: "SUBMITTED", permission: "content" },
  START_PRODUCTION: { from: new Set(["SUBMITTED"]), to: "IN_PRODUCTION", permission: "platform" },
  RESUME_PRODUCTION: { from: new Set(["CHANGES_REQUESTED"]), to: "IN_PRODUCTION", permission: "platform" },
  REQUEST_APPROVAL: { from: new Set(["IN_PRODUCTION"]), to: "AWAITING_CUSTOMER_APPROVAL", permission: "platform" },
  REQUEST_CHANGES: { from: new Set(["AWAITING_CUSTOMER_APPROVAL"]), to: "CHANGES_REQUESTED", permission: "manager", noteRequired: true },
  APPROVE: { from: new Set(["AWAITING_CUSTOMER_APPROVAL"]), to: "APPROVED", permission: "manager" },
  DELIVER: { from: new Set(["APPROVED"]), to: "DELIVERED", permission: "platform" },
  CANCEL: { from: new Set(["DRAFT", "SUBMITTED", "IN_PRODUCTION", "AWAITING_CUSTOMER_APPROVAL", "CHANGES_REQUESTED"]), to: "CANCELLED", permission: "managerOrPlatform", noteRequired: true }
});

function optionalText(value, maximum, fieldName) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > maximum) throw new Error(`${fieldName} is too long.`);
  return text;
}

function requiredText(value, minimum, maximum, fieldName) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < minimum || text.length > maximum) throw new Error(`Provide a valid ${fieldName.toLowerCase()}.`);
  return text;
}

function optionalDate(value, fieldName, dateOnly = false) {
  if (!value) return null;
  const raw = String(value).trim();
  const date = new Date(dateOnly ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(date.getTime())) throw new Error(`Provide a valid ${fieldName.toLowerCase()}.`);
  return date;
}

export function normaliseProductionOrderPayload(input) {
  const languageCodes = [...new Set((Array.isArray(input?.languageCodes) ? input.languageCodes : [])
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean))];
  if (!languageCodes.length || languageCodes.length > 5 || languageCodes.some((code) => !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code))) {
    throw new Error("Provide between one and five valid language codes.");
  }

  const targetDurationSeconds = input?.targetDurationSeconds === null || input?.targetDurationSeconds === undefined || input?.targetDurationSeconds === ""
    ? null
    : Number(input.targetDurationSeconds);
  if (targetDurationSeconds !== null && (!Number.isInteger(targetDurationSeconds) || targetDurationSeconds < 5 || targetDurationSeconds > 600)) {
    throw new Error("Target duration must be between 5 and 600 seconds.");
  }

  const campaignStartsOn = optionalDate(input?.campaignStartsOn, "campaign start date", true);
  const campaignEndsOn = optionalDate(input?.campaignEndsOn, "campaign end date", true);
  if (Boolean(campaignStartsOn) !== Boolean(campaignEndsOn)) {
    throw new Error("Provide both campaign dates or leave both empty.");
  }
  if (campaignStartsOn && campaignStartsOn > campaignEndsOn) {
    throw new Error("Campaign end date must be on or after its start date.");
  }

  const contactEmail = requiredText(input?.contactEmail, 3, 254, "contact email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error("Provide a valid contact email.");

  const priority = String(input?.priority || "STANDARD");
  if (!new Set(["STANDARD", "PRIORITY", "URGENT"]).has(priority)) throw new Error("Choose a valid production priority.");
  const fundingType = String(input?.fundingType || "PLAN_INCLUDED");
  if (!new Set(["PLAN_INCLUDED", "PAID_ADD_ON"]).has(fundingType)) throw new Error("Choose how this production order will be funded.");

  return {
    title: requiredText(input?.title, 2, 160, "order title"),
    promotionDetails: requiredText(input?.promotionDetails, 10, 5000, "promotion or offer details"),
    mandatoryLegalWording: optionalText(input?.mandatoryLegalWording, 3000, "Mandatory legal wording"),
    languageCodes,
    voicePreference: optionalText(input?.voicePreference, 160, "Voice preference"),
    toneStyle: optionalText(input?.toneStyle, 160, "Tone and style"),
    targetDurationSeconds,
    musicBedPreference: optionalText(input?.musicBedPreference, 240, "Music-bed preference"),
    campaignStartsOn,
    campaignEndsOn,
    pronunciationNotes: optionalText(input?.pronunciationNotes, 2000, "Pronunciation notes"),
    contactName: requiredText(input?.contactName, 2, 160, "contact name"),
    contactEmail,
    fundingType,
    priority,
    deadlineAt: optionalDate(input?.deadlineAt, "deadline"),
    submitNow: input?.submitNow !== false
  };
}

export function transitionProductionOrder({ currentStatus, action, note = null, permissions = {}, now = new Date() }) {
  const transition = STATUS_TRANSITIONS[action];
  if (!transition || !transition.from.has(currentStatus)) {
    throw new Error(`A ${String(currentStatus).toLowerCase().replaceAll("_", " ")} order cannot be changed with ${String(action).toLowerCase().replaceAll("_", " ")}.`);
  }
  const permitted = transition.permission === "content" ? permissions.canCreate
    : transition.permission === "manager" ? permissions.canManage
      : transition.permission === "platform" ? permissions.canProduce
        : permissions.canManage || permissions.canProduce;
  if (!permitted) throw new Error("You do not have permission to perform this production action.");

  const cleanNote = typeof note === "string" && note.trim() ? note.trim() : null;
  if (cleanNote?.length > 2000) throw new Error("The production note is too long.");
  if (transition.noteRequired && !cleanNote) throw new Error("A reason is required for this production action.");

  return {
    status: transition.to,
    note: cleanNote,
    submittedAt: action === "SUBMIT" ? now : undefined,
    customerApprovedAt: action === "APPROVE" ? now : undefined,
    deliveredAt: action === "DELIVER" ? now : undefined,
    cancelledAt: action === "CANCEL" ? now : undefined
  };
}

export function productionPermissions({ platformRole, membershipRole }) {
  return Object.freeze({
    canCreate: new Set(["OWNER", "MANAGER", "CONTENT_EDITOR"]).has(membershipRole),
    canManage: new Set(["OWNER", "MANAGER"]).has(membershipRole),
    canProduce: new Set(["SUPER_ADMIN", "SUPPORT"]).has(platformRole)
  });
}

export function normaliseProductionScriptPayload(input) {
  const languageCode = requiredText(input?.languageCode, 2, 35, "language code").toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(languageCode)) {
    throw new Error("Provide a valid script language code.");
  }
  return {
    languageCode,
    content: requiredText(input?.content, 10, 12000, "script content"),
    productionNotes: optionalText(input?.productionNotes, 2000, "Production notes")
  };
}

