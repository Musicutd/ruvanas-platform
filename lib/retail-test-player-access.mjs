import { assertPreviewTesterState } from "./private-preview-account-policy.mjs";
import { loadRetailPilotAccess, RETAIL_PILOT_ACCESS as PILOT } from "./retail-stream-pilot-access.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "./retail-subscriber-access.mjs";
import { bindSubscriberTestPlan } from "./subscriber-test-plan.mjs";
import { resolveEntitlements } from "./entitlements.mjs";

const HASH = /^[a-f0-9]{64}$/;
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const instant = value => value instanceof Date && Number.isFinite(value.getTime());
export const RETAIL_TEST_PLAYER_INCLUDE = Object.freeze({ organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } },
  zone: { include: { location: { include: { correctionsFacility: { select: { id: true } } } } } } });

async function authorize(db, player, { now = new Date(), env = process.env, pending = false } = {}) {
  if (!instant(now) || !player || player.organisationId !== ORG || player.organisation?.id !== ORG ||
      !id(player.id) || !id(player.zoneId) || player.zone?.id !== player.zoneId || player.zone.status !== "ACTIVE" ||
      player.zone.locationId !== player.zone.location?.id || player.zone.location.organisationId !== ORG ||
      player.zone.location.status !== "ACTIVE" || player.zone.location.correctionsFacility ||
      player.status === "DISABLED" || player.retiredAt || player.sessionRevokedAt ||
      (!pending && (!instant(player.enrolledAt) || player.enrolledAt > now || !HASH.test(player.sessionTokenHash || "")))) return null;
  const user = await db.user.findUnique({ where: { email: PILOT.email }, include: { privatePreviewAccess: true,
    memberships: { include: { organisation: { include: { enterpriseSecurityPolicy: true,
      subscription: { include: { plan: true, billingContract: true } } } } } } } });
  let state;
  try { state = assertPreviewTesterState(user, { now, requirePassword: false }); } catch { return null; }
  if (user.email !== PILOT.email || state.grant.organisationId !== ORG || state.grant.subscriberTestingEnabled !== true ||
      state.accessMode !== "READ_ONLY" || state.pillars.length !== 1 || state.pillars[0] !== "RETAIL" ||
      await db.organisationMember.count({ where: { organisationId: ORG } }) !== 1) return null;
  const station = await db.station.findUnique({ where: { id: STATION }, include: { streamConfig: true } });
  if (station?.id !== STATION || station.organisationId !== ORG || !Number.isSafeInteger(station.listenerLimit) || station.listenerLimit < 1 ||
      station.streamConfig?.streamUrl !== PILOT.listenerUrl) return null;
  const access = await loadRetailPilotAccess(db, { station, now, env });
  if (!access?.approved || access.expiresAt !== state.grant.expiresAt.toISOString()) return null;
  const channels = await db.channel.findMany({ where: { stationId: STATION },
    select: { id: true, name: true, status: true, stationId: true, organisationId: true, musicRightsUse: true }, take: 2 });
  if (channels.length !== 1 || !id(channels[0].id) || channels[0].organisationId !== ORG || channels[0].stationId !== STATION ||
      channels[0].musicRightsUse !== "RETAIL_RADIO" || !["DRAFT", "ACTIVE"].includes(channels[0].status)) return null;
  const assignments = await db.channelAssignment.findMany({ where: { zoneId: player.zoneId,
    activeFrom: { lte: now }, OR: [{ activeTo: null }, { activeTo: { gt: now } }] }, select: { channelId: true }, take: 2 });
  if (assignments.length > 1 || assignments.some(row => row.channelId !== channels[0].id)) return null;
  // Default shared programme is a view only: no new channel, zone assignment,
  // source, worker or station setting is created by enrolling a listening device.
  const subscription = player.organisation.subscription;
  if (!subscription || subscription.organisationId !== ORG || subscription.id !== state.subscription.id) return null;
  bindSubscriberTestPlan(subscription, user, now);
  const entitlements = resolveEntitlements(subscription, now);
  const listenerLimit = Math.min(entitlements.streamLimit, station.listenerLimit);
  if (!entitlements.serviceEnabled || !entitlements.retailRadioEnabled || !Number.isSafeInteger(listenerLimit) || listenerLimit < 1) return null;
  const view = Object.freeze({ kind: "RETAIL_SHARED_STREAM", stationId: STATION, channelId: channels[0].id,
    name: "Retail radio", streamUrl: PILOT.listenerUrl, expiresAt: access.expiresAt });
  return { ...player, subscriberTestStream: view, subscriberTestListenerLimit: listenerLimit,
    zone: { ...player.zone, channelAssignments: [{ channel: { id: channels[0].id, name: "Retail radio" } }] } };
}

/** The middleware and route share the same freshly validated device-cookie
 * authority. A hash match alone never unlocks preview output or music files. */
export async function loadRetailTestPlayerByTokenHash(db, tokenHash, options = {}) {
  if (!HASH.test(tokenHash || "")) return null;
  const player = await db.player.findUnique({ where: { sessionTokenHash: tokenHash }, include: RETAIL_TEST_PLAYER_INCLUDE });
  if (player?.sessionTokenHash !== tokenHash) return null;
  return authorize(db, player, options);
}

export async function loadRetailTestPlayerForEnrolment(db, tokenHash, options = {}) {
  if (!HASH.test(tokenHash || "")) return null;
  const now = options.now || new Date();
  const player = await db.player.findUnique({ where: { enrolmentTokenHash: tokenHash }, include: RETAIL_TEST_PLAYER_INCLUDE });
  if (player?.enrolmentTokenHash !== tokenHash || !instant(player.enrolmentExpiresAt) || player.enrolmentExpiresAt <= now) return null;
  return authorize(db, player, { ...options, now, pending: true });
}

export function retailTestStreamManifest(player, now = new Date()) {
  if (player?.subscriberTestStream?.kind !== "RETAIL_SHARED_STREAM") return null;
  return { version: `retail-shared-stream:${player.id}`, generatedAt: now.toISOString(),
    subscriberTestStream: player.subscriberTestStream, playlist: [], insertions: [], live: null,
    proofOfPlayEnabled: false, playbackEvidence: "DEVICE_REPORTED_STREAM_ONLY" };
}
