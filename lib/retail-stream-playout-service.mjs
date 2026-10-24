import { randomUUID } from "node:crypto";
import { resolveEntitlements } from "./entitlements.mjs";
import { loadEligibleSubscriberMusic } from "./subscriber-playlist-service.mjs";
import { retailStreamStationSlug } from "./retail-stream-setup-service.mjs";
import { retailSharedStreamPlan } from "./retail-stream-onboarding.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { inspectRetailSource } from "./retail-stream-connection-check.mjs";
import { normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { loadRetailStreamSchedule } from "./retail-stream-schedule.mjs";
import { continuousObservedPhase } from "./test-radio-continuous-phase.mjs";
import { subscriberMediaIdentity, validateSubscriberStreamTarget } from "./subscriber-stream-transport.mjs";
import { RETAIL_PLAYOUT as P, RetailPlayoutError, retailPlayoutFail as fail, retailPlayoutId as validId,
  retailCapacityAssignments, retailCapacityPools, retailProgrammeInput, retailSourceFingerprint, retailPlayoutFingerprint,
  retailTrackFingerprint, signRetailPlayoutCommand, verifyRetailPlayoutCommand, retailBudgetMonth, retailBudget, retailChargedBytes } from "./retail-stream-playout-policy.mjs";

export { RetailPlayoutError, retailCapacityAssignments, retailCapacityPools };
const ENTITY = "RetailSharedPlayout";
const key = (kind, stationId, suffix = "") => `retail-playout:${kind}:${stationId}${suffix ? `:${suffix}` : ""}`;
const leasePrefix = stationId => `retail-playout:${stationId}:`;
const aliasHost = host => ["pollux.shoutcast.com", "pollux.shoutca.st", "88.198.70.25"].includes(String(host).toLowerCase()) ? "pollux.shoutca.st" : String(host || "").toLowerCase().replace(/\.$/, "");
const nonTerminal = row => !["CANCELLED", "ARCHIVED"].includes(row.status);
const sourceSelect = { stationId: true, providerKey: true, serverHost: true, sourcePort: true, centovaUsername: true, streamUrl: true };
const utc = now => { retailBudgetMonth(now); return now; };
function chargedUsage(usage, assignment) {
  const used = usage?.chargedBytes ?? 0;
  if (!Number.isSafeInteger(used) || used < 0) fail("BUDGET_INVALID");
  // A changed rate or fixed-cost allocation must not reprice earlier traffic
  // downward and manufacture budget headroom. A new month gets a fresh ledger.
  if (used > 0 && (usage.bandwidthUsdPerGB !== assignment.bandwidthUsdPerGB ||
      usage.computeReservedUsd !== assignment.monthlyComputeUsd || usage.otherReservedUsd !== assignment.monthlyOtherReserveUsd)) fail("BUDGET_POLICY_CHANGED");
  return used;
}
async function owner(db, actorUserId) {
  if (!validId(actorUserId)) fail("OWNER_REQUIRED", 403);
  if ((await db.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true } }))?.role !== "SUPER_ADMIN") fail("OWNER_REQUIRED", 403);
}
async function saved(db, kind, stationId, suffix) { return (await db.auditLog.findUnique({ where: { id: key(kind, stationId, suffix) } }))?.details || null; }
async function audit(tx, kind, station, details, actorUserId, now) {
  const data = { organisationId: station.organisationId, actorUserId: actorUserId || null, action: `RETAIL_PLAYOUT_${kind.toUpperCase()}`,
    entityType: ENTITY, entityId: station.id, details, createdAt: now };
  await tx.auditLog.upsert({ where: { id: key(kind, station.id) }, create: { id: key(kind, station.id), ...data }, update: data });
}
function assignmentFromPool(pool, organisationId, stationId, slot) {
  const { slots: _slots, ...costs } = pool; return { ...costs, organisationId, stationId, slot };
}
async function assignedCapacity(db, env) {
  const exact = retailCapacityAssignments(env), pools = retailCapacityPools(env);
  const records = pools.length ? await db.auditLog.findMany({ where: { action: "RETAIL_PLAYOUT_ASSIGNMENT", entityType: ENTITY }, take: 501 }) : [];
  if (records.length > 500) fail("CAPACITY_INVENTORY_TOO_LARGE");
  const assignments = [...exact], occupied = new Set(exact.map(row => `${row.workerId}:${row.slot}`));
  const stationIds = new Set(exact.map(row => row.stationId)), orgIds = new Set(exact.map(row => row.organisationId));
  for (const record of records) {
    const row = record.details?.assignment;
    if (!row || record.id !== key("assignment", row.stationId) || record.organisationId !== row.organisationId || record.entityId !== row.stationId) fail("CAPACITY_INVENTORY_INVALID");
    // Preserve malformed/revoked records as occupied rather than silently
    // reallocating a destination whose previous process may still be stopping.
    const pool = pools.find(item => item.workerId === row.workerId);
    const index = /^pool-([1-9][0-9]*)$/.exec(row.slot || "");
    if (!pool || !index || Number(index[1]) > pool.slots ||
        retailPlayoutFingerprint(row) !== retailPlayoutFingerprint(assignmentFromPool(pool, row.organisationId, row.stationId, row.slot))) continue;
    const slot = `${row.workerId}:${row.slot}`;
    if (occupied.has(slot) || stationIds.has(row.stationId) || orgIds.has(row.organisationId)) fail("CAPACITY_CONFLICT");
    occupied.add(slot); stationIds.add(row.stationId); orgIds.add(row.organisationId); assignments.push(row);
  }
  return { exact, pools, records, assignments, occupied };
}
async function capacityFor(db, { env, organisationId, stationId, workerId, preview = false, allocate = false, actorUserId, now }) {
  const inventory = await assignedCapacity(db, env);
  let assignment = inventory.assignments.find(row => row.organisationId === organisationId && row.stationId === stationId);
  if (assignment) {
    if (workerId !== undefined && assignment.workerId !== workerId) fail("CAPACITY_NOT_ASSIGNED");
    return assignment;
  }
  const prior = inventory.records.find(record => record.organisationId === organisationId || record.entityId === stationId);
  if (prior) fail("CAPACITY_CHANGED");
  if (inventory.assignments.some(row => row.organisationId === organisationId || row.stationId === stationId)) fail("CAPACITY_CONFLICT");
  if (!preview && !allocate) fail("CAPACITY_NOT_ASSIGNED");
  // Also reserve every retired assignment's physical slot. Operator review
  // must prove it stopped before a changed pool configuration may reuse it.
  for (const record of inventory.records) {
    const row = record.details?.assignment; if (row) inventory.occupied.add(`${row.workerId}:${row.slot}`);
  }
  for (const pool of inventory.pools) {
    if (workerId !== undefined && pool.workerId !== workerId) continue;
    for (let index = 1; index <= pool.slots; index++) {
      const slot = `pool-${index}`;
      if (!inventory.occupied.has(`${pool.workerId}:${slot}`)) {
        assignment = assignmentFromPool(pool, organisationId, stationId, slot); break;
      }
    }
    if (assignment) break;
  }
  if (!assignment) fail(inventory.pools.length ? "CAPACITY_FULL" : "CAPACITY_NOT_ASSIGNED");
  if (allocate) await audit(db, "assignment", { id: stationId, organisationId }, { assignment, assignedAt: now.toISOString() }, actorUserId, now);
  return assignment;
}
export async function listRetailWorkerAssignments(db, { workerId, env = process.env } = {}) {
  if (!validId(workerId)) fail("WORKER_REQUIRED", 403);
  return (await assignedCapacity(db, env)).assignments.filter(row => row.workerId === workerId);
}
async function stationContext(db, { organisationId, stationId, now }) {
  if (!validId(organisationId) || stationId !== undefined && !validId(stationId)) fail("SCOPE_INVALID", 400);
  const station = await db.station.findUnique({ where: { slug: retailStreamStationSlug(organisationId) },
    include: { streamConfig: true, organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } } } });
  if (!station || station.id === P.reservedStationId || station.organisationId !== organisationId || station.productFamily !== "RETAIL" ||
      station.slug !== retailStreamStationSlug(organisationId) || stationId !== undefined && station.id !== stationId) fail("STATION_REQUIRED");
  if (station.status !== "DRAFT" || station.publicPlayerEnabled !== false || station.stationWebsiteEnabled !== false ||
      station.listenerRequestsEnabled !== false || station.audiencePolicy !== "INTERNAL") fail("STATION_SCOPE_CHANGED");
  const entitlements = resolveEntitlements(station.organisation?.subscription, now);
  if (entitlements.serviceEnabled !== true || entitlements.retailRadioEnabled !== true) fail("SERVICE_INACTIVE");
  const configuredGenres = await db.mediaGenre.findMany({ where: { active: true }, select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 501 });
  if (configuredGenres.length > 500) fail("GENRE_INVENTORY_TOO_LARGE");
  return { station, source: station.streamConfig, entitlements, configuredGenres };
}
function sourceCheck(context) {
  const { source, station, entitlements } = context;
  if (!source || source.stationId !== station.id || source.outboundAutoDjEnabled !== false || source.probeEnabled !== false ||
      typeof source.sourcePasswordEncrypted !== "string" || !source.sourcePasswordEncrypted || source.sourcePort === 8282 ||
      source.lastError === "RETAIL_PLAYOUT_STOP_UNCONFIRMED") fail("SOURCE_NOT_READY");
  if (!Number.isInteger(station.maxBitrateKbps) || source.bitrateKbps > station.maxBitrateKbps) fail("BITRATE_NOT_ALLOWED");
  if (source.bitrateKbps !== 128) fail("BITRATE_NOT_SUPPORTED");
  try { validateSubscriberStreamTarget(source); } catch { fail("SOURCE_NOT_SUPPORTED"); }
  try { retailSharedStreamPlan({ organisationId: station.organisationId, entitlements, existingOutputs: [], connection: {
    stationId: station.id, organisationId: station.organisationId, productFamily: "RETAIL", providerKey: source.providerKey,
    outputCodec: source.outputCodec, streamUrl: source.streamUrl, serverHost: source.serverHost, serverPort: source.serverPort, sourcePort: source.sourcePort,
    sourceUsername: source.sourceUsername, centovaUsername: source.centovaUsername, bitrateKbps: source.bitrateKbps, credentialConfigured: true } });
  } catch { fail("SOURCE_INVALID"); }
}
async function collisions(db, context) {
  const { station, source } = context;
  const rows = await db.station.findMany({ where: { OR: [{ streamConfig: { isNot: null } }, { organisationId: station.organisationId, productFamily: "RETAIL" }] },
    select: { id: true, organisationId: true, productFamily: true, status: true, streamConfig: { select: sourceSelect } }, take: 2001 });
  const destinations = await db.studioBroadcastDestination.findMany({ select: { stationId: true, host: true, port: true }, take: 2001 });
  if (rows.length > 2000 || destinations.length > 2000) fail("INVENTORY_TOO_LARGE");
  for (const row of rows) {
    if (row.id === station.id) continue;
    if (row.organisationId === station.organisationId && row.productFamily === "RETAIL" && nonTerminal(row)) fail("MULTIPLE_STREAMS");
    const other = row.streamConfig;
    if (other?.providerKey === "CENTOVA_CAST" && (!other.serverHost || !Number.isInteger(other.sourcePort) || !other.centovaUsername)) fail("SOURCE_INVENTORY_UNVERIFIED");
    if (other && (other.streamUrl === source.streamUrl || aliasHost(other.serverHost) === aliasHost(source.serverHost) &&
        (other.sourcePort === source.sourcePort || String(other.centovaUsername || "").toLowerCase() === source.centovaUsername.toLowerCase()))) fail("SOURCE_ALREADY_ASSIGNED");
  }
  if (destinations.some(row => aliasHost(row.host) === aliasHost(source.serverHost) && row.port === source.sourcePort)) fail("SOURCE_ALREADY_ASSIGNED");
}
function programmeCheck(programme, context) {
  if (!programme || programme.stationId !== context.station.id || programme.organisationId !== context.station.organisationId) fail("PROGRAMME_REQUIRED");
  const input = retailProgrammeInput(programme);
  if (input.genreCodes.some(code => !context.configuredGenres.some(genre => normaliseGenreCode(genre.slug) === code))) fail("GENRE_UNAVAILABLE");
  return programme;
}
async function candidates(db, context, programme, now) {
  programmeCheck(programme, context);
  const scopes = [context.entitlements.includesRuvanasCatalogue ? "RUVANAS_CORE" : null,
    context.entitlements.licensedMusicCatalogueEnabled ? "LICENSED_CATALOGUE" : null].filter(Boolean);
  const rows = await loadEligibleSubscriberMusic(db, { organisationId: context.station.organisationId, requiredUse: "RETAIL_RADIO",
    territory: programme.territory, catalogueLevel: context.entitlements.licensedMusicCatalogueLevel,
    sourceScopes: scopes, instant: now, configuredGenres: context.configuredGenres });
  // A capped loader cannot certify a complete catalogue when it hits its limit.
  if (rows.length >= P.maximumCandidates) fail("CATALOGUE_TOO_LARGE");
  const assets = new Set(), recordings = new Set(), selected = [];
  for (const row of rows) {
    const asset = row.track.mediaAsset;
    if (programme.genreCodes.length && !row.genreCodes.some(code => programme.genreCodes.includes(code)) ||
        !Number.isFinite(Number(asset?.durationSeconds)) || Number(asset.durationSeconds) > 3600) continue;
    let identity; try { identity = subscriberMediaIdentity(asset); } catch { continue; }
    if (!validId(asset.id) || assets.has(asset.id) || recordings.has(identity.checksum)) continue;
    assets.add(asset.id); recordings.add(identity.checksum);
    selected.push({ track: row.track, fingerprint: retailTrackFingerprint(row.track), durationSeconds: Number(asset.durationSeconds) });
  }
  return selected;
}
function active(envelope, scope, now, env) {
  const grant = envelope?.command;
  if (!verifyRetailPlayoutCommand(envelope, env) || grant?.kind !== P.kind || grant.action !== "START" ||
      grant.stationId !== scope.station.id || grant.organisationId !== scope.station.organisationId ||
      grant.publicExposureAccepted !== true || !validId(grant.actorUserId) || !/^[a-f0-9-]{36}$/.test(grant.id || "") ||
      !Number.isSafeInteger(grant.sequence) || grant.sequence < 1 || !Number.isFinite(Date.parse(grant.issuedAt)) || Date.parse(grant.issuedAt) > now.getTime()) return null;
  return grant;
}
const leaseValid = (source, leaseOwner, stationId, now) => source?.encoderLeaseOwner === leaseOwner && typeof leaseOwner === "string" &&
  leaseOwner.startsWith(leasePrefix(stationId)) && source.encoderLeaseUntil instanceof Date && source.encoderLeaseUntil > now;
async function authorize(db, options, withTracks = true) {
  const { now, env, workerId, expectedGrantId } = options;
  if (env.RUVANAS_RETAIL_PLAYOUT_ENABLED !== "true") fail("LIVE_DISABLED");
  const context = await stationContext(db, options);
  sourceCheck(context); await collisions(db, context);
  if (context.entitlements.outputEnabled !== true) fail("OUTPUT_NOT_PERMITTED");
  const assignment = await capacityFor(db, { env, organisationId: context.station.organisationId, stationId: context.station.id, workerId });
  const grant = active(await saved(db, "control", context.station.id), context, now, env);
  if (!grant || expectedGrantId && grant.id !== expectedGrantId) fail("NOT_ENABLED");
  await owner(db, grant.actorUserId);
  const programme = programmeCheck(await saved(db, "programme", context.station.id), context);
  if (grant.sourceFingerprint !== retailSourceFingerprint(context.source)) fail("SOURCE_CHANGED");
  if (grant.assignmentFingerprint !== retailPlayoutFingerprint(assignment) || grant.workerId !== assignment.workerId || grant.monthlyBudgetUsd !== assignment.monthlyBudgetUsd) fail("CAPACITY_CHANGED");
  if (grant.programmeFingerprint !== retailPlayoutFingerprint(programme)) fail("PROGRAMME_CHANGED");
  if (context.source.bitrateKbps > assignment.maxBitrateKbps) fail("BITRATE_NOT_ALLOWED");
  const tracks = withTracks ? await candidates(db, context, programme, now) : undefined;
  if (withTracks && tracks.length < 2) fail("NO_APPROVED_MUSIC");
  return { ...context, grant, assignment, programme, ...(withTracks ? { tracks } : {}) };
}
export async function prepareRetailPlayout(db, { actorUserId, organisationId, stationId, territory, genreCodes, now = new Date(), env = process.env } = {}) {
  utc(now); const input = retailProgrammeInput({ territory, genreCodes });
  return runSerializableTransaction(db, async tx => {
    await owner(tx, actorUserId);
    const context = await stationContext(tx, { organisationId, stationId, now });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"retail-shared-stream-setup:v1"}))`;
    if (active(await saved(tx, "control", context.station.id), context, now, env) || context.source?.encoderLeaseOwner) fail("STOP_BEFORE_PREPARING");
    const programme = { ...input, stationId: context.station.id, organisationId, preparedAt: now.toISOString(), preparedBy: actorUserId };
    const tracks = await candidates(tx, context, programme, now);
    await audit(tx, "programme", context.station, programme, actorUserId, now);
    return { prepared: true, stationId: context.station.id, eligibleTrackCount: tracks.length };
  });
}
export async function loadRetailPlayoutReadiness(db, { actorUserId, organisationId, stationId, now = new Date(), env = process.env, inspectSource = inspectRetailSource } = {}) {
  utc(now); await owner(db, actorUserId);
  const context = await stationContext(db, { organisationId, stationId, now }), { station, source } = context;
  const blockers = [], add = code => { if (!blockers.includes(code)) blockers.push(code); };
  const capture = async operation => { try { return await operation(); } catch (error) { if (!(error instanceof RetailPlayoutError)) throw error; add(error.code); return null; } };
  const sourceValid = await capture(async () => { sourceCheck(context); await collisions(db, context); return true; });
  const programme = await saved(db, "programme", station.id), tracks = await capture(() => candidates(db, context, programme, now));
  if (tracks && tracks.length < 2) add("RETAIL_PLAYOUT_NO_APPROVED_MUSIC");
  if (context.entitlements.outputEnabled !== true) add("RETAIL_PLAYOUT_OUTPUT_NOT_PERMITTED");
  const assignment = await capture(() => capacityFor(db, { env, organisationId, stationId: station.id, preview: true }));
  if (assignment && source?.bitrateKbps > assignment.maxBitrateKbps) add("RETAIL_PLAYOUT_BITRATE_NOT_ALLOWED");
  if (env.RUVANAS_RETAIL_PLAYOUT_ENABLED !== "true") add("RETAIL_PLAYOUT_LIVE_DISABLED");
  await capture(async () => signRetailPlayoutCommand({ check: true }, env));
  let connectionCheck = null;
  if (sourceValid) {
    try { connectionCheck = await inspectSource(source, { now }); if (!connectionCheck?.ready) add("RETAIL_PLAYOUT_SOURCE_DNS_UNAVAILABLE"); }
    catch { add("RETAIL_PLAYOUT_SOURCE_DNS_UNAVAILABLE"); }
  }
  const envelope = await saved(db, "control", station.id), grant = active(envelope, context, now, env), enabled = Boolean(grant);
  if (enabled) await capture(() => authorize(db, { organisationId, stationId: station.id, now, env }, false));
  const observation = await saved(db, "observation", station.id), observedAt = Date.parse(observation?.observedAt || "");
  const fresh = Boolean(grant && observation?.grantId === grant.id && observation.leaseOwner === source?.encoderLeaseOwner &&
    leaseValid(source, observation.leaseOwner, station.id, now) && Number.isFinite(observedAt) && observedAt <= now.getTime() && now.getTime() - observedAt < P.observationFreshnessMs);
  const budget = assignment ? retailBudget(assignment, source?.bitrateKbps || 128) : null;
  if (budget && budget.estimatedMonthlyUsd > assignment.monthlyBudgetUsd) add("RETAIL_PLAYOUT_BUDGET_EXCEEDED");
  const usage = await saved(db, "budget", station.id, retailBudgetMonth(now));
  if (assignment) await capture(async () => chargedUsage(usage, assignment));
  if (budget && (usage?.chargedBytes || 0) >= budget.maximumChargedBytes) add("RETAIL_PLAYOUT_BUDGET_EXHAUSTED");
  const busy = source?.encoderLeaseOwner && source.encoderLeaseUntil instanceof Date && source.encoderLeaseUntil.getTime() + P.takeoverGraceSeconds * 1000 > now.getTime();
  if (!enabled && busy) add("RETAIL_PLAYOUT_WORKER_BUSY");
  return { organisation: { id: organisationId, name: station.organisation.name }, station: { id: station.id, status: station.status },
    connectionSaved: Boolean(source?.sourcePasswordEncrypted), prepared: programme ? { territory: programme.territory, genreCodes: programme.genreCodes, preparedAt: programme.preparedAt } : null,
    availableGenres: [...new Map(context.configuredGenres.map(row => [normaliseGenreCode(row.slug), { code: normaliseGenreCode(row.slug), name: row.name }])).values()], eligibleTrackCount: tracks?.length || 0,
    canPrepare: !enabled && !source?.encoderLeaseOwner, canStart: !enabled && blockers.length === 0, enabled, blockers,
    status: enabled ? blockers.length ? "NEEDS_ATTENTION" : fresh && observation?.state === "STREAMING" ? "STREAMING" : "WAITING_FOR_WORKER" : busy ? "STOPPING" : "STOPPED",
    capacity: { assigned: Boolean(assignment), monthlyBudgetUsd: assignment?.monthlyBudgetUsd ?? null, estimatedMonthlyUsd: budget?.estimatedMonthlyUsd ?? null,
      bitrateKbps: source?.bitrateKbps ?? null },
    budget: budget ? { ...budget, chargedBytes: usage?.chargedBytes || 0, monthKey: retailBudgetMonth(now) } : null,
    connectionCheck: connectionCheck ? { sourceDns: connectionCheck.sourceDns, listenerDns: connectionCheck.listenerDns,
      checkedAt: connectionCheck.checkedAt, sourceCredential: "NOT_TESTED", audioTested: false, ready: connectionCheck.ready } : null,
    observation: observation ? { state: observation.state, observedAt: observation.observedAt, fresh,
      track: fresh && observation.trackId ? { id: observation.trackId, title: observation.title, artist: observation.artist } : null,
      phase: fresh ? observation.phase : "UNKNOWN" } : null };
}
export async function startRetailPlayout(db, { actorUserId, organisationId, stationId, monthlyBudgetUsd, publicExposureAccepted,
  now = new Date(), env = process.env, inspectSource = inspectRetailSource } = {}) {
  utc(now); await owner(db, actorUserId);
  if (env.RUVANAS_RETAIL_PLAYOUT_ENABLED !== "true") fail("LIVE_DISABLED");
  if (publicExposureAccepted !== true) fail("PUBLIC_EXPOSURE_REQUIRED", 400);
  const inspected = await stationContext(db, { organisationId, stationId, now }); sourceCheck(inspected);
  let check; try { check = await inspectSource(inspected.source, { now }); } catch { fail("SOURCE_DNS_UNAVAILABLE"); }
  if (!check?.ready) fail("SOURCE_DNS_UNAVAILABLE");
  return runSerializableTransaction(db, async tx => {
    await owner(tx, actorUserId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"retail-shared-stream-setup:v1"}))`;
    const context = await stationContext(tx, { organisationId, stationId: inspected.station.id, now });
    sourceCheck(context); await collisions(tx, context);
    if (retailSourceFingerprint(inspected.source) !== retailSourceFingerprint(context.source)) fail("SOURCE_CHANGED");
    if (context.entitlements.outputEnabled !== true) fail("OUTPUT_NOT_PERMITTED");
    const assignment = await capacityFor(tx, { env, organisationId, stationId: context.station.id, preview: true });
    if (monthlyBudgetUsd !== assignment.monthlyBudgetUsd) fail("BUDGET_APPROVAL_REQUIRED", 400);
    if (context.source.bitrateKbps > assignment.maxBitrateKbps) fail("BITRATE_NOT_ALLOWED");
    const programme = programmeCheck(await saved(tx, "programme", context.station.id), context);
    if ((await candidates(tx, context, programme, now)).length < 2) fail("NO_APPROVED_MUSIC");
    const previous = await saved(tx, "control", context.station.id), existing = active(previous, context, now, env);
    if (existing) { await authorize(tx, { organisationId, stationId: context.station.id, now, env }, false); return { enabled: true, grantId: existing.id }; }
    const source = context.source;
    if (source.encoderLeaseOwner && source.encoderLeaseUntil instanceof Date && source.encoderLeaseUntil.getTime() + P.takeoverGraceSeconds * 1000 > now.getTime()) fail("WORKER_BUSY");
    const budget = retailBudget(assignment, source.bitrateKbps), usage = await saved(tx, "budget", context.station.id, retailBudgetMonth(now));
    if (budget.estimatedMonthlyUsd > assignment.monthlyBudgetUsd) fail("BUDGET_EXCEEDED");
    if (chargedUsage(usage, assignment) >= budget.maximumChargedBytes) fail("BUDGET_EXHAUSTED");
    const allocated = await capacityFor(tx, { env, organisationId, stationId: context.station.id, allocate: true, actorUserId, now });
    if (retailPlayoutFingerprint(allocated) !== retailPlayoutFingerprint(assignment)) fail("CAPACITY_CHANGED");
    const command = { kind: P.kind, action: "START", id: randomUUID(), sequence: (Number.isSafeInteger(previous?.command?.sequence) ? previous.command.sequence : 0) + 1,
      organisationId, stationId: context.station.id, actorUserId, issuedAt: now.toISOString(), sourceFingerprint: retailSourceFingerprint(source),
      programmeFingerprint: retailPlayoutFingerprint(programme), assignmentFingerprint: retailPlayoutFingerprint(assignment), workerId: assignment.workerId,
      publicExposureAccepted: true, monthlyBudgetUsd, bitrateKbps: source.bitrateKbps };
    await audit(tx, "control", context.station, { command, signature: signRetailPlayoutCommand(command, env) }, actorUserId, now);
    return { enabled: true, grantId: command.id };
  });
}
export async function stopRetailPlayout(db, { actorUserId, organisationId, stationId, now = new Date(), env = process.env } = {}) {
  utc(now);
  return runSerializableTransaction(db, async tx => {
    await owner(tx, actorUserId);
    // STOP needs no active subscription, source, programme, capacity or key.
    const station = await tx.station.findUnique({ where: { slug: retailStreamStationSlug(organisationId) } });
    if (!station || station.organisationId !== organisationId || station.productFamily !== "RETAIL" || station.id === P.reservedStationId || stationId && station.id !== stationId) fail("STATION_REQUIRED");
    const previous = await saved(tx, "control", station.id), command = { kind: P.kind, action: "STOP", id: randomUUID(),
      sequence: (Number.isSafeInteger(previous?.command?.sequence) ? previous.command.sequence : 0) + 1,
      organisationId, stationId: station.id, actorUserId, issuedAt: now.toISOString() };
    let signature = null; try { signature = signRetailPlayoutCommand(command, env); } catch { /* Revocation must not require a signing key. */ }
    await audit(tx, "control", station, { command, signature }, actorUserId, now);
    return { enabled: false, status: "STOP_REQUESTED" };
  });
}
export async function loadAuthorizedRetailPlayout(db, { now = new Date(), env = process.env, ...options } = {}) {
  utc(now); if (!validId(options.workerId)) fail("WORKER_REQUIRED", 403);
  return authorize(db, { ...options, now, env });
}
function runtimeScope(scope, grantId, leaseOwner) {
  if (!validId(scope.organisationId) || !validId(scope.stationId) || !validId(scope.workerId) || !grantId ||
      leaseOwner !== undefined && !String(leaseOwner).startsWith(`${leasePrefix(scope.stationId)}${scope.workerId}:`)) fail("WORKER_REQUIRED", 403);
}
export async function claimRetailPlayoutLease(db, { grantId, workerId, instanceId = randomUUID(), now = new Date(), env = process.env, ...scope } = {}) {
  utc(now); runtimeScope({ ...scope, workerId }, grantId);
  if (typeof instanceId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(instanceId)) fail("INSTANCE_INVALID", 400);
  return runSerializableTransaction(db, async tx => {
    const ctx = await authorize(tx, { ...scope, workerId, expectedGrantId: grantId, now, env }, false);
    const leaseOwner = `${leasePrefix(ctx.station.id)}${workerId}:${instanceId}`, leaseUntil = new Date(now.getTime() + P.leaseSeconds * 1000);
    const result = await tx.stationStreamConfig.updateMany({ where: { stationId: ctx.station.id, outboundAutoDjEnabled: false,
      OR: [{ encoderLeaseOwner: null }, { encoderLeaseUntil: { lt: new Date(now.getTime() - P.takeoverGraceSeconds * 1000) } }] },
      data: { encoderLeaseOwner: leaseOwner, encoderLeaseUntil: leaseUntil, lastHeartbeatAt: now } });
    if (result.count !== 1) fail("WORKER_BUSY");
    return { leaseOwner, leaseUntil };
  });
}
export async function renewRetailPlayoutLease(db, { grantId, leaseOwner, now = new Date(), env = process.env, ...scope } = {}) {
  utc(now); runtimeScope(scope, grantId, leaseOwner);
  return runSerializableTransaction(db, async tx => {
    const ctx = await authorize(tx, { ...scope, expectedGrantId: grantId, now, env }, false);
    if (!leaseValid(ctx.source, leaseOwner, ctx.station.id, now)) fail("LEASE_LOST");
    const result = await tx.stationStreamConfig.updateMany({ where: { stationId: ctx.station.id, encoderLeaseOwner: leaseOwner, encoderLeaseUntil: { gt: now }, outboundAutoDjEnabled: false },
      data: { encoderLeaseUntil: new Date(now.getTime() + P.leaseSeconds * 1000), lastHeartbeatAt: now } });
    if (result.count !== 1) fail("LEASE_LOST"); return true;
  });
}
export async function releaseRetailPlayoutLease(db, { organisationId, stationId, workerId, leaseOwner, now = new Date(), stopConfirmed = true } = {}) {
  utc(now);
  if (!validId(organisationId) || !validId(stationId) || stationId === P.reservedStationId || !validId(workerId) ||
      typeof leaseOwner !== "string" || !leaseOwner.startsWith(`${leasePrefix(stationId)}${workerId}:`)) fail("LEASE_LOST");
  const station = await db.station.findUnique({ where: { slug: retailStreamStationSlug(organisationId) } });
  if (!station || station.id !== stationId || station.organisationId !== organisationId || station.productFamily !== "RETAIL") fail("STATION_REQUIRED");
  const result = await db.stationStreamConfig.updateMany({ where: { stationId, encoderLeaseOwner: leaseOwner },
    data: stopConfirmed ? { encoderLeaseOwner: null, encoderLeaseUntil: null, sourceConnectionStatus: "DISCONNECTED", lastHeartbeatAt: now } :
      { lastError: "RETAIL_PLAYOUT_STOP_UNCONFIRMED", lastHeartbeatAt: now } });
  return result.count === 1;
}
export async function reserveRetailPlayoutBytes(db, { grantId, leaseOwner, bytes, now = new Date(), env = process.env, ...scope } = {}) {
  utc(now); runtimeScope(scope, grantId, leaseOwner); const charged = retailChargedBytes(bytes), monthKey = retailBudgetMonth(now);
  return runSerializableTransaction(db, async tx => {
    const ctx = await authorize(tx, { ...scope, expectedGrantId: grantId, now, env }, false);
    if (!leaseValid(ctx.source, leaseOwner, ctx.station.id, now)) fail("LEASE_LOST");
    const id = key("budget", ctx.station.id, monthKey), previous = await tx.auditLog.findUnique({ where: { id } });
    const used = chargedUsage(previous?.details, ctx.assignment), budget = retailBudget(ctx.assignment, ctx.source.bitrateKbps);
    if (!Number.isSafeInteger(used) || used < 0 || used + charged > budget.maximumChargedBytes) fail("BUDGET_EXHAUSTED");
    const details = { monthKey, chargedBytes: used + charged, monthlyBudgetUsd: ctx.assignment.monthlyBudgetUsd,
      computeReservedUsd: ctx.assignment.monthlyComputeUsd, otherReservedUsd: ctx.assignment.monthlyOtherReserveUsd,
      bandwidthUsdPerGB: ctx.assignment.bandwidthUsdPerGB, wireMultiplier: P.wireMultiplier, lastReservationAt: now.toISOString() };
    const data = { organisationId: ctx.station.organisationId, entityType: ENTITY, entityId: ctx.station.id, action: "RETAIL_PLAYOUT_BUDGET", details };
    await tx.auditLog.upsert({ where: { id }, create: { id, ...data }, update: data });
    return { reservedBytes: bytes, monthKey, remainingBytes: Math.floor((budget.maximumChargedBytes - used - charged) / P.wireMultiplier) };
  });
}
export async function recordRetailPlayoutObservation(db, { grantId, leaseOwner, state, trackId = null, audioBytesSent = 0,
  reasonCode = null, phase = "UNKNOWN", occurrenceId = null, scheduleRevision = null, presentationAt = null, sourceLatenessMs = null,
  now = new Date(), env = process.env, ...scope } = {}) {
  utc(now); runtimeScope(scope, grantId, leaseOwner);
  if (!["STARTING", "STREAMING", "DISCONNECTED", "ERROR"].includes(state) || !Number.isSafeInteger(audioBytesSent) || audioBytesSent < 0 ||
      reasonCode !== null && (state !== "ERROR" || !/^RETAIL_[A-Z_]{1,90}$/.test(reasonCode)) ||
      presentationAt !== null && (typeof presentationAt !== "string" || !Number.isFinite(Date.parse(presentationAt))) ||
      sourceLatenessMs !== null && (!Number.isFinite(sourceLatenessMs) || sourceLatenessMs < 0 || sourceLatenessMs > 3600000)) fail("OBSERVATION_INVALID", 400);
  return runSerializableTransaction(db, async tx => {
    const ctx = await authorize(tx, { ...scope, expectedGrantId: grantId, now, env }, state === "STREAMING");
    if (!leaseValid(ctx.source, leaseOwner, ctx.station.id, now)) fail("LEASE_LOST");
    const track = state === "STREAMING" ? ctx.tracks.find(row => row.track.id === trackId)?.track : null;
    if (state === "STREAMING" && (!track || audioBytesSent < 1)) fail("AUDIO_UNCONFIRMED");
    let phaseEvidence = { phase: "UNKNOWN", programme: null };
    if (state === "STREAMING" && phase === "RANDOM") phaseEvidence = continuousObservedPhase({ phase }, null);
    if (state === "STREAMING" && phase === "SCHEDULED") {
      try { const schedule = await loadRetailStreamSchedule(tx, { authorized: ctx, now });
        phaseEvidence = continuousObservedPhase({ phase, occurrenceId, scheduleRevision, trackId }, schedule);
      } catch { /* Unverifiable schedule labels never become source evidence. */ }
    }
    const details = { grantId, leaseOwner, state, trackId: track?.id || null, title: track?.title || null, artist: track?.artist || null,
      audioBytesSent, reasonCode, ...phaseEvidence, observedAt: now.toISOString(),
      presentationAt: presentationAt ? new Date(presentationAt).toISOString() : null, sourceLatenessMs };
    await audit(tx, "observation", ctx.station, details, null, now);
    await tx.stationStreamConfig.updateMany({ where: { stationId: ctx.station.id, encoderLeaseOwner: leaseOwner }, data: {
      sourceConnectionStatus: state === "STREAMING" ? "CONNECTED" : "DISCONNECTED", lastHeartbeatAt: now,
      ...(state === "STREAMING" ? { lastConnectedAt: now, lastError: null } : {}) } });
    return true;
  });
}
