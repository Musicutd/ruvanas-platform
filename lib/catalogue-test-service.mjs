import { createHash, randomBytes } from "node:crypto";
import { resolveEntitlements } from "./entitlements.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { buildOnlineRadioCatalogueTestPlan, safeCatalogueTestPlan, catalogueTestTrackFingerprint,
  catalogueTestTrackDecision, validateCatalogueTestAuthorization, TEST_RADIO_CATALOGUE_TEST as LIMITS } from "./online-radio-catalogue-test.mjs";
import { validateCatalogueTestTarget } from "./catalogue-test-transport.mjs";
import { readPrivatePreviewPolicy, isPrivatePreviewAdminSession } from "./private-preview-policy.mjs";
import { getCatalogueTestProfile, catalogueTestProfileForAuthorization, catalogueTestPreparationDeadline } from "./catalogue-test-profiles.mjs";

const codeError = code => Object.assign(new Error(code), { code });
// JSONB does not preserve object insertion order. Canonicalize every object,
// retaining every value and array position, before creating or checking hashes.
// Old order-dependent plans deliberately fail closed and must be prepared anew.
const canonicalJson = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => createHash("sha256").update(canonicalJson(value)).digest("hex");
const LIVE = new Set(["ARMED", "RUNNING"]);
const STOP_UNCONFIRMED = "CATALOGUE_TEST_STOP_UNCONFIRMED";
const SESSION_FRESHNESS = [{ createdAt: "desc" }, { id: "desc" }];
const DASHBOARD_EVENTS = { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 100 } };
export const CATALOGUE_TEST_LEASE_PREFIX = "catalogue-test:";
const trackInclude = { mediaAsset: { include: { genres: { include: { mediaGenre: true } } } }, distributorItems: { select: { id: true } } };

async function unconfirmedCatalogueTest(db, includeEvents = false) {
  // Neither a terminal label, a newer test nor a time/lease expiry proves an
  // unresponsive encoder stopped. Only separately verified remediation may
  // clear this quarantine evidence; the dashboard never silently discards it.
  return db.onlineRadioCatalogueTest.findFirst({ where: { stationId: LIMITS.stationId, OR: [
    { endedReason: STOP_UNCONFIRMED },
    { events: { some: { kind: "TEST_ENDED", details: { path: ["stopConfirmed"], equals: false } } } },
  ] }, orderBy: SESSION_FRESHNESS,
  ...(includeEvents ? { include: DASHBOARD_EVENTS } : { select: { id: true } }) });
}

async function visibleCatalogueTest(db) {
  const quarantine = await unconfirmedCatalogueTest(db, true);
  if (quarantine) return { latest: quarantine, attentionRequired: true };
  // Keep the actually running source visible even if a malformed/concurrent
  // second row is armed. A harmless newer draft must never hide Stop controls.
  for (const status of ["RUNNING", "ARMED"]) {
    const active = await db.onlineRadioCatalogueTest.findFirst({ where: { stationId: LIMITS.stationId, status },
      orderBy: SESSION_FRESHNESS, include: DASHBOARD_EVENTS });
    if (active) return { latest: active, attentionRequired: false };
  }
  const latest = await db.onlineRadioCatalogueTest.findFirst({ where: { stationId: LIMITS.stationId },
    orderBy: SESSION_FRESHNESS, include: DASHBOARD_EVENTS });
  return { latest, attentionRequired: false };
}

export function catalogueTestSourceFingerprint(config) {
  return digest([config?.providerKey, config?.streamUrl, config?.serverHost, config?.sourcePort, config?.sourceUsername,
    config?.centovaUsername, config?.bitrateKbps, config?.sourcePasswordEncrypted, config?.outboundAutoDjEnabled]);
}
export function catalogueTestWorkerReady(config, now = new Date()) {
  return config?.outboundAutoDjEnabled === false && typeof config.encoderLeaseOwner === "string" &&
    config.encoderLeaseOwner.startsWith(CATALOGUE_TEST_LEASE_PREFIX) && config.encoderLeaseUntil instanceof Date && config.encoderLeaseUntil > now;
}
export function catalogueTestOwnerSessionValid(session, userId, now, env = process.env) {
  const basic = Boolean(session?.id && session.userId === userId && session.user?.id === userId && session.user.role === "SUPER_ADMIN" &&
    !session.revokedAt && session.expiresAt instanceof Date && session.expiresAt > now &&
    ["PASSWORD", "PREVIEW_PASSWORD", "SSO"].includes(session.authMethod));
  if (!basic) return false;
  const access = session.user.privatePreviewAccess;
  if (session.authMethod === "PREVIEW_PASSWORD") {
    if (!access || access.userId !== userId || access.enabled !== true || access.passwordEnabled !== true ||
        access.organisationId !== null || access.expiresAt !== null || !Array.isArray(access.pillars) || access.pillars.length !== 0) return false;
  } else if (access) return false;
  const preview = readPrivatePreviewPolicy(env);
  if (preview.enabled && (!preview.valid || !isPrivatePreviewAdminSession(session, preview))) return false;
  if (session.activeOrganisationId && (session.activeOrganisation?.id !== session.activeOrganisationId ||
      !Object.hasOwn(session.activeOrganisation, "enterpriseSecurityPolicy"))) return false;
  const policy = session.activeOrganisation?.enterpriseSecurityPolicy;
  if (policy) {
    if (!(session.createdAt instanceof Date) || !(session.lastSeenAt instanceof Date) ||
        !Number.isFinite(session.createdAt.getTime()) || !Number.isFinite(session.lastSeenAt.getTime()) ||
        !Number.isInteger(policy.sessionMaxAgeMinutes) || policy.sessionMaxAgeMinutes < 1 ||
        !Number.isInteger(policy.idleTimeoutMinutes) || policy.idleTimeoutMinutes < 1 ||
        session.createdAt.getTime() + policy.sessionMaxAgeMinutes * 60000 <= now.getTime() ||
        session.lastSeenAt.getTime() + policy.idleTimeoutMinutes * 60000 <= now.getTime()) return false;
    // A diagnostic does not circumvent an organisation's SSO-only policy.
    if (policy.ssoRequired && !policy.passwordFallback && session.authMethod !== "SSO") return false;
  }
  return true;
}
function requireOwner(actorSession, now) {
  if (!catalogueTestOwnerSessionValid(actorSession, actorSession?.userId, now)) throw codeError("TEST_OWNER_SESSION_REQUIRED");
}
export async function loadCatalogueTestContext(db, now = new Date()) {
  const station = await db.station.findUnique({ where: { id: LIMITS.stationId }, include: {
    streamConfig: true, organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } }
  } });
  if (!station) throw codeError("TEST_STATION_REQUIRED");
  const subscription = station.organisation?.subscription;
  const entitlements = resolveEntitlements(subscription, now);
  const serviceExpiresAt = subscription?.currentPeriodEnd || null;
  const configuredGenres = await db.mediaGenre.findMany({ where: { active: true }, take: 250 });
  return { station, entitlements, configuredGenres, serviceExpiresAt };
}
function grant(context, actorSession, now, profile) {
  const expiresAt = new Date(Math.min(now.getTime() + profile.maximumAuthorizationSeconds * 1000, actorSession.expiresAt.getTime(),
    context.serviceExpiresAt?.getTime() ?? Infinity));
  return { kind: LIMITS.kind, actorRole: "SUPER_ADMIN", actorUserId: actorSession.userId, actorSessionId: actorSession.id,
    stationId: context.station.id, organisationId: context.station.organisationId, origin: LIMITS.origin,
    territory: LIMITS.territory, catalogueLevel: LIMITS.catalogueLevel, profileId: profile.id, maximumSeconds: profile.maximumSeconds,
    issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
}
function sourceReady(config) { try { return validateCatalogueTestTarget(config); } catch { return false; } }
export async function inspectCatalogueTest(db, { actorSession, now = new Date(), seed = "owner-readiness-preview", profileId }) {
  requireOwner(actorSession, now);
  const profile = getCatalogueTestProfile(profileId);
  if (!profile) throw codeError("TEST_PROFILE_INVALID");
  const context = await loadCatalogueTestContext(db, now);
  const authorization = grant(context, actorSession, now, profile);
  const tracks = await db.track.findMany({ where: { status: "READY", mediaAsset: { libraryType: "RUVANAS_CATALOGUE", organisationId: null } },
    include: trackInclude, orderBy: { id: "asc" }, take: LIMITS.maximumCandidates + 1 });
  const plan = buildOnlineRadioCatalogueTestPlan({ ...context, tracks, authorization, origin: LIMITS.origin, seed, instant: now });
  return { context, authorization, plan, sourceReady: sourceReady(context.station.streamConfig),
    workerReady: catalogueTestWorkerReady(context.station.streamConfig, now) };
}
function storedPlan(result) {
  return { profileId: result.plan.profileId, seed: result.plan.seed, targetSeconds: result.plan.targetSeconds,
    sourceFingerprint: catalogueTestSourceFingerprint(result.context.station.streamConfig),
    items: result.plan.items.map(item => ({ trackId: item.trackId, fingerprint: item.fingerprint, playDurationSeconds: item.playDurationSeconds,
      title: item.title, artist: item.artist })), validation: result.plan.validation };
}
export function safeCatalogueTestSession(session) {
  if (!session) return null;
  const profile = catalogueTestProfileForAuthorization(session.authorization);
  return { id: session.id, status: session.status, territory: session.territory, profileId: profile?.id || null, durationSeconds: session.durationSeconds,
    preparationDeadlineAt: catalogueTestPreparationDeadline(session.authorization, session.durationSeconds),
    expiresAt: session.expiresAt, startedAt: session.startedAt, endedAt: session.endedAt,
    deadlineAt: session.deadlineAt, endedReason: session.endedReason, stopRequestedAt: session.stopRequestedAt,
    items: (session.plan?.items || []).map(({ title, artist, playDurationSeconds }) => ({ title, artist, playDurationSeconds })),
    events: (session.events || []).map(({ kind, trackId, details, occurredAt }) => ({ kind, trackId, details, occurredAt })) };
}
export async function catalogueTestDashboard(db, { actorSession, now = new Date(), startEnabled = false, profileId }) {
  const result = await inspectCatalogueTest(db, { actorSession, now, profileId });
  // Resolve the priority classes from one read snapshot, not four unrelated
  // observations while the worker may be updating its status.
  const { latest, attentionRequired } = await runSerializableTransaction(db, visibleCatalogueTest);
  return { preview: safeCatalogueTestPlan(result.plan), sourceReady: result.sourceReady, workerReady: result.workerReady,
    startEnabled: startEnabled === true && result.workerReady && !attentionRequired, attentionRequired,
    latest: safeCatalogueTestSession(latest),
    note: "Source-send diagnostics are not listener proof of play. Preparing never starts audio or changes your tester plan." };
}
export async function prepareCatalogueTest(db, { actorSession, now = new Date(), profileId }) {
  const result = await inspectCatalogueTest(db, { actorSession, now, seed: randomBytes(24).toString("hex"), profileId });
  if (!result.plan.ready) throw codeError(result.plan.reason);
  if (!result.sourceReady) throw codeError("TEST_SOURCE_NOT_READY");
  const plan = storedPlan(result);
  return runSerializableTransaction(db, async tx => {
    if (await unconfirmedCatalogueTest(tx)) throw codeError("TEST_STOP_UNCONFIRMED");
    if (await tx.onlineRadioCatalogueTest.findFirst({ where: { stationId: LIMITS.stationId, status: { in: [...LIVE] } } })) throw codeError("TEST_ALREADY_ACTIVE");
    const session = await tx.onlineRadioCatalogueTest.create({ data: { stationId: LIMITS.stationId,
      organisationId: result.context.station.organisationId, createdByUserId: actorSession.userId,
      origin: LIMITS.origin, territory: LIMITS.territory, catalogueLevel: LIMITS.catalogueLevel,
      durationSeconds: result.plan.targetSeconds, authorization: result.authorization, plan, fingerprint: digest(plan),
      expiresAt: new Date(result.authorization.expiresAt) } });
    await tx.auditLog.create({ data: { organisationId: session.organisationId, actorUserId: actorSession.userId,
      action: "ONLINE_RADIO_CATALOGUE_TEST_PREPARED", entityType: "OnlineRadioCatalogueTest", entityId: session.id,
      details: { stationId: session.stationId, territory: "MT", profileId: result.plan.profileId, durationSeconds: session.durationSeconds, audioStarted: false } } });
    return safeCatalogueTestSession(session);
  });
}
export async function loadAuthorizedCatalogueTest(db, { sessionId, now = new Date(), allowPrepared = false }) {
  const session = await db.onlineRadioCatalogueTest.findUnique({ where: { id: sessionId } });
  if (!session || session.stationId !== LIMITS.stationId || ![...LIVE, ...(allowPrepared ? ["PREPARED"] : [])].includes(session.status) ||
      session.stopRequestedAt || session.expiresAt <= now) throw codeError("TEST_AUTHORIZATION_INACTIVE");
  const profile = catalogueTestProfileForAuthorization(session.authorization);
  if (!profile || !Number.isInteger(session.durationSeconds) || session.durationSeconds < 1 || session.durationSeconds > profile.maximumSeconds ||
      profile.id === "ONE_HOUR" && session.durationSeconds !== profile.maximumSeconds) throw codeError("TEST_PROFILE_INVALID");
  const preparationDeadlineAt = catalogueTestPreparationDeadline(session.authorization, session.durationSeconds);
  if (session.status === "PREPARED" && (!preparationDeadlineAt || preparationDeadlineAt <= now)) throw codeError("TEST_PREPARATION_EXPIRED");
  if (session.status !== "PREPARED" && (!session.publicExposureAcceptedAt || !session.requestedAt || !session.deadlineAt || session.deadlineAt <= now ||
      session.deadlineAt > session.expiresAt || session.deadlineAt.getTime() - session.requestedAt.getTime() > session.durationSeconds * 1000 ||
      !preparationDeadlineAt || session.requestedAt > preparationDeadlineAt)) throw codeError("TEST_DEADLINE_INVALID");
  const owner = await db.session.findUnique({ where: { id: session.authorization?.actorSessionId || "" }, include: {
    user: { include: { privatePreviewAccess: true } }, activeOrganisation: { include: { enterpriseSecurityPolicy: true } }
  } });
  requireOwner(owner, now);
  if (owner.userId !== session.createdByUserId || session.authorization.actorUserId !== owner.userId) throw codeError("TEST_OWNER_SESSION_REQUIRED");
  const context = await loadCatalogueTestContext(db, now);
  if (context.station.organisationId !== session.organisationId) throw codeError("TEST_SCOPE_CHANGED");
  const decision = validateCatalogueTestAuthorization({ ...context, authorization: session.authorization, instant: now, origin: LIMITS.origin });
  if (!decision.ready) throw codeError(decision.reason);
  if (!sourceReady(context.station.streamConfig) || catalogueTestSourceFingerprint(context.station.streamConfig) !== session.plan.sourceFingerprint) throw codeError("TEST_SOURCE_CHANGED");
  if (digest(session.plan) !== session.fingerprint || !Array.isArray(session.plan.items) || !session.plan.items.length || session.plan.items.length > profile.maximumItems ||
      session.plan.targetSeconds !== session.durationSeconds ||
      (session.plan.profileId !== profile.id && !(session.authorization.profileId === undefined && session.plan.profileId === undefined))) throw codeError("TEST_PLAN_CHANGED");
  const trackIds = [...new Set(session.plan.items.map(item => item.trackId))];
  if (trackIds.length !== session.plan.items.length) throw codeError("TEST_PLAN_CHANGED");
  const loaded = await db.track.findMany({ where: { id: { in: trackIds } }, include: trackInclude, take: profile.maximumItems });
  const tracks = new Map(loaded.map(track => [track.id, track]));
  const deadlineAt = session.deadlineAt || new Date(Math.min(now.getTime() + session.durationSeconds * 1000, decision.validUntil));
  if (deadlineAt.getTime() > decision.validUntil) throw codeError("TEST_AUTHORIZATION_INACTIVE");
  let total = 0;
  const items = session.plan.items.map(item => {
    const track = tracks.get(item.trackId);
    if (!track || catalogueTestTrackFingerprint(track) !== item.fingerprint || catalogueTestTrackDecision(track, {
      organisationId: session.organisationId, instant: now, stopAt: deadlineAt, configuredGenres: context.configuredGenres, profileId: profile.id })) throw codeError("TEST_TRACK_APPROVAL_CHANGED");
    if (!Number.isInteger(item.playDurationSeconds) || item.playDurationSeconds < 1 || item.playDurationSeconds > track.mediaAsset.durationSeconds) throw codeError("TEST_PLAN_CHANGED");
    total += item.playDurationSeconds;
    return { id: track.id, mediaAssetId: track.mediaAssetId, durationSeconds: item.playDurationSeconds, track };
  });
  const uniqueBytes = [...new Map(items.map(item => [item.mediaAssetId, Number(item.track.mediaAsset.sizeBytes)])).values()].reduce((sum, size) => sum + size, 0);
  if (total !== session.durationSeconds || total > profile.maximumSeconds || uniqueBytes > profile.maximumUniqueFileBytes) throw codeError("TEST_PLAN_CHANGED");
  return { ...session, authorized: true, id: session.id, channelId: null, profileId: profile.id, preparationDeadlineAt,
    authorizationExpiresAt: new Date(Math.min(decision.validUntil, deadlineAt.getTime())), deadlineAt, tracks: items,
    source: context.station.streamConfig };
}
export async function armCatalogueTest(db, { actorSession, sessionId, publicExposureAccepted, startEnabled = false, now = new Date() }) {
  requireOwner(actorSession, now);
  if (startEnabled !== true) throw codeError("TEST_START_NOT_ENABLED");
  if (publicExposureAccepted !== true) throw codeError("TEST_PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED");
  return runSerializableTransaction(db, async tx => {
    const session = await loadAuthorizedCatalogueTest(tx, { sessionId, now, allowPrepared: true });
    if (session.status !== "PREPARED" || session.createdByUserId !== actorSession.userId || session.authorization.actorSessionId !== actorSession.id) throw codeError("TEST_AUTHORIZATION_INACTIVE");
    if (await unconfirmedCatalogueTest(tx)) throw codeError("TEST_STOP_UNCONFIRMED");
    if (!catalogueTestWorkerReady(session.source, now)) throw codeError("TEST_WORKER_NOT_READY");
    if (await tx.onlineRadioCatalogueTest.findFirst({ where: { stationId: LIMITS.stationId, id: { not: sessionId }, status: { in: [...LIVE] } } })) throw codeError("TEST_ALREADY_ACTIVE");
    const deadlineAt = new Date(Math.min(now.getTime() + session.durationSeconds * 1000, session.expiresAt.getTime()));
    if (deadlineAt.getTime() - now.getTime() < session.durationSeconds * 1000) throw codeError("TEST_PREPARATION_EXPIRED");
    const updated = await tx.onlineRadioCatalogueTest.updateMany({ where: { id: sessionId, status: "PREPARED", stopRequestedAt: null },
      data: { status: "ARMED", requestedAt: now, publicExposureAcceptedAt: now, deadlineAt } });
    if (updated.count !== 1) throw codeError("TEST_ALREADY_ACTIVE");
    await tx.auditLog.create({ data: { organisationId: session.organisationId, actorUserId: actorSession.userId,
      action: "ONLINE_RADIO_CATALOGUE_TEST_ARMED", entityType: "OnlineRadioCatalogueTest", entityId: session.id,
      details: { stationId: LIMITS.stationId, profileId: session.profileId, deadlineAt: deadlineAt.toISOString(), publicExposureAccepted: true } } });
    return { id: sessionId, status: "ARMED", deadlineAt };
  });
}
export async function stopCatalogueTest(db, { actorSession, sessionId, now = new Date() }) {
  requireOwner(actorSession, now);
  return runSerializableTransaction(db, async tx => {
    const result = await tx.onlineRadioCatalogueTest.updateMany({ where: { id: sessionId, stationId: LIMITS.stationId, status: { in: ["PREPARED", "ARMED", "RUNNING"] } },
      data: { stopRequestedAt: now } });
    if (result.count !== 1) throw codeError("TEST_NOT_ACTIVE");
    // Never claim that an unresponsive encoder has stopped merely because a
    // browser requested it. The worker records terminal state after closure.
    await tx.auditLog.create({ data: { actorUserId: actorSession.userId, action: "ONLINE_RADIO_CATALOGUE_TEST_STOP_REQUESTED",
      entityType: "OnlineRadioCatalogueTest", entityId: sessionId, details: { stationId: LIMITS.stationId } } });
    return { id: sessionId, status: "STOP_REQUESTED" };
  });
}
