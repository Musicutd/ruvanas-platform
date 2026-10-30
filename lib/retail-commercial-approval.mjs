import { createHash } from "node:crypto";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION, resolveRetailSubscriberWorkspace } from "./retail-subscriber-access.mjs";
import { assertPreviewTesterState, PREVIEW_TESTER_ACCESS_MODES } from "./private-preview-account-policy.mjs";
import { readRetailApprovedCommercialSpots, readRetailCommercialDraftHistory } from "./retail-commercial-service.mjs";
import { RETAIL_COMMERCIAL_LIMITS as LIMITS, normaliseRetailCommercialDraft, retailCommercialLocalDate } from "./retail-commercial-policy.mjs";
import { retailCommercialMediaIdentity } from "./retail-commercial-media.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export { retailCommercialMediaIdentity, downloadRetailCommercialMedia } from "./retail-commercial-media.mjs";
const ACTION = "TEST_RETAIL_COMMERCIAL_APPROVED", ENTITY = "RetailCommercialApproval";
const MAX_APPROVALS = 200, SCHEMA = 1;
// Preserve legacy owner approvals and their content fingerprints. Version 2
// additionally records the subscriber's distinct approval responsibility.
const SUBSCRIBER_SCHEMA = 2;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const draftIdValid = value => typeof value === "string" && /^retail-commercial-[a-f0-9]{40}$/.test(value);
const approvalIdValid = value => typeof value === "string" && /^retail-commercial-approval-[a-f0-9]{40}$/.test(value);
const stamp = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
const fail = code => { throw Object.assign(new Error(`RETAIL_COMMERCIAL_${code}`), { code: `RETAIL_COMMERCIAL_${code}` }); };
const disabled = reasonCode => ({ enabled: false, reasonCode, rules: [], spots: [] });
const commandId = (actor, requestId) => `retail-commercial-approval-${hash([ORG, STATION, actor, requestId.toLowerCase()]).slice(0, 40)}`;
const cleanDraft = draft => draft ? { id: draft.id, version: draft.version, name: draft.name, timezone: draft.timezone, rules: draft.rules, savedAt: draft.savedAt } : null;
const summary = approval => approval ? { id: approval.id, sequence: approval.sequence, draftId: approval.draftId, draftVersion: approval.draftVersion, approvedAt: approval.approvedAt } : null;

async function owner(db, { actorUserId, organisationId, stationId = STATION, now }) {
  if (!stamp(now) || !validId(actorUserId) || organisationId !== ORG || stationId !== STATION) fail("ACCESS_DENIED");
  const user = await db.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true } });
  if (user?.id !== actorUserId || user.role !== "SUPER_ADMIN") fail("ACCESS_DENIED");
  const station = await db.station.findFirst({ where: { id: STATION, organisationId: ORG }, select: { id: true, organisationId: true, productFamily: true } });
  if (station?.id !== STATION || station.organisationId !== ORG || station.productFamily !== "RETAIL") fail("ACCESS_DENIED");
}

// Persistent approval authority is re-read from the database. It does not
// manufacture a browser session and remains valid after a normal sign-out.
async function subscriberPrincipal(db, actorUserId, now) {
  if (!stamp(now) || !validId(actorUserId)) return null;
  const user = await db.user.findUnique({ where: { id: actorUserId }, include: {
    privatePreviewAccess: true, memberships: { include: { organisation: { include: {
      subscription: { include: { plan: true, billingContract: true } }, enterpriseSecurityPolicy: true
    } } } }
  } });
  if (user?.id !== actorUserId || user.role !== "OWNER" ||
      String(user.email || "").trim().toLowerCase() !== "retail@manuelchircop.com" ||
      user.privatePreviewAccess?.organisationId !== ORG) return null;
  try {
    const state = assertPreviewTesterState(user, { now, requirePassword: false });
    if (state.accessMode !== PREVIEW_TESTER_ACCESS_MODES.READ_ONLY || state.pillars.length !== 1 ||
        state.pillars[0] !== "RETAIL" || state.membership.organisationId !== ORG) return null;
    return user;
  } catch { return null; }
}

async function subscriber(db, { context, now }) {
  if (!await resolveRetailSubscriberWorkspace(db, context, { now }) ||
      !await subscriberPrincipal(db, context.session.userId, now)) fail("ACCESS_DENIED");
}

export async function assertRetailSubscriberCommercialApprovalAccess(db, { context, now = new Date() } = {}) {
  await subscriber(db, { context, now });
}

function approvalRecord(row, now) {
  const d = row?.details;
  if (!approvalIdValid(row?.id) || row.organisationId !== ORG || row.entityId !== STATION || row.entityType !== ENTITY || row.action !== ACTION ||
      !validId(row.actorUserId) || !stamp(row.createdAt) || row.createdAt > now || ![SCHEMA, SUBSCRIBER_SCHEMA].includes(d?.schemaVersion) || d.stationId !== STATION ||
      (d.schemaVersion === SUBSCRIBER_SCHEMA ? d.approvalAuthority !== "SUBSCRIBER" || d.responsibilityConfirmed !== true :
        d.approvalAuthority !== undefined || d.responsibilityConfirmed !== undefined) ||
      !Number.isInteger(d.sequence) || d.sequence < 1 || d.sequence > MAX_APPROVALS || !draftIdValid(d.draftId) ||
      !Number.isInteger(d.draftVersion) || d.draftVersion < 1 || d.draftVersion > LIMITS.maximumVersions || !digest(d.reviewHash) || !digest(d.requestHash) ||
      !(d.baseApprovalId === null || approvalIdValid(d.baseApprovalId)) || d.approvedAt !== stamp(row.createdAt) ||
      !Array.isArray(d.spots) || d.spots.length > LIMITS.maximumSpots || new Set(d.spots.map(s => s.id)).size !== d.spots.length ||
      d.spots.some(s => !validId(s.id) || !digest(s.fingerprint) || !digest(s.draftFingerprint))) fail("APPROVAL_INVALID");
  return { ...d, id: row.id, actorUserId: row.actorUserId };
}

async function approvals(db, now) {
  const rows = await db.auditLog.findMany({ where: { organisationId: ORG, entityId: STATION, entityType: ENTITY, action: ACTION },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_APPROVALS + 1 });
  if (rows.length > MAX_APPROVALS) fail("APPROVAL_HISTORY_FULL");
  const records = rows.map(row => approvalRecord(row, now)).sort((a, b) => b.sequence - a.sequence);
  if (records.some((r, index) => r.sequence !== records.length - index || r.baseApprovalId !== (records[index + 1]?.id || null) ||
      index + 1 < records.length && r.approvedAt < records[index + 1].approvedAt)) fail("APPROVAL_INVALID");
  return records;
}

function selectedIds(draft) {
  const ids = [...new Set(draft.rules.flatMap(rule => rule.spotIds))].sort();
  if (draft.spotSnapshots.length !== ids.length || new Set(draft.spotSnapshots.map(s => s.id)).size !== ids.length ||
      draft.spotSnapshots.some(s => !ids.includes(s.id))) fail("HISTORY_INVALID");
  return ids;
}

// Only this private approval/runtime path reads storage identities. Subscriber
// catalogue and draft responses never select or expose them.
async function approvedMedia(db, draft, now) {
  const ids = selectedIds(draft); if (!ids.length) return [];
  const metadata = await readRetailApprovedCommercialSpots(db, now);
  const selected = ids.map(id => {
    const current = metadata.find(spot => spot.id === id), saved = draft.spotSnapshots.find(spot => spot.id === id);
    if (!current || !saved || current.fingerprint !== saved.fingerprint) fail("SPOT_UNAVAILABLE");
    return current;
  });
  const rows = await db.promoVersion.findMany({ where: { id: { in: ids }, status: "APPROVED", qcStatus: "PASSED",
    promoAsset: { organisationId: ORG, status: "ACTIVE" }, mediaAsset: { organisationId: ORG, libraryType: "ORGANISATION_PROMO", status: "READY" } },
    select: { id: true, version: true, status: true, qcStatus: true, reviewedAt: true, updatedAt: true, durationSeconds: true,
      checksumSha256: true, promoAssetId: true, mediaAssetId: true,
      promoAsset: { select: { id: true, name: true, organisationId: true, status: true, currentApprovedVersionId: true } },
      mediaAsset: { select: { id: true, organisationId: true, libraryType: true, status: true, mimeType: true, mediaType: true,
        storageKey: true, sizeBytes: true, durationSeconds: true, updatedAt: true } } }, take: LIMITS.maximumSpots + 1 });
  if (rows.length !== ids.length || new Set(rows.map(r => r.id)).size !== ids.length) fail("SPOT_UNAVAILABLE");
  const result = selected.map(meta => {
    const row = rows.find(r => r.id === meta.id), a = row?.mediaAsset, p = row?.promoAsset;
    if (!row || row.status !== "APPROVED" || row.qcStatus !== "PASSED" || p?.organisationId !== ORG || p.status !== "ACTIVE" ||
        p.currentApprovedVersionId !== row.id || !validId(p.id) || !validId(a?.id) || row.promoAssetId !== p.id || row.mediaAssetId !== a?.id ||
        a.organisationId !== ORG || a.libraryType !== "ORGANISATION_PROMO" || a.status !== "READY" ||
        row.durationSeconds !== meta.durationSeconds || a.durationSeconds !== meta.durationSeconds ||
        !stamp(row.reviewedAt) || !stamp(row.updatedAt) || !stamp(a.updatedAt) || [row.reviewedAt, row.updatedAt, a.updatedAt].some(t => t > now) ||
        hash([row.id, row.version, row.promoAssetId, row.mediaAssetId, stamp(row.reviewedAt), stamp(row.updatedAt), stamp(a.updatedAt), a.durationSeconds]) !== meta.fingerprint) fail("SPOT_UNAVAILABLE");
    const asset = { ...a, checksumSha256: row.checksumSha256 };
    let identity; try { identity = retailCommercialMediaIdentity(asset); } catch { fail("MEDIA_UNVERIFIED"); }
    const fingerprint = hash([meta.fingerprint, asset.storageKey, identity.checksum, identity.sizeBytes, asset.mimeType, asset.mediaType]);
    return { ...meta, fingerprint, draftFingerprint: meta.fingerprint, contentKind: "COMMERCIAL",
      track: { id: row.id, title: meta.name, artist: "", mediaAssetId: asset.id, mediaAsset: asset } };
  });
  for (const rule of draft.rules) if (rule.spotIds.reduce((seconds, id) => seconds + result.find(s => s.id === id).durationSeconds, 0) > LIMITS.maximumBreakSeconds) fail("BREAK_TOO_LONG");
  return result;
}

const spotEvidence = spots => spots.map(({ id, fingerprint, draftFingerprint }) => ({ id, fingerprint, draftFingerprint }));
const reviewFingerprint = (draft, spots, baseApprovalId) => hash([SCHEMA, ORG, STATION, cleanDraft(draft), draft.spotSnapshots, spotEvidence(spots), baseApprovalId]);
async function inputs(db, now) {
  const [drafts, published] = await Promise.all([readRetailCommercialDraftHistory(db), approvals(db, now)]);
  if (drafts.some(draft => draft.savedAt > now.toISOString())) fail("HISTORY_INVALID");
  return { drafts, published, draft: drafts[0] || null, active: published[0] || null };
}

export async function reviewRetailCommercialApproval(db, { actorUserId, organisationId, stationId = STATION, now = new Date() } = {}) {
  await owner(db, { actorUserId, organisationId, stationId, now });
  return reviewDetails(db, now);
}

export async function reviewRetailSubscriberCommercialApproval(db, { context, now = new Date() } = {}) {
  await subscriber(db, { context, now });
  return reviewDetails(db, now, true);
}

async function reviewDetails(db, now, subscriberApproval = false) {
  const state = await inputs(db, now), warnings = []; let spots = [], reviewHash = null;
  if (!state.draft) warnings.push("Save a commercial draft in the Retail workspace before reviewing it.");
  else {
    try {
      spots = await approvedMedia(db, state.draft, now);
      if (state.draft.rules.some(rule => rule.endsOn && rule.endsOn < retailCommercialLocalDate(now))) fail("RULE_EXPIRED");
      reviewHash = reviewFingerprint(state.draft, spots, state.active?.id || null);
    } catch (error) { warnings.push(retailCommercialApprovalError(error).error); }
  }
  const canApprove = Boolean(reviewHash && state.active?.draftId !== state.draft?.id && state.published.length < MAX_APPROVALS);
  return { stationId: STATION, organisationId: ORG, timezone: "Europe/Malta", reviewOnly: true,
    adminApprovalRequired: !subscriberApproval, subscriberApprovalRequired: subscriberApproval,
    scheduleApprovalRequired: subscriberApproval ? "SUBSCRIBER" : "ADMIN",
    draft: cleanDraft(state.draft), approval: summary(state.active), baseApprovalId: state.active?.id || null, reviewHash,
    canApprove, spots: spots.map(({ id, name, version, durationSeconds }) => ({ id, name, version, durationSeconds })), warnings,
    notice: subscriberApproval ? "Review and approve this exact saved commercial schedule for your own Retail stream. Saving a draft alone does not change the approved audio rules." :
      "Only an administrator can approve this exact commercial revision through the owner controls. Saving a subscriber draft does not change the approved audio rules." };
}

export async function approveRetailCommercialDraft(db, options = {}) {
  const { actorUserId, organisationId, stationId = STATION, draftId, reviewHash, baseApprovalId, requestId, now = new Date() } = options;
  if (Object.keys(options).some(key => !["actorUserId", "organisationId", "stationId", "draftId", "reviewHash", "baseApprovalId", "requestId", "now"].includes(key)) ||
      !draftIdValid(draftId) || !digest(reviewHash) || !(baseApprovalId === null || approvalIdValid(baseApprovalId)) ||
      typeof requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) fail("REQUEST_INVALID");
  return approveDetails(db, { actorUserId, organisationId, stationId, draftId, reviewHash, baseApprovalId, requestId, now },
    tx => owner(tx, { actorUserId, organisationId, stationId, now }));
}

export async function approveRetailSubscriberCommercialDraft(db, { context, input, now = new Date() } = {}) {
  if (!input || Object.keys(input).some(key => !["draftId", "reviewHash", "baseApprovalId", "requestId", "responsibilityConfirmed"].includes(key)) ||
      !draftIdValid(input.draftId) || !digest(input.reviewHash) || !(input.baseApprovalId === null || approvalIdValid(input.baseApprovalId)) ||
      typeof input.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId) ||
      input.responsibilityConfirmed !== true) fail("REQUEST_INVALID");
  await subscriber(db, { context, now });
  return approveDetails(db, { actorUserId: context.session.userId, organisationId: ORG, stationId: STATION, ...input, now },
    tx => subscriber(tx, { context, now }), true);
}

async function approveDetails(db, options, authorize, subscriberApproval = false) {
  const { actorUserId, organisationId, stationId, draftId, reviewHash, baseApprovalId, requestId, now } = options;
  const result = await runSerializableTransaction(db, async tx => {
    await authorize(tx);
    // Serialize against subscriber saves as well as concurrent approvals.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-commercial-drafts:${STATION}`}))`;
    const id = commandId(actorUserId, requestId), requestHash = hash([ORG, STATION, draftId, reviewHash, baseApprovalId,
      ...(subscriberApproval ? ["SUBSCRIBER", true] : [])]);
    const prior = await tx.auditLog.findUnique({ where: { id } });
    if (prior) {
      const record = approvalRecord(prior, now);
      if (record.actorUserId !== actorUserId || record.requestHash !== requestHash ||
          record.schemaVersion !== (subscriberApproval ? SUBSCRIBER_SCHEMA : SCHEMA)) fail("RETRY_CHANGED");
      const current = (await approvals(tx, now))[0];
      return { accepted: true, replayed: true, approvedDraftId: draftId, approvedRevision: summary(record), activeApprovalId: current?.id || null };
    }
    const state = await inputs(tx, now);
    if (!state.draft || state.draft.id !== draftId || (state.active?.id || null) !== baseApprovalId || state.active?.draftId === draftId) fail("REVIEW_CHANGED");
    if (state.published.length >= MAX_APPROVALS) fail("APPROVAL_HISTORY_FULL");
    if (state.draft.rules.some(rule => rule.endsOn && rule.endsOn < retailCommercialLocalDate(now))) fail("RULE_EXPIRED");
    const spots = await approvedMedia(tx, state.draft, now);
    if (reviewFingerprint(state.draft, spots, baseApprovalId) !== reviewHash) fail("REVIEW_CHANGED");
    const details = { schemaVersion: subscriberApproval ? SUBSCRIBER_SCHEMA : SCHEMA,
      ...(subscriberApproval ? { approvalAuthority: "SUBSCRIBER", responsibilityConfirmed: true } : {}),
      stationId: STATION, sequence: state.published.length + 1, draftId,
      draftVersion: state.draft.version, reviewHash, requestHash, baseApprovalId, approvedAt: now.toISOString(), spots: spotEvidence(spots) };
    await tx.auditLog.create({ data: { id, organisationId: ORG, actorUserId, action: ACTION, entityType: ENTITY,
      entityId: STATION, createdAt: now, details } });
    return { accepted: true, replayed: false, approvedDraftId: draftId, approvedRevision: summary({ ...details, id }), activeApprovalId: id };
  });
  return { ...await reviewDetails(db, now, subscriberApproval), ...result };
}

export async function loadRetailCommercialSchedule(db, { authorized, now = new Date() } = {}) {
  try {
    const { station, grant, tracks } = authorized || {};
    if (!stamp(now) || station?.id !== STATION || station.organisationId !== ORG || station.productFamily !== "RETAIL" ||
        grant?.stationId !== STATION || grant.organisationId !== ORG || grant.action !== "START" || !validId(grant.id) ||
        !Number.isFinite(Date.parse(grant.issuedAt)) || Date.parse(grant.issuedAt) > now.getTime() || !Array.isArray(tracks)) return disabled("RETAIL_COMMERCIAL_SCOPE_INVALID");
    const state = await inputs(db, now), active = state.active;
    if (!active) return disabled("RETAIL_COMMERCIAL_NOT_APPROVED");
    const author = active.schemaVersion === SUBSCRIBER_SCHEMA ? await subscriberPrincipal(db, active.actorUserId, now) :
      await db.user.findUnique({ where: { id: active.actorUserId }, select: { id: true, role: true } });
    if (author?.id !== active.actorUserId || (active.schemaVersion === SCHEMA && author.role !== "SUPER_ADMIN")) return disabled("RETAIL_COMMERCIAL_APPROVAL_INVALID");
    const draft = state.drafts.find(row => row.id === active.draftId);
    if (!draft || draft.version !== active.draftVersion || draft.savedAt > active.approvedAt) return disabled("RETAIL_COMMERCIAL_APPROVAL_INVALID");
    const spots = await approvedMedia(db, draft, now);
    if (reviewFingerprint(draft, spots, active.baseApprovalId) !== active.reviewHash || hash(spotEvidence(spots)) !== hash(active.spots)) return disabled("RETAIL_COMMERCIAL_REAPPROVAL_REQUIRED");
    if (!draft.rules.length) return disabled("RETAIL_COMMERCIAL_APPROVED_OFF");
    return { enabled: true, organisationId: ORG, stationId: STATION, approvalId: active.id, draftId: draft.id,
      revisionFingerprint: hash([active.id, active.sequence, active.reviewHash]),
      effectiveAt: new Date(Math.max(Date.parse(grant.issuedAt), Date.parse(active.approvedAt))).toISOString(),
      validUntil: new Date(Math.min(now.getTime() + 15000, active.schemaVersion === SUBSCRIBER_SCHEMA ?
        author.privatePreviewAccess.expiresAt.getTime() : Infinity)).toISOString(), timezone: "Europe/Malta",
      rules: normaliseRetailCommercialDraft({ name: draft.name, timezone: draft.timezone, rules: draft.rules }).rules, spots };
  } catch (error) {
    return disabled(typeof error?.code === "string" && error.code.startsWith("RETAIL_COMMERCIAL_") ? error.code : "RETAIL_COMMERCIAL_UNAVAILABLE");
  }
}

const MESSAGES = {
  ACCESS_DENIED: [403, "Your account is not authorised to review or approve this Retail commercial schedule."],
  REQUEST_INVALID: [400, "Reload the current commercial review before approving."],
  REVIEW_CHANGED: [409, "The commercial draft, audio or previous approval changed. Review it again before approving."],
  RETRY_CHANGED: [409, "This approval request changed. Reload the current commercial review."],
  SPOT_UNAVAILABLE: [409, "A selected spot changed or is no longer approved. Save a new draft with current approved spots."],
  MEDIA_UNVERIFIED: [409, "A selected spot needs a verified audio file before it can be approved for playback."],
  RULE_EXPIRED: [409, "A commercial date range has ended. Save a revised draft before approving."],
  BREAK_TOO_LONG: [400, "Keep each commercial break to ten minutes or less."],
  HISTORY_INVALID: [409, "The saved commercial draft history needs review."],
  APPROVAL_INVALID: [409, "The commercial approval history needs review."],
  APPROVAL_HISTORY_FULL: [409, "The commercial approval history is full and needs administrator review."]
};
export function retailCommercialApprovalError(error) {
  const key = typeof error?.code === "string" && error.code.startsWith("RETAIL_COMMERCIAL_") ? error.code.slice(18) : "";
  const known = MESSAGES[key];
  return { status: known?.[0] || 500, code: known ? error.code : "RETAIL_COMMERCIAL_FAILED",
    error: known?.[1] || "Unable to review commercial playback. Music settings have not been changed." };
}
