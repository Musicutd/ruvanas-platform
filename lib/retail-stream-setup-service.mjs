// Draft-only persistence through an injected database and encryption function.
// The HTTP/session boundary must authenticate the actor; this service rechecks
// the current database role, tenant, plan and inventory in its own transaction.
// No provider, worker, DNS, environment, storage or audio client is imported.
import { createHash } from "node:crypto";
import { resolveEntitlements, resolveEffectivePlan } from "./entitlements.mjs";
import { retailSharedStreamPlan, RetailStreamOnboardingError, RETAIL_SHARED_STREAM_POLICY } from "./retail-stream-onboarding.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { RETAIL_PILOT_HOST_CORRECTION, isRetailPilotHostCorrectionTarget } from "./retail-stream-host-correction.mjs";

const definitions = Object.freeze({
  INPUT_INVALID: [400, "Enter only the supported Retail connection fields."],
  ADMIN_REQUIRED: [403, "A current Super Admin session is required."],
  ORGANISATION_NOT_FOUND: [404, "The Retail subscriber organisation was not found."],
  SERVICE_INACTIVE: [403, "The subscriber service is inactive."],
  RETAIL_NOT_INCLUDED: [403, "Retail Radio is not included in the current subscriber service."],
  PLAN_LIMITS_REQUIRED: [409, "The current plan needs valid stream, listener, storage and bitrate limits before a draft can be saved."],
  STATION_LIMIT_REACHED: [409, "The subscriber has reached the current plan's station limit. No station or plan limit was changed."],
  PROFILE_REVIEW_REQUIRED: [409, "An existing station or streaming profile needs review. No running or configured profile was reset."],
  INVENTORY_REVIEW_REQUIRED: [409, "The existing destination inventory is incomplete or too large. Review it before saving."],
  SOURCE_ALREADY_ASSIGNED: [409, "This source endpoint is already assigned to an existing streaming destination."],
  TARGET_UPDATE_REQUIRES_REVIEW: [409, "A destination is already saved. Changing its identity needs a separate review."],
  CREDENTIAL_UPDATE_REQUIRES_REVIEW: [409, "A credential is already saved. Leave the password blank to keep it; replacement needs review."],
  HOST_CORRECTION_NOT_ALLOWED: [409, "This correction applies only to the confirmed, disconnected Test Retail draft. Nothing was changed."],
  HOST_CORRECTION_DNS_UNAVAILABLE: [409, "The confirmed source hostname could not be verified as public. Nothing was changed."],
  SOURCE_CREDENTIAL_REQUIRED: [400, "Enter the source password for the first draft save. Do not enter the Centova administrator password."],
  SOURCE_CREDENTIAL_INVALID: [400, "The source password must be nonempty, at most 1024 characters, and contain no control characters."],
  CREDENTIAL_ENCRYPTION_FAILED: [503, "The source credential could not be stored securely. Nothing was saved."],
  CONCURRENT_CHANGE: [409, "The draft changed during preparation. Reload it before trying again."],
  PERSISTENCE_UNAVAILABLE: [503, "The draft could not be confirmed. Reload before retrying; no stream was started."]
});
export class RetailStreamSetupError extends Error {
  constructor(reason) {
    const key = Object.hasOwn(definitions, reason) ? reason : "PERSISTENCE_UNAVAILABLE";
    super(definitions[key][1]); this.name = "RetailStreamSetupError";
    this.code = `RETAIL_STREAM_SETUP_${key}`; this.status = definitions[key][0];
  }
}
export function retailStreamSetupMessage(code) {
  const key = typeof code === "string" ? code.replace(/^RETAIL_STREAM_SETUP_/, "") : "";
  return Object.hasOwn(definitions, key) ? definitions[key][1] : definitions.PERSISTENCE_UNAVAILABLE[1];
}
const fail = reason => { throw new RetailStreamSetupError(reason); };
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integerLimit = value => Number.isInteger(value) && value >= 1 && value <= 2147483647;
const fingerprint = value => createHash("sha256").update(value).digest("hex");
export function retailStreamStationSlug(organisationId) {
  if (!id(organisationId)) fail("INPUT_INVALID");
  return `retail-shared-${fingerprint(organisationId)}`;
}
const boundedText = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160) : "";
const cap = RETAIL_SHARED_STREAM_POLICY.maximumExistingOutputs;
const off = Object.freeze({ canStart: false, outboundAutoDjEnabled: false, probeEnabled: false, publicPlayerEnabled: false,
  stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL", workerAllocated: false,
  activationAllowed: false, provisioningAllowed: false });
const unverified = Object.freeze({ dns: false, listener: false, sourceCredential: false, providerOwnership: false,
  globalAssignmentUniqueness: false, musicRights: false, costs: false });
const targetFields = ["providerKey", "outputCodec", "streamUrl", "serverHost", "serverPort", "sourcePort", "centovaUsername", "sourceUsername"];
const inputFields = new Set([...targetFields, "bitrateKbps", "sourcePassword"]);
const safeConfigSelect = Object.freeze({ providerKey: true, outputCodec: true, streamUrl: true, serverHost: true,
  serverPort: true, sourcePort: true, sourceUsername: true, centovaUsername: true, bitrateKbps: true,
  outboundAutoDjEnabled: true, probeEnabled: true, encoderLeaseOwner: true, encoderLeaseUntil: true,
  sourceConnectionStatus: true, lastError: true });
const stationSelect = Object.freeze({ id: true, organisationId: true, productFamily: true, name: true, slug: true,
  status: true, listenerLimit: true, storageLimitGb: true, maxBitrateKbps: true, storageUsedMb: true,
  publicPlayerEnabled: true, stationWebsiteEnabled: true, listenerRequestsEnabled: true, audiencePolicy: true,
  _count: { select: { channels: true, playoutEvents: true, catalogueTests: true, websiteDomains: true } },
  streamConfig: { select: { ...safeConfigSelect, sourcePasswordEncrypted: true, adminPasswordEncrypted: true,
    lastConnectedAt: true, lastHeartbeatAt: true, lastProbeAt: true } } });

function initialConnection() {
  return null;
}
function publicConnection(config) {
  if (!config) return initialConnection();
  return { providerKey: config.providerKey, outputCodec: config.outputCodec, streamUrl: config.streamUrl,
    serverHost: config.serverHost, serverPort: config.serverPort ?? null, sourcePort: config.sourcePort,
    centovaUsername: config.centovaUsername, sourceUsername: config.sourceUsername || null,
    bitrateKbps: config.bitrateKbps, credentialConfigured: Boolean(config.sourcePasswordEncrypted) };
}
function safeLimits(entitlements) {
  const result = {};
  for (const key of ["maxBitrateKbps", "listenerLimit", "storageLimitGb", "stationLimit", "streamLimit", "digitalSignageDisplayLimit", "siteLimit", "displayLimit"])
    result[key] = Number.isSafeInteger(entitlements?.[key]) && entitlements[key] >= 0 ? entitlements[key] : null;
  return result;
}
function view(ctx, connection = initialConnection(), error = null) {
  return { organisation: { id: ctx.organisation.id, name: boundedText(ctx.organisation.name) },
    status: "DRAFT_CONFIGURATION_ONLY", canSaveDraft: !error, blockedReason: error?.code || null,
    blockers: error ? [error.message] : [], entitlements: safeLimits(ctx.entitlements),
    station: ctx.station ? { id: ctx.station.id, status: ctx.station.status } : null,
    connection, ...off, verification: { ...unverified }, outputCount: 1, sharedAcrossShops: true,
    enterpriseMultistreamEnabled: false, requiresPlanLimitReview: ctx.entitlements?.siteLimit == null ||
      ctx.entitlements?.displayLimit == null && ctx.entitlements?.digitalSignageDisplayLimit == null,
    warnings: ["Saving only prepares a private, disconnected draft. No audio, provider account, worker or resource is started.",
      "Site and display limits remain independent of the single shared stream. Existing plan values are unchanged.",
      "Source credentials, public DNS, global destination uniqueness, music rights, capacity and costs are not verified."] };
}
function assertRequest(actorUserId, organisationId, now) {
  if (!id(actorUserId) || !id(organisationId) || !(now instanceof Date) || !Number.isFinite(now.getTime())) fail("INPUT_INVALID");
}
function assertLimits(entitlements) {
  if (!entitlements.serviceEnabled) fail("SERVICE_INACTIVE");
  if (!entitlements.retailRadioEnabled) fail("RETAIL_NOT_INCLUDED");
  if (!["stationLimit", "streamLimit", "listenerLimit", "storageLimitGb"].every(key => integerLimit(entitlements[key])) ||
    !Number.isInteger(entitlements.maxBitrateKbps) || entitlements.maxBitrateKbps < 8 || entitlements.maxBitrateKbps > 320) fail("PLAN_LIMITS_REQUIRED");
}
function pristine(station, organisationId, destinations) {
  if (!station) return;
  if (station.organisationId !== organisationId || station.productFamily !== "RETAIL" || station.status !== "DRAFT" ||
    station.publicPlayerEnabled !== false || station.stationWebsiteEnabled !== false || station.listenerRequestsEnabled !== false ||
    station.audiencePolicy !== "INTERNAL" || station.storageUsedMb !== 0 ||
    ["channels", "playoutEvents", "catalogueTests", "websiteDomains"].some(key => station._count?.[key] !== 0) ||
    destinations.some(row => row.stationId === station.id)) fail("PROFILE_REVIEW_REQUIRED");
  const config = station.streamConfig;
  if (config && (config.outboundAutoDjEnabled !== false || config.probeEnabled !== false || config.encoderLeaseOwner !== null ||
    config.encoderLeaseUntil !== null || config.sourceConnectionStatus !== "DISCONNECTED" || config.lastError !== null ||
    config.adminPasswordEncrypted !== null || config.lastConnectedAt !== null || config.lastHeartbeatAt !== null || config.lastProbeAt !== null)) fail("PROFILE_REVIEW_REQUIRED");
}
function inventoryRow(station, destinations) {
  const config = station.streamConfig;
  return { stationId: station.id, organisationId: station.organisationId, productFamily: station.productFamily,
    status: station.status, providerKey: config?.providerKey ?? null, serverHost: config?.serverHost ?? null,
    sourcePort: config?.sourcePort ?? null, centovaUsername: config?.centovaUsername || null,
    outboundAutoDjEnabled: config ? config.outboundAutoDjEnabled : false,
    encoderLeaseOwner: config ? config.encoderLeaseOwner : null, encoderLeaseUntil: config ? config.encoderLeaseUntil : null,
    probeEnabled: config ? config.probeEnabled : false, sourceConnectionStatus: config ? config.sourceConnectionStatus : "DISCONNECTED",
    publicPlayerEnabled: station.publicPlayerEnabled, stationWebsiteEnabled: station.stationWebsiteEnabled,
    streamingProfileCount: destinations.filter(row => row.stationId === station.id).length };
}
function inventoryHost(value) {
  if (typeof value !== "string" || value.length > 254 || !/^[A-Za-z0-9.-]+$/.test(value)) fail("INVENTORY_REVIEW_REQUIRED");
  const host = value.toLowerCase().replace(/\.$/, "");
  let url;
  try { url = new URL(`https://${host}`); } catch { fail("INVENTORY_REVIEW_REQUIRED"); }
  if (url.hostname !== host || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) fail("INVENTORY_REVIEW_REQUIRED");
  return host;
}
function checkStudioCollisions(destinations, connection) {
  for (const row of destinations) {
    if (!id(row.id) || !id(row.organisationId) || !["RUVANAS_MANAGED", "SHOUTCAST", "ICECAST"].includes(row.type)) fail("INVENTORY_REVIEW_REQUIRED");
    if (row.type === "RUVANAS_MANAGED") continue;
    const host = inventoryHost(row.host);
    if (!Number.isInteger(row.port) || row.port < 1 || row.port > 65535) fail("INVENTORY_REVIEW_REQUIRED");
    if (host === connection.serverHost && row.port === connection.sourcePort) fail("SOURCE_ALREADY_ASSIGNED");
  }
}
async function context(tx, { actorUserId, organisationId, now }) {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true } });
  if (actor?.id !== actorUserId || actor.role !== "SUPER_ADMIN") fail("ADMIN_REQUIRED");
  const organisation = await tx.organisation.findUnique({ where: { id: organisationId },
    include: { subscription: { include: { plan: true, billingContract: true } } } });
  if (organisation?.id !== organisationId) fail("ORGANISATION_NOT_FOUND");
  let entitlements;
  try {
    const effective = resolveEffectivePlan(organisation.subscription);
    entitlements = { ...resolveEntitlements(organisation.subscription, now), siteLimit: effective?.siteLimit ?? null, displayLimit: effective?.displayLimit ?? null };
  } catch { fail("PLAN_LIMITS_REQUIRED"); }
  const slug = retailStreamStationSlug(organisationId);
  const station = await tx.station.findUnique({ where: { slug }, select: stationSelect });
  if (station && station.slug !== slug) fail("PROFILE_REVIEW_REQUIRED");
  const [stations, destinations, stationCount] = await Promise.all([
    tx.station.findMany({ where: { OR: [{ streamConfig: { isNot: null } }, { organisationId, productFamily: "RETAIL" }] },
      select: { id: true, organisationId: true, productFamily: true, status: true, publicPlayerEnabled: true,
        stationWebsiteEnabled: true, streamConfig: { select: safeConfigSelect } }, orderBy: { id: "asc" }, take: cap + 1 }),
    tx.studioBroadcastDestination.findMany({ select: { id: true, organisationId: true, stationId: true, type: true, host: true, port: true },
      orderBy: { id: "asc" }, take: cap + 1 }),
    // Match the existing station-creation allowance across every product and
    // state, including stations with no stream configuration.
    tx.station.count({ where: { organisationId } })
  ]);
  if (!Array.isArray(stations) || !Array.isArray(destinations) || stations.length > cap || destinations.length > cap ||
    !Number.isSafeInteger(stationCount) || stationCount < 0) fail("INVENTORY_REVIEW_REQUIRED");
  const ctx = { organisation, entitlements, slug, station, stations, destinations };
  try {
    assertLimits(entitlements); pristine(station, organisationId, destinations);
    // Existing saved allowances are not silently reconciled to a revised plan.
    // A deliberate limit-review flow is outside this connection-only increment.
    if (station && changedLimits(station, entitlements)) fail("PLAN_LIMITS_REQUIRED");
    if (!station && stationCount >= entitlements.stationLimit) fail("STATION_LIMIT_REACHED");
    if (stations.some(row => row.organisationId === organisationId && row.productFamily === "RETAIL" &&
      !["CANCELLED", "ARCHIVED"].includes(row.status) && row.id !== station?.id)) fail("PROFILE_REVIEW_REQUIRED");
  } catch (error) { ctx.blocked = error; }
  return ctx;
}
function planFor(ctx, connection, credentialConfigured) {
  return retailSharedStreamPlan({ organisationId: ctx.organisation.id, entitlements: ctx.entitlements,
    connection: { ...connection, stationId: ctx.station?.id ?? null, organisationId: ctx.organisation.id,
      productFamily: "RETAIL", credentialConfigured }, existingOutputs: ctx.stations.map(row => inventoryRow(row, ctx.destinations)) });
}
function existingPlan(ctx) {
  if (!ctx.station?.streamConfig) return null;
  const config = publicConnection(ctx.station.streamConfig), { credentialConfigured, ...connection } = config;
  return planFor(ctx, connection, credentialConfigured);
}
const supportedError = error => error instanceof RetailStreamSetupError || error instanceof RetailStreamOnboardingError;
function safeError(error) { return supportedError(error) ? error : new RetailStreamSetupError("PERSISTENCE_UNAVAILABLE"); }

export async function loadRetailStreamSetup(database, { actorUserId, organisationId, now = new Date() } = {}) {
  assertRequest(actorUserId, organisationId, now);
  try {
    return await runSerializableTransaction(database, async tx => {
      const ctx = await context(tx, { actorUserId, organisationId, now });
      if (ctx.blocked) return view(ctx, initialConnection(), ctx.blocked);
      try {
        const plan = existingPlan(ctx);
        if (plan) checkStudioCollisions(ctx.destinations, plan.connection);
        const { stationId: _stationId, ...connection } = plan?.connection || {};
        return view(ctx, plan ? connection : initialConnection());
      } catch (error) { return view(ctx, initialConnection(), safeError(error)); }
    });
  } catch (error) { throw safeError(error); }
}
function parseInput(input) {
  if (!plain(input) || Object.keys(input).some(key => !inputFields.has(key))) fail("INPUT_INVALID");
  const password = input.sourcePassword;
  if (password !== undefined && (typeof password !== "string" || password.length > 1024 || /[\u0000-\u001f\u007f]/.test(password))) fail("SOURCE_CREDENTIAL_INVALID");
  const connection = { providerKey: input.providerKey ?? "CENTOVA_CAST", outputCodec: input.outputCodec ?? "MP3",
    streamUrl: input.streamUrl, serverHost: input.serverHost, serverPort: input.serverPort ?? null, sourcePort: input.sourcePort,
    centovaUsername: input.centovaUsername, sourceUsername: input.sourceUsername ?? null, bitrateKbps: input.bitrateKbps };
  return { connection, password: password || null };
}
function ciphertext(value) {
  return typeof value === "string" && value.length <= 10000 && /^[a-f0-9]{24}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/.test(value);
}
function changedLimits(station, entitlements) {
  return !station || station.listenerLimit !== entitlements.listenerLimit || station.storageLimitGb !== entitlements.storageLimitGb || station.maxBitrateKbps !== entitlements.maxBitrateKbps;
}

export async function saveRetailStreamSetup(database, { actorUserId, organisationId, input, encryptSecret, now = new Date() } = {}) {
  assertRequest(actorUserId, organisationId, now);
  const parsed = parseInput(input);
  try {
    return await runSerializableTransaction(database, async tx => {
      // All calls through this new writer serialize together. Other legacy
      // writers do not yet take this lock: global uniqueness is NOT certified,
      // and activation stays unavailable pending shared-writer/schema review.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"retail-shared-stream-setup:v1"}))`;
      const ctx = await context(tx, { actorUserId, organisationId, now });
      if (ctx.blocked) throw ctx.blocked;
      const old = ctx.station?.streamConfig, stored = old?.sourcePasswordEncrypted || null;
      if (stored && !ciphertext(stored)) fail("PROFILE_REVIEW_REQUIRED");
      if (stored && parsed.password) fail("CREDENTIAL_UPDATE_REQUIRES_REVIEW");
      if (!stored && !parsed.password) fail("SOURCE_CREDENTIAL_REQUIRED");
      const plan = planFor(ctx, parsed.connection, Boolean(stored || parsed.password));
      checkStudioCollisions(ctx.destinations, plan.connection);
      if (old) {
        const approved = existingPlan(ctx)?.connection;
        if (!approved || targetFields.some(key => approved[key] !== plan.connection[key])) fail("TARGET_UPDATE_REQUIRES_REVIEW");
      }
      let encrypted = stored;
      if (!stored) {
        if (typeof encryptSecret !== "function") fail("CREDENTIAL_ENCRYPTION_FAILED");
        try { encrypted = encryptSecret(parsed.password); } catch { fail("CREDENTIAL_ENCRYPTION_FAILED"); }
        if (encrypted && typeof encrypted.then === "function") { Promise.resolve(encrypted).catch(() => {}); fail("CREDENTIAL_ENCRYPTION_FAILED"); }
        if (!ciphertext(encrypted)) fail("CREDENTIAL_ENCRYPTION_FAILED");
      }
      const conn = plan.connection;
      const target = Object.fromEntries([...targetFields, "bitrateKbps"].map(key => [key, conn[key]]));
      const limits = { listenerLimit: ctx.entitlements.listenerLimit, storageLimitGb: ctx.entitlements.storageLimitGb, maxBitrateKbps: ctx.entitlements.maxBitrateKbps };
      const unchanged = Boolean(stored && old && old.bitrateKbps === conn.bitrateKbps && !changedLimits(ctx.station, ctx.entitlements));
      if (unchanged) return { saved: true, unchanged: true, setup: view(ctx, publicConnection(old)) };
      let station = ctx.station;
      if (!station) {
        station = await tx.station.create({ data: { organisationId, productFamily: "RETAIL", slug: ctx.slug,
          name: `${boundedText(ctx.organisation.name) || "Retail subscriber"} · shared stream`.slice(0, 160), status: "DRAFT",
          storageUsedMb: 0, ...limits, publicPlayerEnabled: false, stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL" },
          select: { id: true, status: true } });
        if (!id(station?.id) || station.status !== "DRAFT") fail("CONCURRENT_CHANGE");
      }
      if (!old) {
        await tx.stationStreamConfig.create({ data: { stationId: station.id, ...target, sourcePasswordEncrypted: encrypted,
          adminPasswordEncrypted: null, outboundAutoDjEnabled: false, probeEnabled: false, encoderLeaseOwner: null, encoderLeaseUntil: null,
          sourceConnectionStatus: "DISCONNECTED", lastConnectedAt: null, lastHeartbeatAt: null, lastProbeAt: null, lastError: null } });
      } else {
        const updated = await tx.stationStreamConfig.updateMany({ where: { stationId: station.id, ...Object.fromEntries(targetFields.map(key => [key, old[key] ?? null])),
          sourcePasswordEncrypted: stored, outboundAutoDjEnabled: false, probeEnabled: false, encoderLeaseOwner: null, encoderLeaseUntil: null,
          sourceConnectionStatus: "DISCONNECTED", lastError: null }, data: { bitrateKbps: conn.bitrateKbps, ...(!stored ? { sourcePasswordEncrypted: encrypted } : {}) } });
        if (updated.count !== 1) fail("CONCURRENT_CHANGE");
      }
      await tx.auditLog.create({ data: { organisationId, actorUserId, action: "RETAIL_SHARED_STREAM_DRAFT_SAVED", entityType: "Station", entityId: station.id,
        details: { draftOnly: true, productFamily: "RETAIL", sharedOutputCount: 1, stationCreated: !ctx.station,
          sourceCredentialConfigured: true, sourceCredentialReplaced: false, outputEnabled: false, probeEnabled: false,
          workerAllocated: false, providerProvisioned: false }, createdAt: now } });
      return { saved: true, unchanged: false, setup: view({ ...ctx, station }, { ...target, credentialConfigured: true }) };
    });
  } catch (error) { throw safeError(error); }
}

/** The provider-confirmed hostname repair is deliberately separate from draft
 * saving. It cannot rotate secrets, change ports, activate audio or edit another
 * subscriber. The injected inspector performs DNS only, never a source login.
 */
export async function correctRetailPilotSourceHost(database, { actorUserId, organisationId, input, inspectSource, now = new Date() } = {}) {
  assertRequest(actorUserId, organisationId, now);
  const scope = RETAIL_PILOT_HOST_CORRECTION;
  if (!plain(input) || Object.keys(input).length !== 2 ||
      input.expectedCurrentHost !== scope.fromHost || input.confirmation !== scope.confirmation) fail("INPUT_INVALID");
  try {
    return await runSerializableTransaction(database, async tx => {
      // The same lock is used by Retail prepare/start and the connection writer.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"retail-shared-stream-setup:v1"}))`;
      const ctx = await context(tx, { actorUserId, organisationId, now });
      if (ctx.blocked) throw ctx.blocked;
      const old = ctx.station?.streamConfig;
      if (!old || !isRetailPilotHostCorrectionTarget(organisationId, old, { allowCorrected: true }) ||
          !ciphertext(old.sourcePasswordEncrypted)) fail("HOST_CORRECTION_NOT_ALLOWED");
      // Reject even an expired/invalid or stopped control record: a previously
      // authorised output requires a separate lifecycle review, not this repair.
      const controls = await Promise.all(["control", "assignment"].map(kind => tx.auditLog.findUnique({
        where: { id: `retail-playout:${kind}:${ctx.station.id}` }, select: { id: true }
      })));
      if (controls.some(Boolean)) fail("HOST_CORRECTION_NOT_ALLOWED");
      const connection = { ...publicConnection(old), serverHost: scope.toHost };
      // Treat the known provider aliases/IP as the same destination when
      // checking inventory. This changes no stored record or other channel.
      const alias = host => [scope.fromHost, scope.toHost, "88.198.70.25"].includes(String(host).toLowerCase().replace(/\.$/, "")) ? scope.toHost : host;
      const inventory = { ...ctx, stations: ctx.stations.map(row => ({ ...row, streamConfig: row.streamConfig ?
        { ...row.streamConfig, serverHost: alias(row.streamConfig.serverHost) } : null })) };
      const plan = planFor(inventory, connection, true);
      checkStudioCollisions(ctx.destinations.map(row => ({ ...row, host: alias(row.host) })), plan.connection);
      if (old.serverHost === scope.toHost) return { saved: true, unchanged: true, setup: view(ctx, publicConnection(old)) };
      let report;
      try { report = await inspectSource?.(connection, { now }); } catch { fail("HOST_CORRECTION_DNS_UNAVAILABLE"); }
      if (report?.sourceDns !== "PUBLIC" || report.audioTested !== false || report.sourceCredential !== "NOT_TESTED") fail("HOST_CORRECTION_DNS_UNAVAILABLE");
      const updated = await tx.stationStreamConfig.updateMany({ where: {
        stationId: ctx.station.id, ...Object.fromEntries([...targetFields, "bitrateKbps"].map(key => [key, old[key] ?? null])),
        sourcePasswordEncrypted: old.sourcePasswordEncrypted, adminPasswordEncrypted: null,
        outboundAutoDjEnabled: false, probeEnabled: false, encoderLeaseOwner: null, encoderLeaseUntil: null,
        sourceConnectionStatus: "DISCONNECTED", lastConnectedAt: null, lastHeartbeatAt: null, lastProbeAt: null, lastError: null
      }, data: { serverHost: scope.toHost } });
      if (updated.count !== 1) fail("CONCURRENT_CHANGE");
      await tx.auditLog.create({ data: { organisationId, actorUserId, action: "RETAIL_SOURCE_HOST_CORRECTED", entityType: "Station", entityId: ctx.station.id,
        details: { fromHost: scope.fromHost, toHost: scope.toHost, providerTicket: scope.ticket,
          sourceCredentialChanged: false, portsChanged: false, outputEnabled: false, workerAllocated: false }, createdAt: now } });
      return { saved: true, unchanged: false, setup: view(ctx, connection) };
    });
  } catch (error) { throw safeError(error); }
}
