import { prisma } from "./prisma.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { activateExternalLiveSource, changeExternalLiveSourceStatus } from "./external-live-service.js";
import { validatePublicStreamEndpoint } from "./stream-source-health.mjs";
import {
  assertBrowserStudioGrant,
  browserLiveProviderConfigured,
  browserStudioIsStale,
  browserStudioTransition,
  normalizeBrowserMixerState,
  safeBrowserStudioSession,
  validateProviderAllocation
} from "./browser-live-studio.mjs";

export const browserStudioInclude = {
  channel: { select: { id: true, name: true, status: true, station: { select: { id: true, name: true } } } },
  djAccessGrant: { include: { granteeMembership: { select: { user: { select: { id: true, name: true, email: true } } } } } },
  externalLiveSource: { select: { id: true, name: true, status: true, healthStatus: true, lastHealthCheckedAt: true } }
};

const openStatuses = ["CREATED", "SOUNDCHECK", "READY", "ON_AIR"];

function providerApiUrl(path = "") {
  const base = String(process.env.BROWSER_LIVE_PROVIDER_API_URL || "").trim();
  if (!browserLiveProviderConfigured()) throw new Error("Browser Live Studio needs a configured real-time media provider before it can broadcast.");
  return new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
}

async function providerRequest(path, { method = "POST", body } = {}) {
  const response = await fetch(providerApiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${process.env.BROWSER_LIVE_PROVIDER_API_TOKEN}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`The real-time media provider could not prepare the studio (${response.status}).`);
  if (response.status === 204) return {};
  return response.json();
}

export async function allocateBrowserStudioProvider(session) {
  const payload = await providerRequest("v1/browser-live/sessions", {
    body: {
      idempotencyKey: session.id,
      organisationId: session.organisationId,
      channelId: session.channelId,
      sessionId: session.id,
      title: session.title,
      scheduledStart: session.scheduledStart.toISOString(),
      scheduledEnd: session.scheduledEnd.toISOString(),
      recordEnabled: session.recordEnabled,
      protocol: "WHIP"
    }
  });
  const allocation = validateProviderAllocation(payload);
  await validatePublicStreamEndpoint(allocation.playbackUrl);
  return allocation;
}

async function releaseBrowserStudioProvider(session) {
  if (!session?.providerSessionRef || !browserLiveProviderConfigured()) return;
  try {
    await providerRequest(`v1/browser-live/sessions/${encodeURIComponent(session.providerSessionRef)}`, { method: "DELETE" });
  } catch (error) {
    console.error("Browser Live Studio provider release failed:", error);
  }
}

export async function listBrowserStudioSessions(organisationId) {
  const sessions = await prisma.liveStudioSession.findMany({
    where: { organisationId, product: "ONLINE_RADIO" },
    include: browserStudioInclude,
    orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
    take: 100
  });
  return sessions.map(safeBrowserStudioSession);
}

export async function listPresenterBrowserStudioSessions({ organisationId, grantId }) {
  const sessions = await prisma.liveStudioSession.findMany({
    where: { organisationId, product: "ONLINE_RADIO", djAccessGrantId: grantId },
    include: browserStudioInclude,
    orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
    take: 20
  });
  return sessions.map(safeBrowserStudioSession);
}

export async function createBrowserStudioSession({ organisationId, actorUserId, input, now = new Date() }) {
  if (input.recordEnabled && !input.retentionApproved) throw new Error("Live recording requires explicit retention approval.");
  return prisma.$transaction(async (tx) => {
    const [channel, grant, conflict] = await Promise.all([
      tx.channel.findFirst({ where: { id: input.channelId, organisationId, status: "ACTIVE" }, select: { id: true } }),
      tx.djAccessGrant.findFirst({ where: { id: input.djAccessGrantId, organisationId, channelId: input.channelId }, include: { granteeMembership: { select: { user: { select: { id: true, name: true, email: true } } } } } }),
      tx.liveStudioSession.findFirst({ where: { organisationId, channelId: input.channelId, product: "ONLINE_RADIO", status: { in: openStatuses } }, select: { id: true } })
    ]);
    if (!channel) throw new Error("Choose an active channel owned by this organisation.");
    if (conflict) throw new Error("This channel already has an open Browser Live Studio session.");
    if (!grant || new Date(grant.startsAt) > input.scheduledStart || new Date(grant.endsAt) < input.scheduledEnd) throw new Error("The presenter grant must cover the entire studio window.");
    assertBrowserStudioGrant(grant, { channelId: channel.id, recordEnabled: input.recordEnabled, now: input.scheduledStart });
    const session = await tx.liveStudioSession.create({
      data: {
        organisationId,
        product: "ONLINE_RADIO",
        channelId: channel.id,
        djAccessGrantId: grant.id,
        supervisorUserId: actorUserId,
        title: input.title,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        recordEnabled: input.recordEnabled,
        retentionApproved: input.retentionApproved,
        mixerStateJson: normalizeBrowserMixerState(),
        providerKey: "GENERIC_WHIP"
      },
      include: browserStudioInclude
    });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "BROWSER_LIVE_STUDIO_CREATED", entityType: "LiveStudioSession", entityId: session.id, details: { channelId: channel.id, djAccessGrantId: grant.id, scheduledStart: input.scheduledStart.toISOString(), scheduledEnd: input.scheduledEnd.toISOString(), recordEnabled: input.recordEnabled } } });
    return safeBrowserStudioSession(session);
  });
}

export async function prepareBrowserStudioSession({ organisationId, sessionId, actorUserId, grantId, expectedVersion = null, now = new Date() }) {
  const session = await prisma.liveStudioSession.findFirst({ where: { id: sessionId, organisationId, product: "ONLINE_RADIO", djAccessGrantId: grantId }, include: browserStudioInclude });
  if (!session) return null;
  assertBrowserStudioGrant(session.djAccessGrant, { channelId: session.channelId, recordEnabled: session.recordEnabled, now });
  const transition = browserStudioTransition(session, "PREPARE", { providerConfigured: browserLiveProviderConfigured(), now });
  if (session.providerSessionRef && session.providerPublishEncrypted && session.providerExpiresAt > now) {
    return { session: safeBrowserStudioSession(session), publish: JSON.parse(decryptSecret(session.providerPublishEncrypted)) };
  }
  const allocation = await allocateBrowserStudioProvider(session);
  return prisma.$transaction(async (tx) => {
    const current = await tx.liveStudioSession.findFirst({ where: { id: session.id, organisationId, product: "ONLINE_RADIO" } });
    if (!current || (expectedVersion !== null && current.sessionVersion !== expectedVersion)) throw new Error("The studio changed in another browser. Refresh before continuing.");
    if (current.providerSessionRef) throw new Error("The studio provider was already prepared. Refresh to reconnect.");
    const source = await tx.externalLiveSource.create({ data: {
      organisationId,
      channelId: session.channelId,
      name: `Browser Studio · ${session.title}`.slice(0, 120),
      providerKey: `BROWSER_${allocation.providerKey}`.slice(0, 80),
      streamUrl: allocation.playbackUrl,
      credentialType: allocation.playbackToken ? "BEARER" : "NONE",
      credentialEncrypted: allocation.playbackToken ? encryptSecret(allocation.playbackToken) : null,
      status: "READY",
      startsAt: session.scheduledStart,
      endsAt: session.scheduledEnd,
      createdByUserId: actorUserId
    } });
    const publish = { whipEndpoint: allocation.whipEndpoint, publishToken: allocation.publishToken, expiresAt: allocation.expiresAt.toISOString() };
    const updated = await tx.liveStudioSession.update({ where: { id: session.id }, data: {
      ...transition,
      externalLiveSourceId: source.id,
      providerKey: allocation.providerKey,
      providerSessionRef: allocation.providerSessionRef,
      providerPublishEncrypted: encryptSecret(JSON.stringify(publish)),
      providerPlaybackUrl: allocation.playbackUrl,
      providerExpiresAt: allocation.expiresAt,
      sessionVersion: { increment: 1 }
    }, include: browserStudioInclude });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "BROWSER_LIVE_STUDIO_PREPARED", entityType: "LiveStudioSession", entityId: session.id, details: { channelId: session.channelId, providerKey: allocation.providerKey, providerExpiresAt: allocation.expiresAt.toISOString(), externalLiveSourceId: source.id } } });
    return { session: safeBrowserStudioSession(updated), publish };
  });
}

export async function reconnectBrowserStudioPublisher({ organisationId, sessionId, grantId, now = new Date() }) {
  const session = await prisma.liveStudioSession.findFirst({ where: { id: sessionId, organisationId, product: "ONLINE_RADIO", djAccessGrantId: grantId }, include: browserStudioInclude });
  if (!session) return null;
  assertBrowserStudioGrant(session.djAccessGrant, { channelId: session.channelId, recordEnabled: session.recordEnabled, now });
  if (!new Set(["READY", "ON_AIR"]).has(session.status) || !session.providerPublishEncrypted || !session.providerExpiresAt || session.providerExpiresAt <= now) return { session: safeBrowserStudioSession(session), publish: null };
  return { session: safeBrowserStudioSession(session), publish: JSON.parse(decryptSecret(session.providerPublishEncrypted)) };
}

export async function changeBrowserStudioSession({ organisationId, sessionId, actorUserId, action, grantId = null, soundcheck = null, mixer = null, reason = null, expectedVersion = null, now = new Date() }) {
  const session = await prisma.liveStudioSession.findFirst({ where: { id: sessionId, organisationId, product: "ONLINE_RADIO", ...(grantId ? { djAccessGrantId: grantId } : {}) }, include: browserStudioInclude });
  if (!session) return null;
  if (grantId) assertBrowserStudioGrant(session.djAccessGrant, { channelId: session.channelId, recordEnabled: session.recordEnabled, now });
  if (expectedVersion !== null && session.sessionVersion !== expectedVersion) throw new Error("The studio changed in another browser. Refresh before continuing.");
  const transition = browserStudioTransition(session, action, { soundcheck, providerConfigured: browserLiveProviderConfigured(), now, reason });
  const { assessment: _assessment, ...transitionData } = transition;

  if (action === "HEARTBEAT") {
    await prisma.liveStudioSession.updateMany({ where: { id: session.id, organisationId, product: "ONLINE_RADIO", status: session.status }, data: { ...transitionData, ...(mixer ? { mixerStateJson: normalizeBrowserMixerState(mixer) } : {}) } });
    const refreshed = await prisma.liveStudioSession.findUnique({ where: { id: session.id }, include: browserStudioInclude });
    return safeBrowserStudioSession(refreshed);
  }

  if (action === "GO_LIVE") {
    const source = await activateExternalLiveSource({ organisationId, sourceId: session.externalLiveSourceId, actorUserId, now });
    if (!source) throw new Error("The protected Browser Live Studio source is unavailable.");
  }

  const mustSuspendSource = ["FORCE_FALLBACK", "END"].includes(action) && session.externalLiveSourceId;
  if (mustSuspendSource) {
    const source = await changeExternalLiveSourceStatus({ organisationId, sourceId: session.externalLiveSourceId, actorUserId, action: "SUSPEND", now });
    if (!source) throw new Error("The protected Browser Live Studio source is unavailable.");
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const current = await tx.liveStudioSession.findFirst({ where: { id: session.id, organisationId, product: "ONLINE_RADIO" } });
      if (!current || (expectedVersion !== null && current.sessionVersion !== expectedVersion)) throw new Error("The studio changed in another browser. Refresh before continuing.");
      const changed = await tx.liveStudioSession.update({ where: { id: session.id }, data: {
        ...transitionData,
        ...(mixer ? { mixerStateJson: normalizeBrowserMixerState(mixer) } : {}),
        sessionVersion: { increment: 1 }
      }, include: browserStudioInclude });
      await tx.auditLog.create({ data: { organisationId, actorUserId, action: `BROWSER_LIVE_STUDIO_${action}`, entityType: "LiveStudioSession", entityId: session.id, details: { channelId: session.channelId, status: changed.status, connectionQuality: changed.connectionQuality, reason, sessionVersion: changed.sessionVersion } } });
      return changed;
    });
  } catch (error) {
    if (action === "GO_LIVE" && session.externalLiveSourceId) {
      await changeExternalLiveSourceStatus({ organisationId, sourceId: session.externalLiveSourceId, actorUserId, action: "SUSPEND", now }).catch(() => {});
    }
    throw error;
  }

  if (mustSuspendSource) {
    await releaseBrowserStudioProvider(session);
  }
  return safeBrowserStudioSession(updated);
}

export async function scanStaleBrowserStudioSessions(database, { now = new Date() } = {}) {
  const dueBefore = new Date(now.getTime() - 45_000);
  const sessions = await database.liveStudioSession.findMany({
    where: { product: "ONLINE_RADIO", status: { in: ["READY", "ON_AIR"] }, OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lte: dueBefore } }] },
    orderBy: { lastHeartbeatAt: "asc" },
    take: 50
  });
  let fallback = 0;
  for (const session of sessions) {
    if (!browserStudioIsStale(session, now)) continue;
    await database.$transaction(async (tx) => {
      const changed = await tx.liveStudioSession.updateMany({ where: { id: session.id, status: session.status, sessionVersion: session.sessionVersion }, data: { status: "FALLBACK", fallbackActivatedAt: now, endedAt: now, endReason: "Automatic fallback: Browser Live Studio heartbeat expired.", lastHeartbeatAt: now, sessionVersion: { increment: 1 } } });
      if (!changed.count) return;
      if (session.externalLiveSourceId) await tx.externalLiveSource.updateMany({ where: { id: session.externalLiveSourceId, organisationId: session.organisationId, channelId: session.channelId, status: { not: "ARCHIVED" } }, data: { status: "SUSPENDED", suspendedAt: now } });
      await tx.auditLog.create({ data: { organisationId: session.organisationId, action: "BROWSER_LIVE_STUDIO_AUTOMATIC_FALLBACK", entityType: "LiveStudioSession", entityId: session.id, details: { channelId: session.channelId, lastHeartbeatAt: session.lastHeartbeatAt?.toISOString?.() || null, thresholdSeconds: 45 } } });
      fallback += 1;
    });
  }
  return { scanned: sessions.length, fallback };
}
