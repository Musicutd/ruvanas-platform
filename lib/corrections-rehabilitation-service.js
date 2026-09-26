import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { CORRECTIONS_REHAB_CATEGORIES, correctionsC5Features } from "@/lib/corrections-c5-policy.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";

function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }
function text(value, max, label, required = false) {
  if (value != null && typeof value !== "string") throw bad(`${label} must be text.`);
  const result = String(value || "").trim();
  if (required && !result) throw bad(`Enter ${label.toLowerCase()}.`);
  if (result.length > max) throw bad(`${label} is too long.`);
  return result || null;
}

async function authority(tx, access, facilityId, { review = false } = {}) {
  const member = await tx.organisationMember.findUnique({ where: { id: access.context.membership.id }, select: { id: true, userId: true, organisationId: true, role: true } });
  if (!member || member.userId !== access.context.user.id || member.organisationId !== access.organisationId) throw bad("Your organisation access changed.", 403);
  if (member.role !== "OWNER") {
    if (!facilityId) throw bad("Only the organisation owner can manage network content.", 403);
    const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId } } });
    if (!grant || grant.organisationId !== access.organisationId || (review ? member.role !== "MANAGER" || grant.permission !== "MANAGER" : grant.permission === "VIEWER")) throw bad("You do not have this facility permission.", 403);
  }
  const subscription = await tx.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
  const features = correctionsC5Features(resolveEntitlements(subscription));
  if (!features.rehabilitationManagement) throw bad("Managing rehabilitation content requires Ruvanas Inside Tier 2 or above.", 403);
  if (!facilityId && !features.network) throw bad("Network-wide content requires Ruvanas Inside Tier 4 or above.", 403);
  if (facilityId) {
    const facility = await tx.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId: access.organisationId, status: { not: "CLOSED" } } }, select: { locationId: true } });
    if (!facility) throw bad("Facility not available.", 404);
  }
  return features;
}

function categoryCode(name) { return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""); }

export async function listCorrectionsRehabilitation(access, facilityId = null) {
  const features = correctionsC5Features(access.entitlements);
  if (!features.rehabilitation) throw bad("Rehabilitation is not available in this plan.", 403);
  const grants = access.context.membership.role === "OWNER" ? null : await prisma.correctionsFacilityGrant.findMany({ where: { organisationId: access.organisationId, organisationMemberId: access.context.membership.id }, select: { facilityId: true, permission: true } });
  const allowed = grants?.map((item) => item.facilityId);
  if (facilityId && allowed && !allowed.includes(facilityId)) throw bad("Facility not available.", 404);
  const scope = facilityId ? { facilityId } : allowed ? { facilityId: { in: allowed } } : {};
  const [categories, content, pending, expiring, media] = await Promise.all([
    prisma.correctionsRehabCategory.findMany({ where: { organisationId: access.organisationId, active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.correctionsRehabContent.findMany({ where: { organisationId: access.organisationId, ...scope, ...(!features.rehabilitationManagement ? { status: "APPROVED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } : {}) }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, facilityId: true, title: true, providerName: true, languageCode: true, status: true, expiresAt: true, reviewAt: true, mediaAssetId: true, createdByUserId: true, category: { select: { code: true, name: true } } } }),
    features.rehabilitationManagement ? prisma.correctionsRehabContent.count({ where: { organisationId: access.organisationId, ...scope, status: "IN_REVIEW" } }) : 0,
    prisma.correctionsRehabContent.count({ where: { organisationId: access.organisationId, ...scope, status: "APPROVED", expiresAt: { lte: new Date(Date.now() + 30 * 86_400_000) } } }),
    features.rehabilitationManagement ? prisma.mediaAsset.findMany({ where: { organisationId: access.organisationId, libraryType: "ORGANISATION_PROMO", status: "READY", mediaType: { in: ["ANNOUNCEMENT", "VOICEOVER", "JINGLE"] }, promoVersions: { some: { status: "APPROVED", qcStatus: "PASSED" } }, ...(allowed ? { correctionsRehabContent: { none: { facilityId: { notIn: allowed } } } } : {}) }, take: 100, orderBy: { createdAt: "desc" }, select: { id: true, name: true, durationSeconds: true } }) : []
  ]);
  const canReview = (facility) => features.rehabilitationManagement && (access.context.membership.role === "OWNER" || (access.context.membership.role === "MANAGER" && grants?.some((grant) => grant.facilityId === facility && grant.permission === "MANAGER")));
  return { categories: [...CORRECTIONS_REHAB_CATEGORIES.map((name) => ({ code: categoryCode(name), name })), ...categories.filter((item) => !CORRECTIONS_REHAB_CATEGORIES.some((name) => categoryCode(name) === item.code))],
    content: content.map(({ createdByUserId, ...item }) => ({ ...item, canReview: canReview(item.facilityId), canApprove: canReview(item.facilityId) && createdByUserId !== access.context.user.id })),
    media, canManage: features.rehabilitationManagement, metrics: { awaitingReview: pending, expiringSoon: expiring, approved: content.filter((item) => item.status === "APPROVED").length } };
}

export async function createCorrectionsRehabContent(access, input) {
  const facilityId = input.facilityId ? String(input.facilityId) : null;
  const title = text(input.title, 160, "Title", true);
  const providerName = text(input.providerName, 160, "Provider", true);
  const categoryCodeValue = text(input.categoryCode, 80, "Category", true)?.toUpperCase();
  if (!/^[A-Z0-9_]{2,80}$/.test(categoryCodeValue || "")) throw bad("Choose a valid category.");
  const mediaAssetId = String(input.mediaAssetId || "");
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  const reviewAt = input.reviewAt ? new Date(input.reviewAt) : null;
  if ((expiresAt && Number.isNaN(expiresAt.getTime())) || (reviewAt && Number.isNaN(reviewAt.getTime()))) throw bad("Choose valid review and expiry dates.");
  return runSerializableTransaction(prisma, async (tx) => {
    const features = await authority(tx, access, facilityId);
    const media = await tx.mediaAsset.findFirst({ where: { id: mediaAssetId, organisationId: access.organisationId, libraryType: "ORGANISATION_PROMO", status: "READY", mediaType: { in: ["ANNOUNCEMENT", "VOICEOVER", "JINGLE"] }, promoVersions: { some: { status: "APPROVED", qcStatus: "PASSED" } }, ...(access.context.membership.role !== "OWNER" ? { correctionsRehabContent: { none: { facilityId: { not: facilityId } } } } : {}) }, select: { id: true } });
    if (!media) throw bad("Choose ready audio owned by this organisation. Licensed catalogue masters cannot be attached.", 409);
    const defaultName = CORRECTIONS_REHAB_CATEGORIES.find((name) => categoryCode(name) === categoryCodeValue);
    if (!defaultName && !features.customTaxonomy) throw bad("Choose an approved rehabilitation category.", 403);
    const category = await tx.correctionsRehabCategory.upsert({ where: { organisationId_code: { organisationId: access.organisationId, code: categoryCodeValue } }, create: { organisationId: access.organisationId, code: categoryCodeValue, name: defaultName || text(input.categoryName, 80, "Category name", true) }, update: {}, select: { id: true, active: true } });
    if (!category.active) throw bad("This category is inactive.", 409);
    const item = await tx.correctionsRehabContent.create({ data: { organisationId: access.organisationId, facilityId, categoryId: category.id, mediaAssetId,
      title, providerName, description: text(input.description, 1500, "Description"), languageCode: text(input.languageCode, 12, "Language") || "und",
      sourceNotes: text(input.sourceNotes, 1000, "Rights and source notes"), accessibilityNotes: text(input.accessibilityNotes, 500, "Accessibility notes"),
      expiresAt, reviewAt, createdByUserId: access.context.user.id } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_REHAB_CONTENT_CREATED", entityType: "CorrectionsRehabContent", entityId: item.id, details: { facilityId, categoryCode: categoryCodeValue, mediaAssetId } } });
    return { id: item.id, status: item.status };
  });
}

export async function reviewCorrectionsRehabContent(access, id, input) {
  const action = String(input.action || "").toUpperCase();
  return runSerializableTransaction(prisma, async (tx) => {
    const item = await tx.correctionsRehabContent.findFirst({ where: { id, organisationId: access.organisationId } });
    if (!item) throw bad("Content not found.", 404);
    await authority(tx, access, item.facilityId, { review: true });
    const next = action === "SUBMIT" && ["DRAFT", "REJECTED"].includes(item.status) ? "IN_REVIEW" :
      action === "APPROVE" && item.status === "IN_REVIEW" ? "APPROVED" :
      action === "REJECT" && item.status === "IN_REVIEW" ? "REJECTED" :
      action === "ARCHIVE" && ["APPROVED", "REJECTED"].includes(item.status) ? "ARCHIVED" : null;
    if (!next) throw bad("This content cannot make that transition.", 409);
    if (action === "APPROVE") {
      const media = await tx.mediaAsset.findFirst({ where: { id: item.mediaAssetId, organisationId: access.organisationId, status: "READY", libraryType: "ORGANISATION_PROMO", promoVersions: { some: { status: "APPROVED", qcStatus: "PASSED" } } } });
      if (!media || (item.expiresAt && item.expiresAt <= new Date())) throw bad("Audio is unavailable or the approval period has expired.", 409);
      if (item.createdByUserId === access.context.user.id) throw bad("A different staff member must approve this content.", 403);
    }
    const changed = await tx.correctionsRehabContent.update({ where: { id }, data: { status: next, ...(action === "APPROVE" || action === "REJECT" ? { reviewedByUserId: access.context.user.id, reviewedAt: new Date() } : {}) } });
    if (action === "SUBMIT") await enqueueNotificationEvent(tx, { organisationId: access.organisationId, type: "CORRECTIONS_REVIEW_REQUEST", severity: "INFO", title: "Inside rehabilitation content awaiting review", message: "An audio item is waiting for authorised facility review.", entityType: "CorrectionsRehabContent", entityId: id, dedupeKey: `corrections-rehab-review:${id}`, correlationId: id });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: `CORRECTIONS_REHAB_${action}`, entityType: "CorrectionsRehabContent", entityId: id, details: { facilityId: item.facilityId, fromStatus: item.status, toStatus: next } } });
    return { id: changed.id, status: changed.status };
  });
}

export async function addCorrectionsRehabToProgramme(access, programmeId, contentId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const programme = await tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId } });
    if (!programme) throw bad("Programme not found.", 404);
    await authority(tx, access, programme.facilityId);
    if (programme.status !== "DRAFT") throw bad("Only a draft programme can be changed. A reviewed version must be resubmitted.", 409);
    const content = await tx.correctionsRehabContent.findFirst({ where: { id: contentId, organisationId: access.organisationId, status: "APPROVED", ...(access.context.membership.role === "OWNER" ? { OR: [{ facilityId: null }, { facilityId: programme.facilityId }] } : { facilityId: programme.facilityId }) } });
    if (!content || (content.expiresAt && content.expiresAt <= new Date())) throw bad("Choose approved, current content eligible for this facility.", 409);
    const media = await tx.mediaAsset.findFirst({ where: { id: content.mediaAssetId, organisationId: access.organisationId, status: "READY", libraryType: "ORGANISATION_PROMO", promoVersions: { some: { status: "APPROVED", qcStatus: "PASSED" } } }, select: { id: true } });
    if (!media) throw bad("This audio is no longer approved or available.", 409);
    const position = await tx.correctionsRehabProgrammeItem.count({ where: { programmeId } });
    const item = await tx.correctionsRehabProgrammeItem.create({ data: { programmeId, contentId, position: position + 1, addedByUserId: access.context.user.id } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_REHAB_PROGRAMME_ITEM_ADDED", entityType: "CorrectionsRehabProgrammeItem", entityId: item.id, details: { programmeId, contentId, facilityId: programme.facilityId } } });
    return { id: item.id, programmeId, contentId };
  });
}
