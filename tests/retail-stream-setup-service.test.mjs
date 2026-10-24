import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadRetailStreamSetup, saveRetailStreamSetup, correctRetailPilotSourceHost, retailStreamStationSlug, RetailStreamSetupError,
  retailStreamSetupMessage } from "../lib/retail-stream-setup-service.mjs";
import { RETAIL_PILOT_HOST_CORRECTION as HOST } from "../lib/retail-stream-host-correction.mjs";

const NOW = new Date("2026-10-24T09:00:00Z"), ORG = "org-retail-a", ADMIN = "admin-owner";
const CIPHER = `${"11".repeat(12)}:${"22".repeat(16)}:${"33".repeat(32)}`;
const clone = value => structuredClone(value);
const code = key => ({ code: `RETAIL_STREAM_SETUP_${key}` });
function connection() { return { providerKey: "CENTOVA_CAST", outputCodec: "MP3", streamUrl: "https://retail-a.example.com/stream",
  serverHost: "source.example.com", serverPort: 9000, sourcePort: 9002, centovaUsername: "retail_a", sourceUsername: "", bitrateKbps: 128 }; }
function station(overrides = {}) { return { id: "station-retail-a", organisationId: ORG, productFamily: "RETAIL", name: "Retail draft",
  slug: retailStreamStationSlug(ORG), status: "DRAFT", storageUsedMb: 0, listenerLimit: 100, storageLimitGb: 20, maxBitrateKbps: 128,
  publicPlayerEnabled: false, stationWebsiteEnabled: false, listenerRequestsEnabled: false, audiencePolicy: "INTERNAL", ...overrides }; }
function config(stationId = "station-retail-a", overrides = {}) { return { stationId, ...connection(), sourceUsername: null,
  sourcePasswordEncrypted: CIPHER, adminPasswordEncrypted: null, outboundAutoDjEnabled: false, probeEnabled: false,
  encoderLeaseOwner: null, encoderLeaseUntil: null, sourceConnectionStatus: "DISCONNECTED", lastConnectedAt: null,
  lastHeartbeatAt: null, lastProbeAt: null, lastError: null, ...overrides }; }
function match(row, where = {}) { return Object.entries(where).every(([key, value]) => row[key] === value); }
function project(row, select) {
  if (!row) return null;
  if (!select) return clone(row);
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key, value === true ? clone(row[key]) : project(row[key], value.select)]));
}
function fixture({ existing = false } = {}) {
  let tail = Promise.resolve(), next = 0;
  const data = { users: [{ id: ADMIN, role: "SUPER_ADMIN" }], organisations: [{ id: ORG, name: "A Retail organisation", subscription: {
    organisationId: ORG, status: "ACTIVE", currentPeriodEnd: new Date("2026-11-24T09:00:00Z"), billingContract: null,
    plan: { id: "plan-existing", code: "RETAIL_FOCUSED", active: true, stationLimit: 12, storageLimitGb: 20, listenerLimit: 100,
      maxBitrateKbps: 128, retailRadioEnabled: true, digitalSignageEnabled: true, licensedMusicCatalogueLevel: "FOCUSED" } } }],
  stations: existing ? [station()] : [], configs: existing ? [config()] : [], counts: {}, destinations: [], audits: [] };
  const state = { data, writes: [], queries: [], locks: [], failAt: null, rejectCas: false, transactionOptions: [] };
  function models(work, writes) {
    const expanded = row => row ? { ...clone(row), _count: { channels: 0, playoutEvents: 0, catalogueTests: 0, websiteDomains: 0, ...work.counts[row.id] },
      streamConfig: clone(work.configs.find(config => config.stationId === row.id) || null) } : null;
    const write = (model, args) => { if (state.failAt === model) throw new Error("INJECTED_PRIVATE_DATABASE_DIAGNOSTIC"); writes.push({ model, ...clone(args) }); };
    return {
      $executeRaw: async (strings, ...values) => { state.locks.push({ sql: strings.join("?"), values: clone(values) }); return 1; },
      user: { findUnique: async args => { state.queries.push({ model: "User", ...clone(args) }); return project(work.users.find(user => user.id === args.where.id), args.select); } },
      organisation: { findUnique: async args => { state.queries.push({ model: "Organisation", ...clone(args) }); return clone(work.organisations.find(org => org.id === args.where.id) || null); } },
      station: {
        findUnique: async args => { state.queries.push({ model: "Station.findUnique", ...clone(args) }); return project(expanded(work.stations.find(row => row.slug === args.where.slug)), args.select); },
        count: async args => { state.queries.push({ model: "Station.count", ...clone(args) }); return work.stations.filter(row => match(row, args.where)).length; },
        findMany: async args => { state.queries.push({ model: "Station.findMany", ...clone(args) });
          const scope = args.where.OR[1]; return work.stations.filter(row => work.configs.some(config => config.stationId === row.id) || row.organisationId === scope.organisationId && row.productFamily === scope.productFamily)
            .slice().sort((a, b) => a.id.localeCompare(b.id)).slice(0, args.take).map(row => project(expanded(row), args.select)); },
        create: async args => { write("Station", args); if (work.stations.some(row => row.slug === args.data.slug)) throw Object.assign(new Error("unique"), { code: "P2002" });
          const row = { id: `station-created-${++next}`, ...clone(args.data) }; work.stations.push(row); return project(row, args.select); },
        updateMany: async () => { assert.fail("Connection setup must never change existing station limits or state."); }
      },
      stationStreamConfig: {
        create: async args => { write("StationStreamConfig.create", args); assert.equal(work.configs.some(row => row.stationId === args.data.stationId), false);
          work.configs.push(clone(args.data)); return clone(args.data); },
        updateMany: async args => { if (state.rejectCas) return { count: 0 };
          const rows = work.configs.filter(row => match(row, args.where));
          if (rows.length) { write("StationStreamConfig.updateMany", args); rows.forEach(row => Object.assign(row, clone(args.data))); }
          return { count: rows.length }; }
      },
      studioBroadcastDestination: { findMany: async args => { state.queries.push({ model: "StudioBroadcastDestination", ...clone(args) });
        return work.destinations.slice().sort((a, b) => a.id.localeCompare(b.id)).slice(0, args.take).map(row => project(row, args.select)); } },
      auditLog: {
        findUnique: async args => project(work.audits.find(row => row.id === args.where.id), args.select),
        create: async args => { write("AuditLog", args); work.audits.push(clone(args.data)); return clone(args.data); }
      }
    };
  }
  const db = { $transaction(operation, options) {
    const run = tail.then(async () => { state.transactionOptions.push(clone(options));
      const work = clone(state.data), writes = [], result = await operation(models(work, writes));
      state.data = work; state.writes.push(...writes); return result;
    }); tail = run.catch(() => {}); return run;
  } };
  const options = { actorUserId: ADMIN, organisationId: ORG, now: NOW };
  const encrypted = [];
  const encryptSecret = value => { encrypted.push(value); return CIPHER; };
  return { db, state, options, encrypted, save: (input = { ...connection(), sourcePassword: "synthetic source password" }, extra = {}) =>
    saveRetailStreamSetup(db, { ...options, input, encryptSecret, ...extra }), load: () => loadRetailStreamSetup(db, options) };
}

test("load uses a fresh server role and plan, returns a blank draft without creating records or guessing bitrate", async () => {
  const f = fixture(), result = await f.load();
  assert.equal(result.canSaveDraft, true); assert.equal(result.connection, null); assert.equal(result.station, null);
  assert.deepEqual(result.organisation, { id: ORG, name: "A Retail organisation" });
  assert.equal(result.entitlements.streamLimit, 12); assert.equal(result.entitlements.digitalSignageDisplayLimit, 12);
  assert.equal(result.entitlements.siteLimit, null); assert.equal(result.entitlements.displayLimit, null);
  assert.equal(result.requiresPlanLimitReview, true); assert.equal(result.outputCount, 1);
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.locks.length, 0);
  assert.deepEqual(f.state.transactionOptions, [{ isolationLevel: "Serializable" }]);
  assert.equal(f.state.queries[0].model, "User");
});
test("first save preserves password bytes, encrypts before persistence and creates one explicit off/private Retail draft", async () => {
  const f = fixture(), password = " synthetic : ünicode password  ", result = await f.save({ ...connection(), sourcePassword: password });
  assert.deepEqual(f.encrypted, [password]); assert.equal(result.saved, true); assert.equal(result.unchanged, false);
  assert.equal(result.setup.connection.credentialConfigured, true); assert.equal(result.setup.station.status, "DRAFT");
  const s = f.state.data.stations[0], c = f.state.data.configs[0];
  assert.equal(s.slug, retailStreamStationSlug(ORG)); assert.equal(s.productFamily, "RETAIL"); assert.equal(s.storageUsedMb, 0);
  assert.deepEqual([s.listenerLimit, s.storageLimitGb, s.maxBitrateKbps], [100, 20, 128]);
  assert.equal(c.sourcePasswordEncrypted, CIPHER); assert.equal(c.adminPasswordEncrypted, null);
  for (const key of ["outboundAutoDjEnabled", "probeEnabled"]) assert.equal(c[key], false);
  for (const key of ["encoderLeaseOwner", "encoderLeaseUntil", "lastConnectedAt", "lastHeartbeatAt", "lastProbeAt", "lastError"]) assert.equal(c[key], null);
  assert.equal(c.sourceConnectionStatus, "DISCONNECTED");
  for (const key of ["publicPlayerEnabled", "stationWebsiteEnabled", "listenerRequestsEnabled"]) assert.equal(s[key], false);
  assert.equal(s.audiencePolicy, "INTERNAL");
  assert.deepEqual(f.state.locks[0], { sql: "SELECT pg_advisory_xact_lock(hashtext(?))", values: ["retail-shared-stream-setup:v1"] });
  assert.doesNotMatch(JSON.stringify(result), /sourcePassword|Encrypted|1111111111|2222222222|3333333333|synthetic :/);
  assert.doesNotMatch(JSON.stringify(f.state.data.audits), /https:|source\.example|retail_a|sourcePassword|Encrypted|synthetic/);
});
test("all returned states remain draft-only and unverified with no output capability", async () => {
  const f = fixture(), result = (await f.save()).setup;
  assert.equal(result.status, "DRAFT_CONFIGURATION_ONLY");
  for (const key of ["canStart", "outboundAutoDjEnabled", "probeEnabled", "publicPlayerEnabled", "stationWebsiteEnabled", "listenerRequestsEnabled", "activationAllowed", "provisioningAllowed", "workerAllocated", "enterpriseMultistreamEnabled"]) assert.equal(result[key], false, key);
  assert.ok(Object.values(result.verification).every(value => value === false));
  assert.match(result.warnings.join(" "), /not verified/);
});
test("omitted or blank password retries preserve the stored cipher and do not duplicate writes or audits", async () => {
  const f = fixture(); await f.save(); const before = clone(f.state.data), writes = f.state.writes.length;
  for (const input of [connection(), { ...connection(), sourcePassword: "" }]) {
    const again = await f.save(input); assert.equal(again.unchanged, true); assert.equal(again.setup.connection.credentialConfigured, true);
  }
  assert.deepEqual(f.state.data, before); assert.equal(f.state.writes.length, writes); assert.equal(f.encrypted.length, 1);
  const read = await f.load(); assert.equal(read.connection.credentialConfigured, true); assert.equal(read.connection.streamUrl, connection().streamUrl);
});
test("existing credentials and destination identity cannot be replaced through this onboarding path", async () => {
  const f = fixture({ existing: true }), before = clone(f.state.data);
  await assert.rejects(f.save({ ...connection(), sourcePassword: "replacement" }), code("CREDENTIAL_UPDATE_REQUIRES_REVIEW"));
  for (const change of [{ streamUrl: "https://different.example.com/stream" }, { serverHost: "different.example.com" }, { serverPort: 9001 },
    { sourcePort: 9003 }, { centovaUsername: "different" }, { sourceUsername: "source" }])
    await assert.rejects(f.save({ ...connection(), ...change }), code("TARGET_UPDATE_REQUIRES_REVIEW"));
  assert.deepEqual(f.state.data, before); assert.equal(f.encrypted.length, 0); assert.equal(f.state.writes.length, 0);
});
test("existing bitrate may change within fresh limits without touching any plan, station or credential values", async () => {
  const f = fixture({ existing: true }), beforeStation = clone(f.state.data.stations[0]), beforeOrg = clone(f.state.data.organisations);
  const result = await f.save({ ...connection(), bitrateKbps: 96 });
  assert.equal(result.setup.connection.bitrateKbps, 96); assert.equal(f.state.data.configs[0].sourcePasswordEncrypted, CIPHER);
  assert.deepEqual(f.state.data.stations[0], beforeStation); assert.deepEqual(f.state.data.organisations, beforeOrg);
  assert.deepEqual(f.state.writes.find(write => write.model === "StationStreamConfig.updateMany").data, { bitrateKbps: 96 });
  await assert.rejects(f.save({ ...connection(), bitrateKbps: 192 }), { code: "RETAIL_STREAM_BITRATE_NOT_ALLOWED" });
});
test("current actor role is rechecked and non-admin/deleted actors cannot read tenant setup or save", async () => {
  for (const role of ["OWNER", "MANAGER", "SUPPORT", null]) {
    const f = fixture(); f.state.data.users[0].role = role;
    await assert.rejects(f.load(), code("ADMIN_REQUIRED")); await assert.rejects(f.save(), code("ADMIN_REQUIRED"));
    assert.equal(f.state.queries.some(query => query.model === "Organisation"), false); assert.equal(f.state.writes.length, 0);
  }
  const f = fixture(); f.state.data.users = []; await assert.rejects(f.save(), code("ADMIN_REQUIRED"));
});
test("missing organisations, inactive service, unavailable Retail and missing plan limits fail closed", async () => {
  const missing = fixture(); missing.state.data.organisations = []; await assert.rejects(missing.load(), code("ORGANISATION_NOT_FOUND"));
  for (const mutate of [o => { o.subscription = null; }, o => { o.subscription.plan.active = false; }, o => { o.subscription.status = "CANCELLED"; }]) {
    const f = fixture(); mutate(f.state.data.organisations[0]); assert.equal((await f.load()).canSaveDraft, false);
    await assert.rejects(f.save(), error => error instanceof RetailStreamSetupError); assert.equal(f.state.writes.length, 0);
  }
  const notRetail = fixture(); notRetail.state.data.organisations[0].subscription.plan.retailRadioEnabled = false;
  await assert.rejects(notRetail.save(), code("RETAIL_NOT_INCLUDED"));
  for (const key of ["stationLimit", "listenerLimit", "storageLimitGb", "maxBitrateKbps"]) for (const value of [null, undefined, 0, "128", -1]) {
    const f = fixture(); f.state.data.organisations[0].subscription.plan[key] = value;
    await assert.rejects(f.save(), code("PLAN_LIMITS_REQUIRED")); assert.equal(f.state.writes.length, 0);
  }
});
test("stale existing station limits require review and are never reconciled automatically", async () => {
  const f = fixture({ existing: true }); f.state.data.organisations[0].subscription.plan.listenerLimit = 200;
  const before = clone(f.state.data), read = await f.load(); assert.equal(read.canSaveDraft, false); assert.equal(read.blockedReason, "RETAIL_STREAM_SETUP_PLAN_LIMITS_REQUIRED");
  await assert.rejects(f.save(connection()), code("PLAN_LIMITS_REQUIRED")); assert.deepEqual(f.state.data, before);
});

test("new drafts respect the fresh overall station allowance including other products with no connection", async () => {
  const f = fixture(); f.state.data.organisations[0].subscription.plan.stationLimit = 1;
  f.state.data.stations.push(station({ id: "existing-online", slug: "existing-online", productFamily: "ONLINE", status: "ACTIVE" }));
  const before = clone(f.state.data), result = await f.load();
  assert.equal(result.canSaveDraft, false); assert.equal(result.blockedReason, "RETAIL_STREAM_SETUP_STATION_LIMIT_REACHED");
  await assert.rejects(f.save(), code("STATION_LIMIT_REACHED"));
  assert.deepEqual(f.state.data, before); assert.equal(f.state.writes.length, 0); assert.equal(f.encrypted.length, 0);
  assert.deepEqual(f.state.queries.find(query => query.model === "Station.count").where, { organisationId: ORG });
});

test("an existing saved draft can be read and retried at its overall station limit without creating another", async () => {
  const f = fixture({ existing: true }); f.state.data.organisations[0].subscription.plan.stationLimit = 1;
  const before = clone(f.state.data), result = await f.load();
  assert.equal(result.canSaveDraft, true); assert.equal(result.station.id, "station-retail-a");
  const again = await f.save(connection()); assert.equal(again.unchanged, true);
  assert.deepEqual(f.state.data, before); assert.equal(f.state.writes.length, 0); assert.equal(f.encrypted.length, 0);
});
test("first credential is mandatory, opaque and bounded; unsafe inputs never reach encryption or persistence", async () => {
  for (const sourcePassword of [undefined, ""]) { const f = fixture(); await assert.rejects(f.save({ ...connection(), sourcePassword }), code("SOURCE_CREDENTIAL_REQUIRED")); assert.equal(f.encrypted.length, 0); }
  for (const sourcePassword of [null, 1, "x".repeat(1025), "line\nbreak", "zero\0byte"]) { const f = fixture(); await assert.rejects(f.save({ ...connection(), sourcePassword }), code("SOURCE_CREDENTIAL_INVALID")); }
  for (const extra of [{ organisationId: "other" }, { stationId: "other" }, { maxBitrateKbps: 320 }, { sourcePasswordEncrypted: "unsafe" }, { outboundAutoDjEnabled: true }, { probeEnabled: true }, { adminPassword: "unsafe" }, { requestedOutputCount: 2 }]) {
    const f = fixture(); await assert.rejects(f.save({ ...connection(), sourcePassword: "opaque", ...extra }), code("INPUT_INVALID")); assert.equal(f.state.writes.length, 0);
  }
});
test("only a pristine owned Retail draft without channels, historical activity, lease or destinations can be reused", async () => {
  const stationChanges = [{ status: "ACTIVE" }, { status: "PAUSED" }, { status: "PENDING_SETUP" }, { organisationId: "foreign" }, { productFamily: "ONLINE" },
    { publicPlayerEnabled: true }, { stationWebsiteEnabled: true }, { listenerRequestsEnabled: true }, { audiencePolicy: "PUBLIC" }, { storageUsedMb: 1 }];
  for (const change of stationChanges) { const f = fixture({ existing: true }); Object.assign(f.state.data.stations[0], change); const before = clone(f.state.data);
    await assert.rejects(f.save(connection()), code("PROFILE_REVIEW_REQUIRED")); assert.deepEqual(f.state.data, before); }
  for (const change of [{ outboundAutoDjEnabled: true }, { probeEnabled: true }, { encoderLeaseOwner: "worker" }, { encoderLeaseUntil: NOW },
    { sourceConnectionStatus: "CONNECTED" }, { lastError: "STOP_UNCONFIRMED" }, { lastConnectedAt: NOW }, { lastHeartbeatAt: NOW }, { lastProbeAt: NOW }, { adminPasswordEncrypted: CIPHER }]) {
    const f = fixture({ existing: true }); Object.assign(f.state.data.configs[0], change); await assert.rejects(f.save(connection()), code("PROFILE_REVIEW_REQUIRED")); }
  for (const count of ["channels", "playoutEvents", "catalogueTests", "websiteDomains"]) { const f = fixture({ existing: true }); f.state.data.counts["station-retail-a"] = { [count]: 1 }; await assert.rejects(f.save(connection()), code("PROFILE_REVIEW_REQUIRED")); }
  const withProfile = fixture({ existing: true }); withProfile.state.data.destinations.push({ id: "studio-profile", organisationId: ORG, stationId: "station-retail-a", type: "RUVANAS_MANAGED", host: null, port: null });
  await assert.rejects(withProfile.save(connection()), code("PROFILE_REVIEW_REQUIRED"));
});
test("another current Retail station blocks a second output and deterministic-slug collisions are never adopted", async () => {
  for (const status of ["DRAFT", "PENDING_SETUP", "ACTIVE", "PAUSED", "SUSPENDED", "UNKNOWN"]) {
    const f = fixture(); f.state.data.stations.push(station({ id: "other-retail", slug: "other-retail", status }));
    await assert.rejects(f.save(), code("PROFILE_REVIEW_REQUIRED")); assert.equal(f.state.writes.length, 0);
  }
  assert.equal(retailStreamStationSlug(ORG), retailStreamStationSlug(ORG)); assert.notEqual(retailStreamStationSlug(ORG), retailStreamStationSlug("org-b"));
});
test("global StationStreamConfig account/source collisions and ambiguous legacy ports require review", async () => {
  for (const overrides of [{ sourcePort: 9002, centovaUsername: "different" }, { sourcePort: 9999, centovaUsername: "RETAIL_A" }]) {
    const f = fixture(); f.state.data.stations.push(station({ id: "foreign", organisationId: "org-b", productFamily: "ONLINE", slug: "foreign" }));
    f.state.data.configs.push(config("foreign", { serverHost: "SOURCE.EXAMPLE.COM.", ...overrides }));
    await assert.rejects(f.save(), { code: "RETAIL_STREAM_SOURCE_ALREADY_ASSIGNED" });
  }
  const ambiguous = fixture(); ambiguous.state.data.stations.push(station({ id: "legacy", organisationId: "org-b", productFamily: "ONLINE", slug: "legacy" }));
  ambiguous.state.data.configs.push(config("legacy", { sourcePort: null })); await assert.rejects(ambiguous.save(), { code: "RETAIL_STREAM_EXISTING_OUTPUTS_INVALID" });
});
test("Studio destinations reserve their endpoint even when disabled or owned by another product", async () => {
  const f = fixture(); f.state.data.destinations.push({ id: "studio-foreign", organisationId: "org-b", stationId: null, type: "SHOUTCAST", host: "SOURCE.EXAMPLE.COM.", port: 9002, enabled: false });
  await assert.rejects(f.save(), code("SOURCE_ALREADY_ASSIGNED")); assert.equal(f.state.writes.length, 0);
  f.state.data.destinations[0].port = null; await assert.rejects(f.save(), code("INVENTORY_REVIEW_REQUIRED"));
});
test("Test Radio identities are refused and its unrelated live records remain byte-for-byte unchanged", async () => {
  const f = fixture(), protectedId = "cmvcnbwi20008hr23sd76psi8";
  const protectedStation = station({ id: protectedId, organisationId: "org-radio", productFamily: "ONLINE", status: "ACTIVE", slug: "test-radio" });
  const protectedConfig = config(protectedId, { serverHost: "pollux.shoutca.st", serverPort: 8282, sourcePort: 8282,
    centovaUsername: "ruvanastestradio", streamUrl: "https://ruvanastestradio-radio105network.radioca.st/stream", sourceConnectionStatus: "CONNECTED", encoderLeaseOwner: "existing-worker", encoderLeaseUntil: new Date("2026-10-24T09:01:00Z") });
  f.state.data.stations.push(clone(protectedStation)); f.state.data.configs.push(clone(protectedConfig));
  await assert.rejects(f.save({ ...connection(), sourcePassword: "opaque", serverHost: "pollux.shoutca.st", sourcePort: 8282 }), { code: "RETAIL_STREAM_TARGET_RESERVED" });
  await f.save(); assert.deepEqual(f.state.data.stations.find(row => row.id === protectedId), protectedStation);
  assert.deepEqual(f.state.data.configs.find(row => row.stationId === protectedId), protectedConfig);
  assert.ok(f.state.writes.every(write => write.where?.stationId !== protectedId && write.data?.stationId !== protectedId && write.data?.entityId !== protectedId));
});
test("serialised concurrent first saves create at most one draft and a credential-bearing uncertain retry needs review", async () => {
  const f = fixture(), results = await Promise.allSettled([f.save(), f.save()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "RETAIL_STREAM_SETUP_CREDENTIAL_UPDATE_REQUIRES_REVIEW");
  assert.equal(f.state.data.stations.length, 1); assert.equal(f.state.data.configs.length, 1); assert.equal(f.state.data.audits.length, 1);
});
test("encryption, audit, database and compare-and-set failures are sanitized and roll back the entire draft", async () => {
  for (const encryptSecret of [undefined, () => "plaintext", () => { throw new Error("PRIVATE_SOURCE_VALUE"); }, () => Promise.reject(new Error("PRIVATE_SOURCE_VALUE"))]) {
    const f = fixture(); await assert.rejects(f.save(undefined, { encryptSecret }), code("CREDENTIAL_ENCRYPTION_FAILED"));
    assert.equal(f.state.data.stations.length, 0); assert.equal(f.state.data.configs.length, 0); assert.equal(f.state.data.audits.length, 0);
  }
  for (const failAt of ["StationStreamConfig.create", "AuditLog"]) {
    const f = fixture(); f.state.failAt = failAt;
    await assert.rejects(f.save(), error => error instanceof RetailStreamSetupError && error.status === 503 && !error.message.includes("PRIVATE"));
    assert.equal(f.state.data.stations.length, 0); assert.equal(f.state.data.configs.length, 0); assert.equal(f.state.data.audits.length, 0);
  }
  const f = fixture({ existing: true }); f.state.rejectCas = true; await assert.rejects(f.save({ ...connection(), bitrateKbps: 96 }), code("CONCURRENT_CHANGE"));
  assert.equal(f.state.data.configs[0].bitrateKbps, 128); assert.equal(f.state.data.audits.length, 0);
});
test("read projections do not query global credentials or expose unsafe legacy URLs and fixed errors contain no diagnostics", async () => {
  const f = fixture({ existing: true }); f.state.data.configs[0].streamUrl = "https://user:PRIVATE_SOURCE_VALUE@retail.example.com/";
  const read = await f.load(); assert.equal(read.canSaveDraft, false); assert.equal(read.connection, null);
  assert.doesNotMatch(JSON.stringify(read), /PRIVATE_SOURCE_VALUE|sourcePassword|Encrypted|11111111|33333333/);
  const global = f.state.queries.find(query => query.model === "Station.findMany");
  assert.equal(Object.hasOwn(global.select.streamConfig.select, "sourcePasswordEncrypted"), false);
  assert.equal(Object.hasOwn(global.select.streamConfig.select, "adminPasswordEncrypted"), false);
  const error = new RetailStreamSetupError("not a known PRIVATE_SOURCE_VALUE"); assert.equal(error.status, 503);
  assert.equal(error.message, retailStreamSetupMessage(error.code)); assert.doesNotMatch(error.message, /PRIVATE/);
});
test("bounded inventories refuse overflow and the service imports no real database, environment or network clients", async () => {
  const f = fixture(); f.state.data.destinations = Array.from({ length: 2001 }, (_, i) => ({ id: `profile-${i}`, organisationId: "other", stationId: null, type: "RUVANAS_MANAGED", host: null, port: null }));
  await assert.rejects(f.save(), code("INVENTORY_REVIEW_REQUIRED")); assert.equal(f.state.writes.length, 0);
  const source = await readFile(new URL("../lib/retail-stream-setup-service.mjs", import.meta.url), "utf8");
  const forbidden = /\bprocess\s*\.|\bfetch\s*\(|new\s+PrismaClient|@prisma\/client|@aws-sdk|\bspawn\s*\(|node:(?:net|http|https|dns|fs)/;
  assert.equal(forbidden.test(source), false, "Service must use injected persistence and encryption only, never real external clients.");
});

function correctionFixture() {
  const f = fixture({ existing: true });
  f.state.data.organisations[0].id = HOST.organisationId;
  f.state.data.organisations[0].subscription.organisationId = HOST.organisationId;
  Object.assign(f.state.data.stations[0], { organisationId: HOST.organisationId, slug: retailStreamStationSlug(HOST.organisationId) });
  Object.assign(f.state.data.configs[0], { serverHost: HOST.fromHost, serverPort: HOST.port, sourcePort: HOST.port,
    centovaUsername: HOST.centovaUsername, streamUrl: HOST.streamUrl });
  const inspected = [];
  f.correct = (extra = {}) => correctRetailPilotSourceHost(f.db, { ...f.options, organisationId: HOST.organisationId,
    input: { expectedCurrentHost: HOST.fromHost, confirmation: HOST.confirmation },
    inspectSource: async source => { inspected.push(clone(source)); return { sourceDns: "PUBLIC", sourceCredential: "NOT_TESTED", audioTested: false }; }, ...extra });
  return { ...f, inspected };
}

test("confirmed pilot hostname correction changes only the host and keeps all other data and encrypted credentials intact", async () => {
  const f = correctionFixture();
  f.state.data.stations.push(station({ id: "cmvcnbwi20008hr23sd76psi8", organisationId: "org-radio", slug: "test-radio", productFamily: "ONLINE", status: "ACTIVE" }));
  f.state.data.configs.push(config("cmvcnbwi20008hr23sd76psi8", { serverHost: HOST.toHost, sourcePort: 8282, serverPort: 8282,
    centovaUsername: "ruvanastestradio", sourceConnectionStatus: "CONNECTED", encoderLeaseOwner: "test-radio-worker", encoderLeaseUntil: NOW }));
  const before = clone(f.state.data), result = await f.correct();
  assert.equal(result.saved, true); assert.equal(result.unchanged, false);
  assert.deepEqual(f.state.data.configs[0], { ...before.configs[0], serverHost: HOST.toHost });
  assert.deepEqual(f.state.data.configs[1], before.configs[1]);
  assert.deepEqual(f.state.data.stations, before.stations); assert.deepEqual(f.state.data.organisations, before.organisations);
  assert.deepEqual(f.encrypted, []); assert.equal(f.inspected.length, 1);
  assert.doesNotMatch(JSON.stringify(f.inspected), /Encrypted|11111111|22222222|33333333/);
  const write = f.state.writes.find(row => row.model === "StationStreamConfig.updateMany");
  assert.deepEqual(write.data, { serverHost: HOST.toHost });
  assert.equal(write.where.sourcePasswordEncrypted, CIPHER); assert.equal(write.where.serverHost, HOST.fromHost);
  assert.equal(write.where.sourcePort, 8330); assert.equal(write.where.serverPort, 8330);
  assert.equal(write.where.centovaUsername, HOST.centovaUsername); assert.equal(write.where.bitrateKbps, 128);
  assert.equal(f.state.data.audits[0].action, "RETAIL_SOURCE_HOST_CORRECTED");
  assert.deepEqual(f.state.data.audits[0].details, { fromHost: HOST.fromHost, toHost: HOST.toHost, providerTicket: "74460",
    sourceCredentialChanged: false, portsChanged: false, outputEnabled: false, workerAllocated: false });
  assert.doesNotMatch(JSON.stringify(result), /Encrypted|11111111|22222222|33333333/);
  const writes = f.state.writes.length; await f.correct();
  assert.equal(f.state.writes.length, writes); assert.equal(f.state.data.audits.length, 1); assert.equal(f.inspected.length, 1);
});

test("pilot correction rejects unrelated tenants, unsupported fields, target changes and missing confirmation", async () => {
  for (const input of [{ expectedCurrentHost: HOST.fromHost }, { expectedCurrentHost: HOST.toHost, confirmation: HOST.confirmation },
    { expectedCurrentHost: HOST.fromHost, confirmation: "" }, { expectedCurrentHost: HOST.fromHost, confirmation: HOST.confirmation, serverHost: "attacker.example.com" },
    { expectedCurrentHost: HOST.fromHost, confirmation: HOST.confirmation, sourcePassword: "replace" }]) {
    const f = correctionFixture(); await assert.rejects(f.correct({ input }), code("INPUT_INVALID")); assert.equal(f.state.writes.length, 0);
  }
  const other = fixture({ existing: true });
  await assert.rejects(correctRetailPilotSourceHost(other.db, { ...other.options,
    input: { expectedCurrentHost: HOST.fromHost, confirmation: HOST.confirmation } }), code("HOST_CORRECTION_NOT_ALLOWED"));
  for (const change of [{ serverHost: "elsewhere.example.com" }, { serverPort: 8282 }, { sourcePort: 8282 }, { centovaUsername: "ruvanastestradio" },
    { streamUrl: "https://different.example.com/stream" }, { sourceUsername: "someone" }, { sourcePasswordEncrypted: null }, { outputCodec: "AAC" }]) {
    const f = correctionFixture(); Object.assign(f.state.data.configs[0], change); const before = clone(f.state.data);
    await assert.rejects(f.correct(), code("HOST_CORRECTION_NOT_ALLOWED")); assert.deepEqual(f.state.data, before); assert.equal(f.inspected.length, 0);
  }
});

test("pilot correction rechecks current owner and rejects all live, leased, historical or authorised outputs", async () => {
  for (const role of ["OWNER", "SUPPORT", "ADMIN", null]) {
    const f = correctionFixture(); f.state.data.users[0].role = role;
    await assert.rejects(f.correct(), code("ADMIN_REQUIRED")); assert.equal(f.inspected.length, 0);
  }
  for (const stationChange of [{ status: "ACTIVE" }, { productFamily: "ONLINE" }, { publicPlayerEnabled: true }, { stationWebsiteEnabled: true }, { listenerRequestsEnabled: true }]) {
    const f = correctionFixture(); Object.assign(f.state.data.stations[0], stationChange);
    await assert.rejects(f.correct(), code("PROFILE_REVIEW_REQUIRED")); assert.equal(f.state.writes.length, 0);
  }
  for (const change of [{ outboundAutoDjEnabled: true }, { probeEnabled: true }, { encoderLeaseOwner: "worker" }, { encoderLeaseUntil: NOW },
    { sourceConnectionStatus: "CONNECTED" }, { lastHeartbeatAt: NOW }, { lastConnectedAt: NOW }, { lastError: "STOP_UNCONFIRMED" }]) {
    const f = correctionFixture(); Object.assign(f.state.data.configs[0], change);
    await assert.rejects(f.correct(), code("PROFILE_REVIEW_REQUIRED")); assert.equal(f.state.writes.length, 0);
  }
  for (const kind of ["control", "assignment"]) {
    const f = correctionFixture(); f.state.data.audits.push({ id: `retail-playout:${kind}:station-retail-a`, details: { command: { action: "START" } } });
    await assert.rejects(f.correct(), code("HOST_CORRECTION_NOT_ALLOWED")); assert.equal(f.state.writes.length, 0); assert.equal(f.inspected.length, 0);
  }
});

test("pilot correction rejects public-DNS failure, provider alias collisions, CAS races and audit failure atomically", async () => {
  for (const inspectSource of [undefined, async () => { throw new Error("PRIVATE_DIAGNOSTIC"); }, async () => ({ sourceDns: "REJECTED" }),
    async () => ({ sourceDns: "PUBLIC", sourceCredential: "TESTED", audioTested: true })]) {
    const f = correctionFixture(); await assert.rejects(f.correct({ inspectSource }), code("HOST_CORRECTION_DNS_UNAVAILABLE"));
    assert.equal(f.state.data.configs[0].serverHost, HOST.fromHost); assert.equal(f.state.writes.length, 0);
  }
  for (const host of [HOST.toHost, HOST.fromHost, "88.198.70.25"]) {
    const f = correctionFixture(); f.state.data.destinations.push({ id: "another-channel", organisationId: "other", stationId: null, type: "SHOUTCAST", host, port: HOST.port });
    await assert.rejects(f.correct(), code("SOURCE_ALREADY_ASSIGNED")); assert.equal(f.state.writes.length, 0);
    const stationCollision = correctionFixture();
    stationCollision.state.data.stations.push(station({ id: "other-stream", organisationId: "other", slug: "other-stream", productFamily: "ONLINE" }));
    stationCollision.state.data.configs.push(config("other-stream", { serverHost: host, sourcePort: HOST.port }));
    await assert.rejects(stationCollision.correct(), { code: "RETAIL_STREAM_SOURCE_ALREADY_ASSIGNED" });
    assert.equal(stationCollision.state.writes.length, 0);
  }
  for (const [setting, value, expected] of [["rejectCas", true, "CONCURRENT_CHANGE"], ["failAt", "AuditLog", "PERSISTENCE_UNAVAILABLE"]]) {
    const f = correctionFixture(), before = clone(f.state.data); f.state[setting] = value;
    await assert.rejects(f.correct(), code(expected)); assert.deepEqual(f.state.data, before); assert.equal(f.state.writes.length, 0);
  }
});
