import { assertPreviewTesterState, PREVIEW_TESTER_ACCESS_MODES } from "./private-preview-account-policy.mjs";

// Keep this module edge-safe: the request allowlist also uses its pure predicate.
export const TEST_RADIO_SUBSCRIBER_STATION_ID = "cmvcnbwi20008hr23sd76psi8";
const EMAIL = "radio@manuelchircop.com";
export const TEST_RADIO_SUBSCRIBER_ORGANISATION_INCLUDE = Object.freeze({
  subscription: { include: { plan: true, billingContract: true } }, enterpriseSecurityPolicy: true
});

export function isTestRadioSubscriberSession(session, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !session?.id ||
    !["PREVIEW_PASSWORD", "PREVIEW_CODE"].includes(session.authMethod) || session.revokedAt ||
    !(session.expiresAt instanceof Date) || session.expiresAt <= now || !Number.isFinite(session.expiresAt.getTime()) ||
    session.userId !== session.user?.id || String(session.user?.email || "").trim().toLowerCase() !== EMAIL ||
    session.activeOrganisationId !== session.user?.privatePreviewAccess?.organisationId) return false;
  try {
    const state = assertPreviewTesterState(session.user, { now, requirePassword: session.authMethod === "PREVIEW_PASSWORD" });
    return state.accessMode === PREVIEW_TESTER_ACCESS_MODES.ONLINE_DRAFT_CATALOGUE &&
      state.pillars.length === 1 && state.pillars[0] === "ONLINE";
  } catch { return false; }
}

export function isTestRadioSubscriberContext(context, now = new Date()) {
  if (!isTestRadioSubscriberSession(context?.session, now) || context.user?.id !== context.session.userId ||
    context.membership?.organisationId !== context.session.activeOrganisationId || context.membership.role !== "OWNER" ||
    !Array.isArray(context.memberships) || context.memberships.length !== 1 ||
    context.memberships[0].organisationId !== context.membership.organisationId) return false;
  // Recheck the freshly selected organisation, not only the session's earlier copy.
  return isTestRadioSubscriberSession({ ...context.session,
    user: { ...context.user, memberships: context.memberships } }, now);
}

export async function resolveTestRadioSubscriberWorkspace(db, context, { now = new Date() } = {}) {
  if (!isTestRadioSubscriberContext(context, now)) return null;
  const organisationId = context.membership.organisationId;
  const station = await db.station.findFirst({ where: { id: TEST_RADIO_SUBSCRIBER_STATION_ID, organisationId },
    select: { id: true, name: true, organisationId: true, productFamily: true, status: true,
      publicPlayerEnabled: true, stationWebsiteEnabled: true } });
  if (!station || station.id !== TEST_RADIO_SUBSCRIBER_STATION_ID || station.organisationId !== organisationId ||
    station.productFamily !== "ONLINE" || !["DRAFT", "PENDING_SETUP", "ACTIVE"].includes(station.status) ||
    station.publicPlayerEnabled !== false || station.stationWebsiteEnabled !== false) return null;
  const channels = await db.channel.findMany({ where: { stationId: station.id, organisationId,
    musicRightsUse: "ONLINE_RADIO", status: { in: ["DRAFT", "ACTIVE"] } },
    select: { id: true, name: true, status: true, stationId: true, organisationId: true, musicRightsUse: true }, orderBy: { id: "asc" }, take: 21 });
  if (channels.length > 20 || channels.some(channel => channel.stationId !== station.id || channel.organisationId !== organisationId ||
    channel.musicRightsUse !== "ONLINE_RADIO" || !["DRAFT", "ACTIVE"].includes(channel.status))) return null;
  return { stationId: station.id, stationName: station.name, channelId: channels.length === 1 ? channels[0].id : null,
    channels: channels.map(({ id, name, status }) => ({ id, name, status })) };
}
