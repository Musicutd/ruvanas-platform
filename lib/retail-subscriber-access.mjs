import { assertPreviewTesterState, PREVIEW_TESTER_ACCESS_MODES } from "./private-preview-account-policy.mjs";

// Edge-safe exact pilot boundary. This does not change the shared tester plan.
export const RETAIL_SUBSCRIBER_ORGANISATION_ID = "cmvmeq5880005lf2knwtw1b93";
export const RETAIL_SUBSCRIBER_STATION_ID = "cmvmg7rp1000flf2kelb1kzax";
export const RETAIL_SUBSCRIBER_ORGANISATION_INCLUDE = Object.freeze({
  subscription: { include: { plan: true, billingContract: true } }, enterpriseSecurityPolicy: true
});
const EMAIL = "retail@manuelchircop.com";
export function isRetailSubscriberSession(session, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !session?.id ||
    !["PREVIEW_PASSWORD", "PREVIEW_CODE"].includes(session.authMethod) || session.revokedAt ||
    !(session.expiresAt instanceof Date) || !Number.isFinite(session.expiresAt.getTime()) || session.expiresAt <= now ||
    session.userId !== session.user?.id || String(session.user?.email || "").trim().toLowerCase() !== EMAIL ||
    session.activeOrganisationId !== RETAIL_SUBSCRIBER_ORGANISATION_ID ||
    session.user?.privatePreviewAccess?.organisationId !== RETAIL_SUBSCRIBER_ORGANISATION_ID) return false;
  try {
    const state = assertPreviewTesterState(session.user, { now, requirePassword: session.authMethod === "PREVIEW_PASSWORD" });
    return state.accessMode === PREVIEW_TESTER_ACCESS_MODES.READ_ONLY && state.pillars.length === 1 && state.pillars[0] === "RETAIL";
  } catch { return false; }
}
export function isRetailSubscriberContext(context, now = new Date()) {
  if (!isRetailSubscriberSession(context?.session, now) || context.user?.id !== context.session.userId ||
    context.membership?.organisationId !== RETAIL_SUBSCRIBER_ORGANISATION_ID || context.membership.role !== "OWNER" ||
    !Array.isArray(context.memberships) || context.memberships.length !== 1 ||
    context.memberships[0].organisationId !== RETAIL_SUBSCRIBER_ORGANISATION_ID) return false;
  return isRetailSubscriberSession({ ...context.session, user: { ...context.user, memberships: context.memberships } }, now);
}
export async function resolveRetailSubscriberWorkspace(db, context, { now = new Date() } = {}) {
  if (!isRetailSubscriberContext(context, now)) return null;
  const station = await db.station.findFirst({ where: { id: RETAIL_SUBSCRIBER_STATION_ID, organisationId: RETAIL_SUBSCRIBER_ORGANISATION_ID },
    select: { id: true, name: true, organisationId: true, productFamily: true, status: true,
      publicPlayerEnabled: true, stationWebsiteEnabled: true, listenerRequestsEnabled: true, audiencePolicy: true } });
  if (!station || station.id !== RETAIL_SUBSCRIBER_STATION_ID || station.organisationId !== RETAIL_SUBSCRIBER_ORGANISATION_ID ||
    station.productFamily !== "RETAIL" || station.status !== "DRAFT" || station.publicPlayerEnabled !== false ||
    station.stationWebsiteEnabled !== false || station.listenerRequestsEnabled !== false || station.audiencePolicy !== "INTERNAL") return null;
  // Include every channel on this station, including archived/foreign rows, so
  // an ambiguous inventory can never silently create another planning channel.
  const channels = await db.channel.findMany({ where: { stationId: station.id },
    select: { id: true, name: true, status: true, stationId: true, organisationId: true, musicRightsUse: true }, orderBy: { id: "asc" }, take: 2 });
  if (channels.length > 1 || channels.some(channel => channel.stationId !== station.id ||
    channel.organisationId !== RETAIL_SUBSCRIBER_ORGANISATION_ID || channel.musicRightsUse !== "RETAIL_RADIO" ||
    !["DRAFT", "ACTIVE"].includes(channel.status))) return null;
  return { stationId: station.id, stationName: station.name, channelId: channels[0]?.id || null,
    channels: channels.map(({ id, name, status }) => ({ id, name, status })) };
}
