import test from "node:test";
import assert from "node:assert/strict";
import { retailStreamStationSlug } from "../lib/retail-stream-setup-service.mjs";
import { inspectRetailSource } from "../lib/retail-stream-connection-check.mjs";
import { loadRetailPlayoutReadiness, prepareRetailPlayout, startRetailPlayout, stopRetailPlayout, loadAuthorizedRetailPlayout,
  claimRetailPlayoutLease, renewRetailPlayoutLease, releaseRetailPlayoutLease, reserveRetailPlayoutBytes,
  recordRetailPlayoutObservation, listRetailWorkerAssignments } from "../lib/retail-stream-playout-service.mjs";

const NOW = new Date("2026-10-24T14:00:00Z"), ORG = "retail-org-a", STATION = "retail-station-a", ADMIN = "owner-admin", WORKER = "srv-retail-pool";
const clone = value => structuredClone(value), reason = value => ({ code: `RETAIL_PLAYOUT_${value}` });
function match(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(item => match(row, item));
    if (key === "AND") return value.every(item => match(row, item));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("lt" in value) return row[key] != null && row[key] < value.lt;
      if ("gt" in value) return row[key] != null && row[key] > value.gt;
      if ("in" in value) return value.in.includes(row[key]);
      return match(row[key] || {}, value);
    }
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
  });
}
function track(id, overrides = {}) { return { id, title: `Track ${id}`, artist: "Artist", status: "READY", catalogueProvider: "RUVANAS",
  rightsReviewStatus: "APPROVED", permittedUses: ["RETAIL_RADIO"], permittedTerritories: "MT", minimumCatalogueLevel: "FOCUSED",
  licenceExpiresAt: new Date("2027-01-01T00:00:00Z"), distributorItems: [],
  mediaAsset: { id: `asset-${id}`, organisationId: null, libraryType: "RUVANAS_CATALOGUE", licensedCatalogue: true,
    status: "READY", mediaType: "MUSIC", storageKey: `catalogue/music/${Buffer.from(id).toString("hex").padEnd(64, "0").slice(0,64)}.mp3`, sizeBytes: 6000000n,
    checksumSha256: "ab".repeat(32), durationSeconds: 180, genres: [{ mediaGenre: { name: "Pop", slug: "pop", active: true } }] }, ...overrides }; }
function fixture() {
  const subscription = { status: "ACTIVE", currentPeriodEnd: new Date("2027-01-01T00:00:00Z"), billingContract: null,
    plan: { code: "RETAIL_FOCUSED", active: true, stationLimit: 2, maxBitrateKbps: 128, listenerLimit: 10, storageLimitGb: 1,
      retailRadioEnabled: true, licensedMusicCatalogueLevel: "FOCUSED", includesRuvanasCatalogue: true } };
  const state = { users: [{ id: ADMIN, role: "SUPER_ADMIN" }], stations: [{ id: STATION, organisationId: ORG,
    slug: retailStreamStationSlug(ORG), productFamily: "RETAIL", status: "DRAFT", publicPlayerEnabled: false,
    stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL", maxBitrateKbps: 128,
    organisation: { id: ORG, name: "Retail A", subscription } }], configs: [{ stationId: STATION, providerKey: "CENTOVA_CAST",
    serverHost: "source.example.com", serverPort: 8330, sourcePort: 8330, centovaUsername: "retail-a", sourceUsername: null,
    streamUrl: "https://listen.example.com/stream", bitrateKbps: 128, outputCodec: "MP3", sourcePasswordEncrypted: "synthetic-encrypted-secret",
    outboundAutoDjEnabled: false, probeEnabled: false, encoderLeaseOwner: null, encoderLeaseUntil: null,
    sourceConnectionStatus: "DISCONNECTED", lastError: null }], tracks: [track("one"), track("two")],
    genres: [{ name: "Pop", slug: "pop", active: true, minimumCatalogueLevel: "FOCUSED" }], audits: [], destinations: [], writes: [], queries: [], locks: [] };
  const assignment = { organisationId: ORG, stationId: STATION, workerId: WORKER, slot: "one", monthlyBudgetUsd: 15,
    monthlyComputeUsd: 7, monthlyOtherReserveUsd: 0.75, bandwidthUsdPerGB: 0.15, maxBitrateKbps: 128 };
  const env = { SECRET_ENCRYPTION_KEY: "11".repeat(32), RUVANAS_RETAIL_PLAYOUT_ENABLED: "true", RUVANAS_RETAIL_CAPACITY: JSON.stringify([assignment]) };
  function models(data) {
    const expanded = row => row ? { ...clone(row), streamConfig: clone(data.configs.find(item => item.stationId === row.id) || null) } : null;
    const log = (type, args) => { data.writes.push({ type, ...clone(args) }); };
    return {
      $executeRaw: async (strings, ...values) => { data.locks.push(values); return 1; },
      user: { findUnique: async args => clone(data.users.find(item => item.id === args.where.id) || null) },
      station: { findUnique: async args => expanded(data.stations.find(item => match(item, args.where))),
        findMany: async args => { data.queries.push({ type: "station.findMany", ...clone(args) }); return data.stations.map(expanded).slice(0, args.take); } },
      mediaGenre: { findMany: async () => clone(data.genres) },
      track: { findMany: async args => { data.queries.push({ type: "track.findMany", ...clone(args) }); return clone(data.tracks).slice(0, args.take); } },
      studioBroadcastDestination: { findMany: async args => clone(data.destinations).slice(0, args.take) },
      channel: { findMany: async () => [] },
      stationStreamConfig: { updateMany: async args => { const rows = data.configs.filter(item => match(item, args.where));
        if (rows.length) { log("config", args); rows.forEach(row => Object.assign(row, clone(args.data))); } return { count: rows.length }; } },
      auditLog: { findUnique: async args => clone(data.audits.find(row => row.id === args.where.id) || null),
        findMany: async args => clone(data.audits.filter(row => match(row, args.where))).slice(0, args.take),
        upsert: async args => { log("audit", args); let row = data.audits.find(item => item.id === args.where.id);
          if (row) Object.assign(row, clone(args.update)); else { row = clone(args.create); data.audits.push(row); } return clone(row); } }
    };
  }
  let tail = Promise.resolve();
  const db = models(state);
  db.$transaction = operation => { const result = tail.then(async () => {
    const copy = clone(state); const value = await operation(models(copy)); Object.assign(state, copy); return value;
  }); tail = result.catch(() => {}); return result; };
  const inspectSource = async () => ({ ready: true, sourceDns: "PUBLIC", listenerDns: "PUBLIC", checkedAt: NOW.toISOString(), sourceCredential: "NOT_TESTED", audioTested: false });
  const options = { actorUserId: ADMIN, organisationId: ORG, now: NOW, env, inspectSource };
  const scope = { organisationId: ORG, stationId: STATION, workerId: WORKER, now: NOW, env };
  return { db, state, env, assignment, options, scope,
    prepare: opts => prepareRetailPlayout(db, { ...options, territory: "MT", genreCodes: ["POP"], ...opts }),
    start: opts => startRetailPlayout(db, { ...options, monthlyBudgetUsd: 15, publicExposureAccepted: true, ...opts }),
    load: opts => loadRetailPlayoutReadiness(db, { ...options, ...opts }),
    stop: opts => stopRetailPlayout(db, { ...options, ...opts }) };
}
async function running(f) { await f.prepare(); const start = await f.start(); const lease = await claimRetailPlayoutLease(f.db, { ...f.scope, grantId: start.grantId });
  return { ...f.scope, grantId: start.grantId, leaseOwner: lease.leaseOwner }; }

test("programme preparation is audit-only and saved connection remains off with no new channel or encoder", async () => {
  const f = fixture(), original = clone(f.state.configs);
  const prepared = await f.prepare(); assert.equal(prepared.eligibleTrackCount, 2);
  assert.deepEqual(f.state.configs, original); assert.equal(f.state.stations[0].status, "DRAFT");
  assert.ok(f.state.writes.every(row => row.type === "audit"));
  const view = await f.load(); assert.equal(view.canStart, true); assert.equal(view.enabled, false);
  assert.equal(view.observation, null); assert.equal(view.connectionCheck.sourceCredential, "NOT_TESTED");
  assert.doesNotMatch(JSON.stringify(view), /synthetic-encrypted-secret|sourcePasswordEncrypted|SECRET_ENCRYPTION_KEY|workerId/);
});
test("missing capacity/live approval, preview service and missing music keep activation closed", async () => {
  const f = fixture(); await f.prepare();
  await assert.rejects(f.start({ env: {} }), reason("LIVE_DISABLED"));
  await assert.rejects(f.start({ env: { ...f.env, RUVANAS_RETAIL_CAPACITY: "[]" } }), reason("CAPACITY_NOT_ASSIGNED"));
  await assert.rejects(f.start({ publicExposureAccepted: false }), reason("PUBLIC_EXPOSURE_REQUIRED"));
  await assert.rejects(f.start({ monthlyBudgetUsd: 5 }), reason("BUDGET_APPROVAL_REQUIRED"));
  f.state.stations[0].organisation.subscription.plan.code = "PRIVATE_PREVIEW_RETAIL";
  await assert.rejects(f.start(), reason("OUTPUT_NOT_PERMITTED"));
  f.state.stations[0].organisation.subscription.plan.code = "RETAIL_FOCUSED";
  f.state.tracks[1].permittedUses = ["ONLINE_RADIO"];
  await assert.rejects(f.start(), reason("NO_APPROVED_MUSIC"));
  assert.equal(f.state.configs[0].encoderLeaseOwner, null);
});

test("stored Centova codec passes unchanged through the actual DNS adapter and unsupported audio is blocked", async () => {
  const f = fixture(); await f.prepare();
  const inspected = [];
  const inspectSource = (source, options) => {
    inspected.push(source.outputCodec);
    return inspectRetailSource(source, { ...options, lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }] });
  };
  const ready = await f.load({ inspectSource });
  assert.equal(ready.connectionCheck.ready, true);
  assert.equal(ready.canStart, true);
  assert.equal((await f.start({ inspectSource })).enabled, true);
  assert.deepEqual(inspected, ["MP3", "MP3"]);
  assert.equal(f.state.configs[0].outputCodec, "MP3");
  f.state.configs[0].outputCodec = "AAC";
  await assert.rejects(loadAuthorizedRetailPlayout(f.db, f.scope), reason("SOURCE_NOT_SUPPORTED"));
  assert.ok((await f.load({ inspectSource })).blockers.includes("RETAIL_PLAYOUT_SOURCE_NOT_SUPPORTED"));
});
test("fresh role, exact tenant, managed identity and existing Test Radio are enforced", async () => {
  const f = fixture();
  await assert.rejects(f.prepare({ stationId: "foreign-station" }), reason("STATION_REQUIRED"));
  await assert.rejects(f.prepare({ organisationId: "retail-org-b" }), reason("STATION_REQUIRED"));
  f.state.users[0].role = "OWNER";
  await assert.rejects(f.prepare(), reason("OWNER_REQUIRED"));
  f.state.users[0].role = "SUPER_ADMIN"; f.state.stations[0].id = "cmvcnbwi20008hr23sd76psi8";
  await assert.rejects(f.prepare(), reason("STATION_REQUIRED"));
  assert.equal(f.state.writes.length, 0);
});
test("Retail uses actual product, tenant, territory and provider checks rather than Test Radio exception", async () => {
  const f = fixture();
  f.state.tracks.push(track("online", { permittedUses: ["ONLINE_RADIO"] }), track("territory", { permittedTerritories: "GB" }),
    track("expired", { licenceExpiresAt: new Date("2020-01-01") }), track("promo", { catalogueProvider: "PROMO_ONLY", distributorItems: [] }),
    track("foreign", { mediaAsset: { ...track("foreign").mediaAsset, libraryType: "ORGANISATION_MUSIC", organisationId: "foreign-org" } }));
  assert.equal((await f.prepare()).eligibleTrackCount, 2);
  await f.start(); const loaded = await loadAuthorizedRetailPlayout(f.db, f.scope);
  assert.deepEqual(loaded.tracks.map(row => row.track.id), ["one", "two"]);
  assert.equal(loaded.programme.requiredUse, "RETAIL_RADIO");
});
test("readiness includes only central media the transport can play and deduplicates recordings", async () => {
  const f = fixture();
  f.state.tracks.push(track("bad-path", { mediaAsset: { ...track("bad-path").mediaAsset, storageKey: "catalogue/legacy.mp3" } }),
    track("too-large", { mediaAsset: { ...track("too-large").mediaAsset, sizeBytes: 51n * 1024n * 1024n } }),
    track("duplicate", { mediaAsset: { ...track("duplicate").mediaAsset, storageKey: f.state.tracks[0].mediaAsset.storageKey } }),
    track("same-asset", { mediaAsset: { ...track("same-asset").mediaAsset, id: f.state.tracks[0].mediaAsset.id } }),
    track("owned", { mediaAsset: { ...track("owned").mediaAsset, libraryType: "ORGANISATION_MUSIC", organisationId: ORG } }));
  assert.equal((await f.prepare()).eligibleTrackCount, 2);
  f.state.tracks[1].mediaAsset.storageKey = f.state.tracks[0].mediaAsset.storageKey;
  assert.equal((await f.prepare()).eligibleTrackCount, 1);
  await assert.rejects(f.start(), reason("NO_APPROVED_MUSIC"));
});
test("central core catalogue access and source protocol compatibility are checked before readiness", async () => {
  const f = fixture(); f.state.tracks.forEach(row => { row.mediaAsset.licensedCatalogue = false; });
  f.state.stations[0].organisation.subscription.plan.includesRuvanasCatalogue = false;
  assert.equal((await f.prepare()).eligibleTrackCount, 0);
  f.state.stations[0].organisation.subscription.plan.includesRuvanasCatalogue = true;
  await f.prepare(); f.state.configs[0].sourceUsername = "unsupported-source-user";
  assert.ok((await f.load()).blockers.includes("RETAIL_PLAYOUT_SOURCE_NOT_SUPPORTED"));
  await assert.rejects(f.start(), reason("SOURCE_NOT_SUPPORTED"));
});
test("DNS must pass before approval, and source cannot change during the check", async () => {
  const f = fixture(); await f.prepare();
  await assert.rejects(f.start({ inspectSource: async () => ({ ready: false }) }), reason("SOURCE_DNS_UNAVAILABLE"));
  await assert.rejects(f.start({ inspectSource: async () => { f.state.configs[0].sourcePort = 8331; return { ready: true }; } }), reason("SOURCE_CHANGED"));
  assert.equal(f.state.audits.some(row => row.action === "RETAIL_PLAYOUT_CONTROL"), false);
});
test("duplicate provider sources and multiple Retail streams are rejected without touching other stations", async () => {
  const f = fixture(); await f.prepare();
  f.state.destinations.push({ stationId: "another", host: "source.example.com", port: 8330 });
  await assert.rejects(f.start(), reason("SOURCE_ALREADY_ASSIGNED"));
  f.state.destinations = [];
  f.state.stations.push({ id: "second-retail", organisationId: ORG, productFamily: "RETAIL", status: "DRAFT" });
  await assert.rejects(f.start(), reason("MULTIPLE_STREAMS"));
});
test("live grant is signed and only the assigned worker can load the authorised tracks", async () => {
  const f = fixture(); await f.prepare(); const started = await f.start();
  const loaded = await loadAuthorizedRetailPlayout(f.db, { ...f.scope, expectedGrantId: started.grantId });
  assert.equal(loaded.grant.organisationId, ORG); assert.equal(loaded.assignment.workerId, WORKER);
  assert.equal(loaded.tracks.length, 2); assert.equal(loaded.source.sourcePasswordEncrypted, "synthetic-encrypted-secret");
  assert.equal(f.state.configs[0].outboundAutoDjEnabled, false); assert.equal(f.state.configs[0].sourceConnectionStatus, "DISCONNECTED");
  await assert.rejects(loadAuthorizedRetailPlayout(f.db, { ...f.scope, workerId: "another-worker" }), reason("CAPACITY_NOT_ASSIGNED"));
  await assert.rejects(loadAuthorizedRetailPlayout(f.db, { ...f.scope, organisationId: "foreign-org" }), reason("STATION_REQUIRED"));
  const audit = f.state.audits.find(row => row.action === "RETAIL_PLAYOUT_CONTROL"); audit.details.command.monthlyBudgetUsd = 999;
  await assert.rejects(loadAuthorizedRetailPlayout(f.db, f.scope), reason("NOT_ENABLED"));
});
test("replicas cannot share a lease; owner revocation immediately refuses renewal", async () => {
  const f = fixture(), current = await running(f);
  await assert.rejects(claimRetailPlayoutLease(f.db, { ...f.scope, grantId: current.grantId, instanceId: "new-instance-123" }), reason("WORKER_BUSY"));
  assert.equal(await renewRetailPlayoutLease(f.db, current), true);
  await assert.rejects(renewRetailPlayoutLease(f.db, { ...current, workerId: "foreign-worker" }), reason("WORKER_REQUIRED"));
  f.state.users[0].role = "OWNER";
  await assert.rejects(renewRetailPlayoutLease(f.db, current), reason("OWNER_REQUIRED"));
  assert.equal(await releaseRetailPlayoutLease(f.db, current), true);
  assert.equal(await releaseRetailPlayoutLease(f.db, current), false);
});
test("source, assignment and programme mutations revoke the grant; stopped source cannot continue", async () => {
  for (const [mutate, expected] of [
    [f => { f.state.configs[0].sourcePasswordEncrypted = "replacement"; }, "SOURCE_CHANGED"],
    [f => { f.env.RUVANAS_RETAIL_CAPACITY = JSON.stringify([{ ...f.assignment, slot: "two" }]); }, "CAPACITY_CHANGED"],
    [f => { f.state.audits.find(row => row.action === "RETAIL_PLAYOUT_PROGRAMME").details.preparedAt = "2026-01-01T00:00:00Z"; }, "PROGRAMME_CHANGED"]
  ]) { const f = fixture(), current = await running(f); mutate(f); await assert.rejects(renewRetailPlayoutLease(f.db, current), reason(expected)); }
  const f = fixture(), current = await running(f); await f.stop();
  await assert.rejects(reserveRetailPlayoutBytes(f.db, { ...current, bytes: 1024 }), reason("NOT_ENABLED"));
});
test("STOP stays available after entitlement expiry or lost encryption key", async () => {
  const f = fixture(), current = await running(f);
  f.state.stations[0].organisation.subscription.status = "CANCELLED"; delete f.env.SECRET_ENCRYPTION_KEY;
  assert.equal((await f.stop()).status, "STOP_REQUESTED");
  assert.equal(f.state.configs[0].encoderLeaseOwner, current.leaseOwner);
  assert.equal(await releaseRetailPlayoutLease(f.db, { ...current, stopConfirmed: false }), true);
  assert.equal(f.state.configs[0].lastError, "RETAIL_PLAYOUT_STOP_UNCONFIRMED");
});
test("durable monthly precharging survives stop/restart and prevents concurrent overspend", async () => {
  const f = fixture(), current = await running(f), bytes = 1000000;
  const reserved = await reserveRetailPlayoutBytes(f.db, { ...current, bytes }); assert.equal(reserved.reservedBytes, bytes);
  const first = clone(f.state.audits.find(row => row.action === "RETAIL_PLAYOUT_BUDGET")); assert.equal(first.details.chargedBytes, 1050000);
  await f.stop(); await releaseRetailPlayoutLease(f.db, current); const restarted = await f.start();
  const lease = await claimRetailPlayoutLease(f.db, { ...f.scope, grantId: restarted.grantId });
  const renewed = { ...f.scope, grantId: restarted.grantId, leaseOwner: lease.leaseOwner };
  await reserveRetailPlayoutBytes(f.db, { ...renewed, bytes });
  const budgetRow = f.state.audits.find(row => row.action === "RETAIL_PLAYOUT_BUDGET"); assert.equal(budgetRow.details.chargedBytes, 2100000);
  const view = await f.load(); budgetRow.details.chargedBytes = view.budget.maximumChargedBytes - 1050000;
  const results = await Promise.allSettled([reserveRetailPlayoutBytes(f.db, { ...renewed, bytes }), reserveRetailPlayoutBytes(f.db, { ...renewed, bytes })]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.find(item => item.status === "rejected").reason.code, "RETAIL_PLAYOUT_BUDGET_EXHAUSTED");
});
test("a changed per-GB rate cannot reprice the same month's charged traffic to create budget", async () => {
  const f = fixture(), current = await running(f);
  await reserveRetailPlayoutBytes(f.db, { ...current, bytes: 1000000 });
  await f.stop(); await releaseRetailPlayoutLease(f.db, current);
  f.env.RUVANAS_RETAIL_CAPACITY = JSON.stringify([{ ...f.assignment, bandwidthUsdPerGB: 0.1 }]);
  await assert.rejects(f.start(), reason("BUDGET_POLICY_CHANGED"));
  assert.ok((await f.load()).blockers.includes("RETAIL_PLAYOUT_BUDGET_POLICY_CHANGED"));
  assert.equal(f.state.audits.find(row => row.action === "RETAIL_PLAYOUT_BUDGET").details.chargedBytes, 1050000);
});
test("observations require real sent-byte evidence and a currently eligible track; no fake scheduled phase", async () => {
  const f = fixture(), current = await running(f);
  await assert.rejects(recordRetailPlayoutObservation(f.db, { ...current, state: "STREAMING", trackId: "one", audioBytesSent: 0 }), reason("AUDIO_UNCONFIRMED"));
  await recordRetailPlayoutObservation(f.db, { ...current, state: "STREAMING", trackId: "one", audioBytesSent: 2048,
    phase: "SCHEDULED", occurrenceId: "invented", scheduleRevision: "invented" });
  let view = await f.load(); assert.equal(view.observation.fresh, true); assert.equal(view.observation.phase, "UNKNOWN");
  await recordRetailPlayoutObservation(f.db, { ...current, state: "STREAMING", trackId: "one", audioBytesSent: 4096, phase: "RANDOM" });
  view = await f.load(); assert.equal(view.status, "STREAMING"); assert.equal(view.observation.phase, "RANDOM");
  f.state.tracks[0].permittedUses = ["ONLINE_RADIO"];
  await assert.rejects(recordRetailPlayoutObservation(f.db, { ...current, state: "STREAMING", trackId: "one", audioBytesSent: 4096, phase: "RANDOM" }), reason("NO_APPROVED_MUSIC"));
  view = await f.load({ now: new Date(NOW.getTime() + 16000) }); assert.equal(view.observation.fresh, false); assert.equal(view.observation.track, null);
});
test("approved pool offers a slot without writes, then assigns it atomically on owner start without creating a service", async () => {
  const f = fixture();
  const { organisationId: _org, stationId: _station, slot: _slot, ...pool } = f.assignment;
  delete f.env.RUVANAS_RETAIL_CAPACITY; f.env.RUVANAS_RETAIL_POOL = JSON.stringify([{ ...pool, slots: 1 }]);
  await f.prepare(); const before = f.state.writes.length;
  const view = await f.load(); assert.equal(view.canStart, true); assert.equal(f.state.writes.length, before);
  assert.deepEqual(await listRetailWorkerAssignments(f.db, { workerId: WORKER, env: f.env }), []);
  const started = await f.start();
  const assignments = await listRetailWorkerAssignments(f.db, { workerId: WORKER, env: f.env });
  assert.equal(assignments.length, 1); assert.equal(assignments[0].slot, "pool-1"); assert.equal(assignments[0].stationId, STATION);
  const loaded = await loadAuthorizedRetailPlayout(f.db, f.scope); assert.equal(loaded.grant.id, started.grantId);
  assert.equal(f.state.configs[0].encoderLeaseOwner, null);
  assert.equal(f.state.writes.every(row => row.type === "audit"), true);
  await f.stop(); assert.equal((await listRetailWorkerAssignments(f.db, { workerId: WORKER, env: f.env })).length, 1);
  await f.start(); assert.equal(f.state.audits.filter(row => row.action === "RETAIL_PLAYOUT_ASSIGNMENT").length, 1);
});
test("pool exhaustion and revoked pool terms do not silently allocate another slot or change grants", async () => {
  const f = fixture(); const { organisationId: _org, stationId: _station, slot: _slot, ...pool } = f.assignment;
  delete f.env.RUVANAS_RETAIL_CAPACITY; f.env.RUVANAS_RETAIL_POOL = JSON.stringify([{ ...pool, slots: 1 }]);
  await f.prepare(); await f.start();
  const otherOrg = "retail-org-b", otherStation = "retail-station-b";
  f.state.stations.push({ ...clone(f.state.stations[0]), id: otherStation, organisationId: otherOrg, slug: retailStreamStationSlug(otherOrg),
    organisation: { ...clone(f.state.stations[0].organisation), id: otherOrg } });
  f.state.configs.push({ ...clone(f.state.configs[0]), stationId: otherStation, sourcePort: 8332, serverPort: 8332,
    centovaUsername: "retail-b", streamUrl: "https://listen-b.example.com/stream" });
  await f.prepare({ organisationId: otherOrg });
  await assert.rejects(f.start({ organisationId: otherOrg }), reason("CAPACITY_FULL"));
  assert.ok((await f.load({ organisationId: otherOrg })).blockers.includes("RETAIL_PLAYOUT_CAPACITY_FULL"));
  f.env.RUVANAS_RETAIL_POOL = JSON.stringify([{ ...pool, slots: 1, monthlyComputeUsd: 6 }]);
  assert.deepEqual(await listRetailWorkerAssignments(f.db, { workerId: WORKER, env: f.env }), []);
  await assert.rejects(loadAuthorizedRetailPlayout(f.db, f.scope), reason("CAPACITY_CHANGED"));
  await assert.rejects(f.start({ organisationId: otherOrg }), reason("CAPACITY_FULL"));
});
test("concurrent new subscribers cannot take the same pool slot", async () => {
  const f = fixture(); const { organisationId: _org, stationId: _station, slot: _slot, ...pool } = f.assignment;
  delete f.env.RUVANAS_RETAIL_CAPACITY; f.env.RUVANAS_RETAIL_POOL = JSON.stringify([{ ...pool, slots: 1 }]);
  const otherOrg = "retail-org-b", otherStation = "retail-station-b";
  f.state.stations.push({ ...clone(f.state.stations[0]), id: otherStation, organisationId: otherOrg, slug: retailStreamStationSlug(otherOrg),
    organisation: { ...clone(f.state.stations[0].organisation), id: otherOrg } });
  f.state.configs.push({ ...clone(f.state.configs[0]), stationId: otherStation, sourcePort: 8332, serverPort: 8332,
    centovaUsername: "retail-b", streamUrl: "https://listen-b.example.com/stream" });
  await f.prepare(); await f.prepare({ organisationId: otherOrg });
  const results = await Promise.allSettled([f.start(), f.start({ organisationId: otherOrg })]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(results.find(row => row.status === "rejected").reason.code, "RETAIL_PLAYOUT_CAPACITY_FULL");
  assert.equal(f.state.audits.filter(row => row.action === "RETAIL_PLAYOUT_ASSIGNMENT").length, 1);
});
