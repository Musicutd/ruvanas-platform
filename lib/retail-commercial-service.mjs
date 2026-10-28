import { createHash } from "node:crypto";
import { resolveRetailSubscriberWorkspace, RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "./retail-subscriber-access.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { RETAIL_COMMERCIAL_LIMITS as LIMITS, normaliseRetailCommercialDraft, retailCommercialLocalDate } from "./retail-commercial-policy.mjs";

const ACTION = "TEST_RETAIL_COMMERCIAL_DRAFT_SAVED", ENTITY = "RetailCommercialDraft";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code: `RETAIL_COMMERCIAL_${code}` }); };
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const stamp = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
const clean = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160) : "";
const requestKey = (actor, requestId) => `retail-commercial-${hash([ORG, STATION, actor, requestId.toLowerCase()]).slice(0, 40)}`;
async function scoped(db, { context, now = new Date() }) {
  if (!await resolveRetailSubscriberWorkspace(db, context, { now })) fail("ACCESS_DENIED");
  return { actorId: context.session.userId, now };
}
async function approvedSpots(db, now) {
  const rows = await db.promoVersion.findMany({ where: { status: "APPROVED", qcStatus: "PASSED",
    promoAsset: { organisationId: ORG, status: "ACTIVE" }, mediaAsset: { organisationId: ORG, libraryType: "ORGANISATION_PROMO", status: "READY" } },
    select: { id: true, version: true, status: true, qcStatus: true, reviewedAt: true, updatedAt: true, durationSeconds: true,
      promoAssetId: true, mediaAssetId: true, promoAsset: { select: { id: true, name: true, organisationId: true, status: true, currentApprovedVersionId: true } },
      mediaAsset: { select: { id: true, organisationId: true, libraryType: true, status: true, mimeType: true, durationSeconds: true, updatedAt: true } } },
    orderBy: [{ promoAsset: { name: "asc" } }, { version: "desc" }], take: LIMITS.maximumSpots + 1 });
  if (rows.length > LIMITS.maximumSpots) fail("SPOT_LIMIT");
  const accepted = [];
  for (const row of rows) {
    const asset = row.mediaAsset, promo = row.promoAsset, seconds = asset?.durationSeconds;
    if (!validId(row.id) || row.status !== "APPROVED" || row.qcStatus !== "PASSED" || !stamp(row.reviewedAt) || row.reviewedAt > now || !stamp(row.updatedAt) ||
        !Number.isInteger(row.version) || row.version < 1 || row.promoAssetId !== promo?.id || row.mediaAssetId !== asset?.id ||
        promo.organisationId !== ORG || promo.status !== "ACTIVE" || promo.currentApprovedVersionId !== row.id ||
        asset.organisationId !== ORG || asset.libraryType !== "ORGANISATION_PROMO" || asset.status !== "READY" ||
        typeof asset.mimeType !== "string" || !asset.mimeType.startsWith("audio/") || !stamp(asset.updatedAt) ||
        !Number.isInteger(seconds) || seconds < 1 || seconds > LIMITS.maximumSpotSeconds || row.durationSeconds !== seconds) continue;
    accepted.push({ id: row.id, name: clean(promo.name), version: row.version, durationSeconds: seconds,
      fingerprint: hash([row.id, row.version, row.promoAssetId, row.mediaAssetId, stamp(row.reviewedAt), stamp(row.updatedAt), stamp(asset.updatedAt), seconds]) });
  }
  if (new Set(accepted.map(row => row.id)).size !== accepted.length) fail("SPOT_LIMIT");
  return accepted;
}
function validateRecord(record) {
  const value = record?.details;
  if (!/^retail-commercial-[a-f0-9]{40}$/.test(record?.id || "") || record?.organisationId !== ORG || record.entityId !== STATION || record.entityType !== ENTITY || record.action !== ACTION ||
      !validId(record.actorUserId) || value?.stationId !== STATION || !Number.isInteger(value.version) || value.version < 1 || value.version > LIMITS.maximumVersions ||
      typeof value.requestHash !== "string" || !/^[a-f0-9]{64}$/.test(value.requestHash) || !stamp(record.createdAt) ||
      !Array.isArray(value.spots) || value.spots.length > LIMITS.maximumSpots ||
      value.spots.some(spot => !validId(spot.id) || typeof spot.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(spot.fingerprint))) fail("HISTORY_INVALID");
  let draft; try { draft = normaliseRetailCommercialDraft(value.draft); } catch { fail("HISTORY_INVALID"); }
  return { id: record.id, version: value.version, ...draft, savedAt: stamp(record.createdAt), spotSnapshots: value.spots };
}
async function history(db) {
  const records = await db.auditLog.findMany({ where: { organisationId: ORG, entityId: STATION, entityType: ENTITY, action: ACTION },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITS.maximumVersions + 1 });
  if (records.length > LIMITS.maximumVersions) fail("VERSION_LIMIT");
  const drafts = records.map(validateRecord).sort((a, b) => b.version - a.version);
  if (new Set(drafts.map(d => d.version)).size !== drafts.length || drafts.some((d, index) => d.version !== drafts.length - index)) fail("HISTORY_INVALID");
  return drafts;
}
function dto(spots, drafts, now) {
  const latest = drafts[0], today = retailCommercialLocalDate(now), warnings = [];
  let draft = null;
  if (latest) {
    const { spotSnapshots, ...publicDraft } = latest;
    const unavailableSpotIds = [...new Set(latest.rules.flatMap(rule => rule.spotIds))].filter(id => {
      const saved = spotSnapshots.find(spot => spot.id === id), current = spots.find(spot => spot.id === id);
      return !saved || !current || saved.fingerprint !== current.fingerprint;
    });
    const expiredRuleNames = latest.rules.filter(rule => rule.endsOn && rule.endsOn < today).map(rule => rule.name);
    draft = { ...publicDraft, unavailableSpotIds, expiredRuleNames, needsReview: Boolean(unavailableSpotIds.length || expiredRuleNames.length) };
    if (unavailableSpotIds.length) warnings.push("Some saved spots have changed or are no longer approved. Choose current approved audio and save a new draft.");
    if (expiredRuleNames.length) warnings.push("Some saved commercial date ranges have ended. Update those dates before review.");
  }
  if (!spots.length) warnings.push("No approved commercial audio is available yet. Ask your administrator to approve spots for this Retail account.");
  return { stationId: STATION, draftOnly: true, playbackConnected: false, adminApprovalRequired: true, timezone: "Europe/Malta",
    spots: spots.map(({ fingerprint: _fingerprint, ...spot }) => spot), draft, limits: LIMITS, warnings,
    notice: "Commercial rules are private drafts. Administrator approval and a commercial playback connection are required before spots can air. Both streams keep playing unchanged." };
}
export async function retailCommercialDraft(db, options = {}) {
  const scope = await scoped(db, options), [spots, drafts] = await Promise.all([approvedSpots(db, scope.now), history(db)]);
  return dto(spots, drafts, scope.now);
}
// Read-only owner review for the exact Retail pilot. Deliberately no approval,
// publication or runtime command is exposed until insertion is implemented.
export async function retailCommercialOwnerReview(db, { actorUserId, organisationId, stationId = STATION, now = new Date() } = {}) {
  if (!validId(actorUserId) || organisationId !== ORG || stationId !== STATION ||
      (await db.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true } }))?.role !== "SUPER_ADMIN") fail("ACCESS_DENIED");
  const station = await db.station.findFirst({ where: { id: STATION, organisationId: ORG }, select: { id: true, organisationId: true, productFamily: true } });
  if (station?.id !== STATION || station.organisationId !== ORG || station.productFamily !== "RETAIL") fail("ACCESS_DENIED");
  const [spots, drafts] = await Promise.all([approvedSpots(db, now), history(db)]);
  return { ...dto(spots, drafts, now), canApprove: false, reviewOnly: true };
}
export async function saveRetailCommercialDraft(db, { input, ...options }) {
  if (!input || Object.keys(input).some(key => !["action", "requestId", "baseVersionId", "name", "timezone", "rules"].includes(key)) || input.action !== "save" || typeof input.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId) ||
      !(input.baseVersionId === null || typeof input.baseVersionId === "string" && /^retail-commercial-[a-f0-9]{40}$/.test(input.baseVersionId))) fail("REQUEST_INVALID");
  const draft = normaliseRetailCommercialDraft({ name: input.name, timezone: input.timezone, rules: input.rules });
  const savedDraftId = await runSerializableTransaction(db, async tx => {
    const scope = await scoped(tx, options), auditId = requestKey(scope.actorId, input.requestId);
    const requestHash = hash([ORG, STATION, input.baseVersionId, draft]);
    // A draft-only lock cannot claim or interfere with the running audio lease.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-commercial-drafts:${STATION}`}))`;
    const prior = await tx.auditLog.findUnique({ where: { id: auditId } });
    if (prior) {
      validateRecord(prior);
      if (prior.actorUserId !== scope.actorId || prior.details.requestHash !== requestHash) fail("RETRY_CHANGED");
      return prior.id;
    }
    const [spots, drafts] = await Promise.all([approvedSpots(tx, scope.now), history(tx)]);
    if ((drafts[0]?.id || null) !== input.baseVersionId) fail("DRAFT_CHANGED");
    if (drafts.length >= LIMITS.maximumVersions) fail("VERSION_LIMIT");
    const today = retailCommercialLocalDate(scope.now), selected = new Set();
    for (const rule of draft.rules) {
      if (rule.endsOn && rule.endsOn < today) fail("RULE_EXPIRED");
      let durationSeconds = 0;
      for (const id of rule.spotIds) { const spot = spots.find(row => row.id === id); if (!spot) fail("SPOT_UNAVAILABLE"); selected.add(id); durationSeconds += spot.durationSeconds; }
      if (durationSeconds > LIMITS.maximumBreakSeconds) fail("BREAK_TOO_LONG");
    }
    await tx.auditLog.create({ data: { id: auditId, organisationId: ORG, actorUserId: scope.actorId, action: ACTION, entityType: ENTITY, entityId: STATION,
      createdAt: scope.now, details: { stationId: STATION, version: drafts.length + 1, requestHash, draft,
        spots: spots.filter(spot => selected.has(spot.id)).map(({ id, fingerprint }) => ({ id, fingerprint })), draftOnly: true, playbackConnected: false } } });
    return auditId;
  });
  return { ...await retailCommercialDraft(db, options), savedDraftId };
}
const MESSAGES = {
  ACCESS_DENIED: "This commercial planner is available only to the Test Retail subscriber.",
  DRAFT_CHANGED: "Another draft was saved. Reload the saved draft before saving your changes.",
  RETRY_CHANGED: "This save request changed. Review the current draft and try again.",
  SPOT_UNAVAILABLE: "A selected spot is no longer approved for this Retail account. Reload the available audio.",
  SPOT_LIMIT: "The approved audio inventory needs administrator review before planning.",
  VERSION_LIMIT: "The saved draft history is full. Ask your administrator to review it.",
  RULE_EXPIRED: "A commercial's end date has passed. Update its date range before saving.",
  BREAK_TOO_LONG: "Keep each commercial break to ten minutes or less.",
  HISTORY_INVALID: "The saved commercial draft needs administrator review.",
  ORIGIN_INVALID: "Reload this Retail page before saving.",
  REQUEST_INVALID: "Check the commercial draft and try again.",
  BODY_INVALID: "The commercial draft request is invalid or too large.",
  QUERY_INVALID: "The commercial planner request is invalid.",
  DRAFT_INVALID: "Enter a draft name and up to 20 commercial rules using Malta time.",
  RULE_INVALID: "Each rule needs a name, approved spots and selected days.",
  FREQUENCY_INVALID: "Choose 1–50 songs or 1–180 minutes between commercial breaks.",
  TIME_INVALID: "Choose valid half-hour times or hours for the commercial schedule.",
  DATE_INVALID: "Check the commercial start and end dates.",
  DUPLICATE_NAME: "Give each commercial rule a different name."
};
export function retailCommercialPublicError(error) {
  const key = typeof error?.code === "string" && error.code.startsWith("RETAIL_COMMERCIAL_") ? error.code.slice(18) : "";
  const known = Object.hasOwn(MESSAGES, key);
  return { error: known ? MESSAGES[key] : "Unable to load or save this commercial draft. Please try again.", code: known ? error.code : "RETAIL_COMMERCIAL_FAILED" };
}
