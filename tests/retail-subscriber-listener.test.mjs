import test from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_TESTER_PLAN, previewTesterOverrides } from "../lib/private-preview-account-policy.mjs";
import { RETAIL_PILOT_ACCESS as PILOT, changeRetailPilotAccess } from "../lib/retail-stream-pilot-access.mjs";
import { retailStreamStationSlug } from "../lib/retail-stream-setup-service.mjs";
import { RETAIL_SUBSCRIBER_STATION_ID as STATION } from "../lib/retail-subscriber-access.mjs";
import { RETAIL_PLAYOUT, retailSourceFingerprint, retailPlayoutFingerprint, retailProgrammeInput,
  signRetailPlayoutCommand, retailBudget } from "../lib/retail-stream-playout-policy.mjs";
import { loadRetailSubscriberListener } from "../lib/retail-subscriber-listener.mjs";
import { loadSubscriberAuthorizedRetailListener } from "../lib/retail-stream-playout-service.mjs";

const NOW = new Date("2026-11-07T14:00:00Z"), END = new Date("2026-11-23T12:00:00Z");
const ORG = PILOT.organisationId, USER = "retail-user", OWNER = "platform-owner", WORKER = "srv-retail-fixture";
const copy = structuredClone, controlKey = `retail-playout:control:${STATION}`, pilotKey = `retail-pilot-access:${STATION}`;

async function fixture() {
  const subscription = { id: "retail-subscription", organisationId: ORG, planId: "preview-plan", status: "TRIAL",
    currentPeriodEnd: END, billingContract: null, complimentaryAccessActive: false, schoolPublicPublishingEnabled: false,
    retailMediaEnabled: false, digitalSignageEnabled: false, ...previewTesterOverrides(["RETAIL"]), plan: copy(PREVIEW_TESTER_PLAN) };
  const organisation = { id: ORG, name: "Private Retail Test", enterpriseSecurityPolicy: null, subscription };
  const membership = { organisationId: ORG, role: "OWNER", organisation };
  const user = { id: USER, email: PILOT.email, role: "OWNER", memberships: [membership], privatePreviewAccess: {
    userId: USER, organisationId: ORG, subscriberTestingEnabled: true, enabled: true, passwordEnabled: true,
    expiresAt: END, pillars: ["RETAIL"] } };
  const session = { id: "retail-session", userId: USER, user, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: ORG,
    expiresAt: END, revokedAt: null };
  const context = { user, session, membership, memberships: [membership] };
  const source = { stationId: STATION, providerKey: "CENTOVA_CAST", outputCodec: "MP3", serverHost: PILOT.host,
    serverPort: PILOT.port, sourcePort: PILOT.port, centovaUsername: PILOT.account, sourceUsername: null,
    streamUrl: PILOT.listenerUrl, bitrateKbps: 128, sourcePasswordEncrypted: "SYNTHETIC_PRIVATE_CIPHERTEXT",
    outboundAutoDjEnabled: false, probeEnabled: false, encoderLeaseOwner: null, encoderLeaseUntil: null,
    sourceConnectionStatus: "DISCONNECTED", lastError: null };
  const station = { id: STATION, organisationId: ORG, name: "Test Retail", slug: retailStreamStationSlug(ORG),
    productFamily: "RETAIL", status: "DRAFT", publicPlayerEnabled: false, stationWebsiteEnabled: false,
    listenerRequestsEnabled: false, audiencePolicy: "INTERNAL", maxBitrateKbps: 128, organisation, streamConfig: source };
  const assignment = { organisationId: ORG, stationId: STATION, workerId: WORKER, slot: "one", monthlyBudgetUsd: 15.75,
    monthlyComputeUsd: 7, monthlyOtherReserveUsd: 0.75, bandwidthUsdPerGB: 0.15, maxBitrateKbps: 128 };
  const env = { SECRET_ENCRYPTION_KEY: "11".repeat(32), RUVANAS_RETAIL_PLAYOUT_ENABLED: "true",
    RUVANAS_RETAIL_CAPACITY: JSON.stringify([assignment]) };
  const state = { user: copy(user), ownerRole: "SUPER_ADMIN", memberCount: 1, station, audits: new Map(), channels: [{
    id: "retail-channel", name: "Shared Retail", organisationId: ORG, stationId: STATION,
    status: "DRAFT", musicRightsUse: "RETAIL_RADIO" }], reads: [], writes: [], allowFixtureWrites: true };
  const read = (name, value) => { state.reads.push(name); return copy(value); };
  const db = {
    user: { findUnique: async ({ where }) => read("user", where.email === PILOT.email ? state.user :
      where.id === OWNER ? { id: OWNER, role: state.ownerRole } : null) },
    organisationMember: { count: async () => read("members", state.memberCount) },
    station: {
      findFirst: async ({ where }) => { assert.deepEqual(where, { id: STATION, organisationId: ORG }); return read("workspace", state.station); },
      findUnique: async ({ where }) => { assert.equal(where.slug, retailStreamStationSlug(ORG)); return read("station", state.station); },
      findMany: async () => read("source-inventory", [state.station])
    },
    channel: { findMany: async ({ where }) => { assert.deepEqual(where, { stationId: STATION }); return read("channels", state.channels); } },
    mediaGenre: { findMany: async () => read("genres", [{ name: "Pop", slug: "pop", active: true, minimumCatalogueLevel: "FOCUSED" }]) },
    studioBroadcastDestination: { findMany: async () => read("destination-inventory", []) },
    track: { findMany: async () => {
      assert.equal(state.allowFixtureWrites, true, "Listener must not fetch track files or catalogue rows"); return [];
    } },
    auditLog: {
      findUnique: async ({ where }) => read(`audit:${where.id}`, state.audits.get(where.id) || null),
      create: async ({ data }) => {
        assert.equal(state.allowFixtureWrites, true, "Listener must not write audit history");
        const key = `history-${state.audits.size}`; state.audits.set(key, copy(data)); state.writes.push(key); return copy(data);
      },
      upsert: async ({ where, create, update }) => {
        assert.equal(state.allowFixtureWrites, true, "Listener must not write audits or allocate capacity");
        const row = state.audits.has(where.id) ? { ...state.audits.get(where.id), ...copy(update) } : copy(create);
        state.audits.set(where.id, row); state.writes.push(where.id); return copy(row);
      }
    },
    $transaction: async operation => { assert.equal(state.allowFixtureWrites, true, "Listener must not transact"); return operation(db); },
    $executeRaw: async () => { assert.equal(state.allowFixtureWrites, true, "Listener must not lock"); return 1; }
  };
  await changeRetailPilotAccess(db, { actorUserId: OWNER, organisationId: ORG, action: "approve", confirmed: true, now: NOW, env });
  const programme = { ...retailProgrammeInput({ territory: "MT", genreCodes: ["POP"] }), stationId: STATION,
    organisationId: ORG, preparedAt: NOW.toISOString(), preparedBy: OWNER };
  state.audits.set(`retail-playout:programme:${STATION}`, { details: programme });
  const command = { kind: RETAIL_PLAYOUT.kind, action: "START", id: "31400821-cc19-4c1d-bd7a-c723b8d35415", sequence: 1,
    organisationId: ORG, stationId: STATION, actorUserId: OWNER, issuedAt: NOW.toISOString(),
    sourceFingerprint: retailSourceFingerprint(source), programmeFingerprint: retailPlayoutFingerprint(programme),
    assignmentFingerprint: retailPlayoutFingerprint(assignment), workerId: WORKER, publicExposureAccepted: true,
    monthlyBudgetUsd: 15.75, bitrateKbps: 128, pilotAccessFingerprint: retailPlayoutFingerprint(state.audits.get(pilotKey).details.command) };
  state.audits.set(controlKey, { details: { command, signature: signRetailPlayoutCommand(command, env) } });
  state.allowFixtureWrites = false; state.reads = []; state.writes = [];
  const options = { now: NOW, env };
  return { state, db, context, env, options, assignment, command,
    listen: () => loadRetailSubscriberListener(db, context, options),
    resign: () => { state.audits.get(controlKey).details.signature = signRetailPlayoutCommand(command, env); } };
}

test("exact signed-in Retail pilot receives only its approved HTTPS listener with no source mutation", async () => {
  const f = await fixture(), before = copy({ station: f.state.station, audits: f.state.audits, user: f.state.user });
  assert.deepEqual(await f.listen(), { stationId: STATION, streamUrl: PILOT.listenerUrl });
  assert.deepEqual({ station: f.state.station, audits: f.state.audits, user: f.state.user }, before);
  assert.deepEqual(f.state.writes, []);
  assert.doesNotMatch(JSON.stringify(await f.listen()), /CIPHERTEXT|sourcePassword|workerId|track|token|signature|status|lease/i);
  // A stopped/missing observation is not invented into live audio evidence.
  assert.equal(f.state.station.streamConfig.sourceConnectionStatus, "DISCONNECTED");
});

test("unauthenticated, foreign, mismatched and expired contexts fail before database access", async () => {
  const mutations = [c => c.user.email = "radio@manuelchircop.com", c => c.session.activeOrganisationId = "foreign",
    c => c.session.userId = "other-user", c => c.user.id = "other-user", c => c.session.revokedAt = NOW,
    c => c.session.expiresAt = NOW, c => c.user.privatePreviewAccess.enabled = false,
    c => c.user.privatePreviewAccess.expiresAt = NOW, c => c.membership.role = "MANAGER",
    c => c.membership.organisationId = "foreign", c => c.memberships.push(copy(c.membership)),
    c => c.user.privatePreviewAccess.pillars = ["ONLINE"]];
  for (const mutate of mutations) {
    const f = await fixture(), context = copy(f.context); mutate(context);
    assert.equal(await loadRetailSubscriberListener(f.db, context, f.options), null, String(mutate));
    assert.deepEqual(f.state.reads, []); assert.deepEqual(f.state.writes, []);
  }
  assert.equal(await loadRetailSubscriberListener({}, null), null);
  const f = await fixture();
  assert.equal(await loadRetailSubscriberListener(f.db, f.context, { ...f.options, now: END }), null);
});

test("fresh pilot grant and subscription are rechecked rather than trusting the session", async () => {
  const mutations = [s => s.user.privatePreviewAccess.enabled = false, s => s.user.privatePreviewAccess.passwordEnabled = false,
    s => s.user.privatePreviewAccess.expiresAt = NOW, s => s.user.memberships[0].organisation.subscription.status = "CANCELLED",
    s => s.memberCount = 2, s => s.ownerRole = "OWNER", s => s.audits.delete(pilotKey),
    s => s.audits.get(pilotKey).details.signature = "00".repeat(32),
    s => s.audits.get(pilotKey).details.command.action = "REVOKE"];
  for (const mutate of mutations) { const f = await fixture(); mutate(f.state); assert.equal(await f.listen(), null, String(mutate)); assert.deepEqual(f.state.writes, []); }
});

test("station and channel identity, private flags and exact provider destination remain fenced", async () => {
  const mutations = [s => s.station.id = "foreign", s => s.station.organisationId = "foreign",
    s => s.station.productFamily = "ONLINE", s => s.station.status = "ACTIVE", s => s.station.publicPlayerEnabled = true,
    s => s.station.streamConfig.streamUrl = "https://other.example.com/stream",
    s => s.station.streamConfig.streamUrl += "?token=SYNTHETIC", s => s.station.streamConfig.sourcePort = 8282,
    s => s.station.streamConfig.sourcePasswordEncrypted = "changed-ciphertext",
    s => s.channels.push({ ...s.channels[0], id: "other" }), s => s.channels[0].organisationId = "foreign",
    s => s.channels[0].musicRightsUse = "ONLINE_RADIO"];
  for (const mutate of mutations) { const f = await fixture(); mutate(f.state); assert.equal(await f.listen(), null, String(mutate)); assert.deepEqual(f.state.writes, []); }
});

test("current signed start, owner consent and all bound fingerprints are required", async () => {
  for (const mutate of [c => c.action = "STOP", c => c.stationId = "foreign", c => c.organisationId = "foreign",
    c => c.actorUserId = USER, c => c.issuedAt = END.toISOString(), c => c.publicExposureAccepted = false,
    c => c.pilotAccessFingerprint = "00".repeat(32), c => c.sourceFingerprint = "00".repeat(32),
    c => c.programmeFingerprint = "00".repeat(32), c => c.assignmentFingerprint = "00".repeat(32),
    c => c.workerId = "other-worker", c => c.monthlyBudgetUsd = 1]) {
    const f = await fixture(); mutate(f.command); f.resign(); assert.equal(await f.listen(), null, String(mutate)); assert.deepEqual(f.state.writes, []);
  }
  const missing = await fixture(); missing.state.audits.delete(controlKey); assert.equal(await missing.listen(), null);
  const invalid = await fixture(); invalid.state.audits.get(controlKey).details.signature = "00".repeat(32); assert.equal(await invalid.listen(), null);
});

test("only pre-existing capacity and current budget headroom permit listening", async () => {
  for (const mutate of [f => f.env.RUVANAS_RETAIL_PLAYOUT_ENABLED = "false",
    f => f.env.RUVANAS_RETAIL_CAPACITY = "[]",
    f => f.env.RUVANAS_RETAIL_CAPACITY = JSON.stringify([{ ...f.assignment, monthlyBudgetUsd: 16 }])]) {
    const f = await fixture(); mutate(f); assert.equal(await f.listen(), null); assert.deepEqual(f.state.writes, []);
  }
  for (const details of [
    { chargedBytes: 1, bandwidthUsdPerGB: 0.10, computeReservedUsd: 7, otherReservedUsd: 0.75 },
    { chargedBytes: -1 },
    { chargedBytes: retailBudget((await fixture()).assignment, 128).maximumChargedBytes,
      bandwidthUsdPerGB: 0.15, computeReservedUsd: 7, otherReservedUsd: 0.75 }
  ]) {
    const f = await fixture(); f.state.audits.set(`retail-playout:budget:${STATION}:2026-11`, { details });
    assert.equal(await f.listen(), null); assert.deepEqual(f.state.writes, []);
  }
});

test("internal read-only wrapper also rejects a non-subscriber and ignores caller-supplied scope", async () => {
  const f = await fixture();
  await assert.rejects(loadSubscriberAuthorizedRetailListener(f.db, null, f.options), { code: "RETAIL_PLAYOUT_SUBSCRIBER_ACCESS_REQUIRED" });
  assert.deepEqual(f.state.reads, []);
  assert.deepEqual(await loadSubscriberAuthorizedRetailListener(f.db, f.context, {
    ...f.options, organisationId: "foreign", stationId: "other", workerId: "untrusted", actorUserId: OWNER
  }), { stationId: STATION, streamUrl: PILOT.listenerUrl });
  assert.deepEqual(f.state.writes, []);
});

test("unexpected database failures propagate without exposing source data", async () => {
  const f = await fixture(); f.db.station.findFirst = async () => { throw new Error("DATABASE_UNAVAILABLE"); };
  await assert.rejects(f.listen(), /DATABASE_UNAVAILABLE/); assert.deepEqual(f.state.writes, []);
});
