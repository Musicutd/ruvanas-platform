import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { assertPreviewTesterState, PREVIEW_TESTER_ACCESS_MODES } from "./private-preview-account-policy.mjs";
import { resolveEntitlements } from "./entitlements.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { loadEligibleSubscriberMusic } from "./subscriber-playlist-service.mjs";
import { subscriberMediaIdentity } from "./subscriber-stream-transport.mjs";
import { normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { retailSourceFingerprint, retailPlayoutFingerprint } from "./retail-stream-playout-policy.mjs";

// An explicit owner approval for this pilot only. The shared preview plan,
// subscriber login restrictions, commercial limits and START grant never change.
export const RETAIL_PILOT_ACCESS = Object.freeze({ organisationId: "cmvmeq5880005lf2knwtw1b93",
  email: "retail@manuelchircop.com", host: "pollux.shoutca.st", port: 8330, account: "ruvanastestretail",
  listenerUrl: "https://ruvanastestretail-radio105network.radioca.st/stream", territory: "MT", catalogueLevel: "FOCUSED",
  sourceScopes: Object.freeze(["RUVANAS_CORE", "LICENSED_CATALOGUE"]), kind: "OWNER_RETAIL_PILOT_ACCESS_V1" });
const P = RETAIL_PILOT_ACCESS, ENTITY = "RetailPilotAccess";
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const slug = organisationId => `retail-shared-${createHash("sha256").update(organisationId).digest("hex")}`;
const key = stationId => `retail-pilot-access:${stationId}`;
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
export class RetailPilotAccessError extends Error {
  constructor(reason, status = 409) { super(`Retail pilot access requires review: ${reason}.`); this.name = "RetailPilotAccessError";
    this.code = `RETAIL_PILOT_ACCESS_${reason}`; this.status = status; }
}
const fail = (reason, status) => { throw new RetailPilotAccessError(reason, status); };
function instant(now) { if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("TIME_INVALID", 400); }
function signature(command, env) {
  if (!/^[a-fA-F0-9]{64}$/.test(env?.SECRET_ENCRYPTION_KEY || "")) fail("SIGNING_UNAVAILABLE", 503);
  const derived = createHmac("sha256", Buffer.from(env.SECRET_ENCRYPTION_KEY, "hex")).update("ruvanas/retail-pilot-access/v1").digest();
  return createHmac("sha256", derived).update(canonical(command)).digest("hex");
}
function verified(envelope, env) {
  try { return /^[a-f0-9]{64}$/.test(envelope?.signature || "") && timingSafeEqual(Buffer.from(envelope.signature, "hex"), Buffer.from(signature(envelope.command, env), "hex")); }
  catch { return false; }
}
async function owner(db, actorUserId) {
  if (!id(actorUserId) || (await db.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true } }))?.role !== "SUPER_ADMIN") fail("OWNER_REQUIRED", 403);
}
function managedIdentity(station) {
  return Boolean(station?.organisationId === P.organisationId && id(station.id) &&
    station.slug === slug(P.organisationId) && station.productFamily === "RETAIL");
}
function target(station) {
  const source = station?.streamConfig;
  return Boolean(managedIdentity(station) && station.status === "DRAFT" && station.publicPlayerEnabled === false &&
    station.stationWebsiteEnabled === false && station.listenerRequestsEnabled === false && station.audiencePolicy === "INTERNAL" &&
    source?.stationId === station.id && source.providerKey === "CENTOVA_CAST" && source.outputCodec === "MP3" &&
    source.serverHost === P.host && source.serverPort === P.port && source.sourcePort === P.port && source.centovaUsername === P.account &&
    !source.sourceUsername && source.streamUrl === P.listenerUrl && source.bitrateKbps === 128 && source.outboundAutoDjEnabled === false &&
    source.probeEnabled === false && typeof source.sourcePasswordEncrypted === "string" && source.sourcePasswordEncrypted.length);
}
async function tester(db, station, now) {
  if (!target(station)) fail("TARGET_UNAVAILABLE");
  const user = await db.user.findUnique({ where: { email: P.email }, include: { privatePreviewAccess: true,
    memberships: { include: { organisation: { include: { enterpriseSecurityPolicy: true,
      subscription: { include: { plan: true, billingContract: true } } } } } } } });
  let state;
  try { state = assertPreviewTesterState(user, { now, requirePassword: true }); } catch { fail("TESTER_UNAVAILABLE"); }
  if (String(user.email || "").toLowerCase() !== P.email || state.grant.organisationId !== P.organisationId ||
    state.accessMode !== PREVIEW_TESTER_ACCESS_MODES.READ_ONLY || state.pillars.length !== 1 || state.pillars[0] !== "RETAIL" ||
    await db.organisationMember.count({ where: { organisationId: P.organisationId } }) !== 1) fail("TESTER_UNAVAILABLE");
  const entitlements = resolveEntitlements(state.subscription, now);
  if (!entitlements.serviceEnabled || !entitlements.retailRadioEnabled || entitlements.outputEnabled !== false) fail("TESTER_UNAVAILABLE");
  return { userId: user.id, expiresAt: state.grant.expiresAt.toISOString() };
}
async function stationFor(db, organisationId) {
  if (organisationId !== P.organisationId) fail("TARGET_UNAVAILABLE", 404);
  const station = await db.station.findUnique({ where: { slug: slug(organisationId) }, include: { streamConfig: true } });
  // Read/revoke keeps the immutable organisation/station boundary but does not
  // depend on mutable source details or playback flags. Otherwise a temporary
  // source change could hide the revoke control and revive an old approval when
  // restored. The approval path separately rechecks the full exact target.
  if (!managedIdentity(station)) fail("TARGET_UNAVAILABLE");
  return station;
}
async function availableGrant(db, station, account, now, env) {
  const record = await db.auditLog.findUnique({ where: { id: key(station.id) } }), envelope = record?.details, command = envelope?.command;
  if (record?.entityType !== ENTITY || record.entityId !== station.id || record.organisationId !== P.organisationId ||
    !verified(envelope, env) || command?.kind !== P.kind || command.action !== "APPROVE" || !id(command.id) ||
    command.organisationId !== P.organisationId || command.stationId !== station.id || command.testerUserId !== account.userId ||
    command.territory !== P.territory || command.catalogueLevel !== P.catalogueLevel ||
    JSON.stringify(command.sourceScopes) !== JSON.stringify(P.sourceScopes) || command.expiresAt !== account.expiresAt ||
    !Number.isFinite(Date.parse(command.issuedAt)) || Date.parse(command.issuedAt) > now.getTime() ||
    Date.parse(command.expiresAt) <= now.getTime() || command.sourceFingerprint !== retailSourceFingerprint(station.streamConfig)) return null;
  try { await owner(db, command.actorUserId); } catch { return null; }
  return { approved: true, territory: P.territory, catalogueLevel: P.catalogueLevel, sourceScopes: [...P.sourceScopes],
    expiresAt: command.expiresAt, fingerprint: retailPlayoutFingerprint(command) };
}
/** Fail closed for an absent, expired, revoked or changed pilot. Ordinary
 * organisations take their existing entitlement path and incur no grant read. */
export async function loadRetailPilotAccess(db, { station, now = new Date(), env = process.env } = {}) {
  if (station?.organisationId !== P.organisationId) return null;
  instant(now);
  try { const account = await tester(db, station, now); return await availableGrant(db, station, account, now, env); }
  catch (error) { if (error instanceof RetailPilotAccessError) return null; throw error; }
}
async function proposalCount(db, station, now) {
  const genres = await db.mediaGenre.findMany({ where: { active: true }, select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 501 });
  if (genres.length > 500) fail("CATALOGUE_REVIEW_REQUIRED");
  const programme = (await db.auditLog.findUnique({ where: { id: `retail-playout:programme:${station.id}` } }))?.details;
  const selectedGenres = programme?.stationId === station.id && programme.organisationId === P.organisationId &&
    programme.territory === P.territory && Array.isArray(programme.genreCodes) ? programme.genreCodes.map(normaliseGenreCode) : [];
  const rows = await loadEligibleSubscriberMusic(db, { organisationId: P.organisationId, requiredUse: "RETAIL_RADIO",
    territory: P.territory, catalogueLevel: P.catalogueLevel, sourceScopes: [...P.sourceScopes], configuredGenres: genres, instant: now });
  if (rows.length >= 5000) fail("CATALOGUE_REVIEW_REQUIRED");
  const assets = new Set(), recordings = new Set();
  for (const row of rows) {
    const asset = row.track.mediaAsset;
    if (selectedGenres.length && !row.genreCodes.some(code => selectedGenres.includes(code)) ||
      !Number.isFinite(Number(asset?.durationSeconds)) || Number(asset.durationSeconds) > 3600 || !id(asset?.id)) continue;
    let identity; try { identity = subscriberMediaIdentity(asset); } catch { continue; }
    if (assets.has(asset.id) || recordings.has(identity.checksum)) continue;
    assets.add(asset.id); recordings.add(identity.checksum);
  }
  return assets.size;
}
function publicView({ eligible, approved = false, canApprove = false, canRevoke = false, eligibleTrackCount = 0, expiresAt = null, blocker = null }) {
  return { eligible, approved, canApprove, canRevoke, territory: P.territory, catalogueLevel: P.catalogueLevel,
    sourceScopes: [...P.sourceScopes], eligibleTrackCount, expiresAt, blocker };
}
export async function loadRetailPilotAccessProposal(db, { actorUserId, organisationId, now = new Date(), env = process.env } = {}) {
  instant(now); await owner(db, actorUserId);
  const station = await stationFor(db, organisationId);
  let account;
  try { account = await tester(db, station, now); } catch (error) {
    if (!(error instanceof RetailPilotAccessError)) throw error;
    const previous = await db.auditLog.findUnique({ where: { id: key(station.id) } });
    return publicView({ eligible: false, canRevoke: previous?.details?.command?.action === "APPROVE", blocker: error.code });
  }
  const grant = await availableGrant(db, station, account, now, env), eligibleTrackCount = await proposalCount(db, station, now);
  const control = (await db.auditLog.findUnique({ where: { id: `retail-playout:control:${station.id}` } }))?.details?.command;
  const busy = Boolean(station.streamConfig.encoderLeaseOwner || control?.action === "START");
  return publicView({ eligible: true, approved: Boolean(grant), canApprove: !grant && !busy, canRevoke: Boolean(grant),
    eligibleTrackCount, expiresAt: account.expiresAt, blocker: !grant && busy ? "RETAIL_PILOT_ACCESS_STOP_REQUIRED" : null });
}
export async function changeRetailPilotAccess(db, { actorUserId, organisationId, action, confirmed, now = new Date(), env = process.env } = {}) {
  instant(now);
  if (!["approve", "revoke"].includes(action) || confirmed !== true) fail("CONFIRMATION_REQUIRED", 400);
  await runSerializableTransaction(db, async tx => {
    await owner(tx, actorUserId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"retail-shared-stream-setup:v1"}))`;
    const station = await stationFor(tx, organisationId);
    let command;
    if (action === "approve") {
      const account = await tester(tx, station, now);
      const control = (await tx.auditLog.findUnique({ where: { id: `retail-playout:control:${station.id}` } }))?.details?.command;
      if (station.streamConfig.encoderLeaseOwner || control?.action === "START") fail("STOP_REQUIRED");
      if (await availableGrant(tx, station, account, now, env)) return;
      command = { kind: P.kind, action: "APPROVE", id: randomUUID(), organisationId, stationId: station.id,
        actorUserId, testerUserId: account.userId, issuedAt: now.toISOString(), expiresAt: account.expiresAt,
        territory: P.territory, catalogueLevel: P.catalogueLevel, sourceScopes: [...P.sourceScopes],
        sourceFingerprint: retailSourceFingerprint(station.streamConfig) };
    } else command = { kind: P.kind, action: "REVOKE", id: randomUUID(), organisationId, stationId: station.id,
      actorUserId, issuedAt: now.toISOString() };
    // Revocation never depends on a valid signing key or an active tester.
    let signed = null;
    if (action === "approve") signed = signature(command, env);
    const data = { organisationId, actorUserId, action: action === "approve" ? "RETAIL_PILOT_ACCESS_APPROVED" : "RETAIL_PILOT_ACCESS_REVOKED",
      entityType: ENTITY, entityId: station.id, details: { command, signature: signed }, createdAt: now };
    await tx.auditLog.upsert({ where: { id: key(station.id) }, create: { id: key(station.id), ...data }, update: data });
    await tx.auditLog.create({ data: { ...data, details: { action: command.action, territory: P.territory,
      catalogueLevel: P.catalogueLevel, expiresAt: command.expiresAt || null, planChanged: false, audioStarted: false, capacityAssigned: false } } });
  });
  return { accepted: true, action, access: await loadRetailPilotAccessProposal(db, { actorUserId, organisationId, now, env }) };
}
