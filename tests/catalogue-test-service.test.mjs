import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN } from "../lib/private-preview-account-policy.mjs";
import { TEST_RADIO_CATALOGUE_TEST as LIMITS } from "../lib/online-radio-catalogue-test.mjs";
import { catalogueTestSourceFingerprint, catalogueTestWorkerReady, catalogueTestOwnerSessionValid,
  inspectCatalogueTest, catalogueTestDashboard, prepareCatalogueTest, loadAuthorizedCatalogueTest,
  armCatalogueTest, stopCatalogueTest, safeCatalogueTestSession } from "../lib/catalogue-test-service.mjs";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const EARLIER = new Date("2026-10-20T12:00:00.000Z");
const ORG = "cmtestorganisation00001", OWNER = "cmtestowner00000000001", OWNER_SESSION = "cmownersession00000001";
const copy = (value) => structuredClone(value);

function source() {
  return { providerKey: "CENTOVA_CAST", serverHost: "pollux.shoutca.st", sourcePort: 8282,
    sourceUsername: null, centovaUsername: "ruvanastestradio", bitrateKbps: 128,
    streamUrl: "https://ruvanastestradio-radio105network.radioca.st/stream", outboundAutoDjEnabled: false,
    sourcePasswordEncrypted: "test-only-ciphertext-not-a-real-secret", encoderLeaseOwner: "catalogue-test:mock-worker",
    encoderLeaseUntil: new Date(NOW.getTime() + 45_000) };
}

function ownerSession() {
  return { id: OWNER_SESSION, userId: OWNER, user: { id: OWNER, role: "SUPER_ADMIN", email: "owner@example.test", privatePreviewAccess: {
    userId: OWNER, enabled: true, passwordEnabled: true, organisationId: null, expiresAt: null, pillars: [],
  } }, authMethod: "PREVIEW_PASSWORD", activeOrganisationId: null, activeOrganisation: null,
    createdAt: new Date(NOW.getTime() - 60_000), lastSeenAt: new Date(NOW.getTime() - 10_000),
    revokedAt: null, expiresAt: new Date(NOW.getTime() + 3_600_000) };
}

function sessionWithPolicy(overrides = {}, session = ownerSession()) {
  return { ...session, activeOrganisationId: ORG, activeOrganisation: { id: ORG,
    enterpriseSecurityPolicy: { organisationId: ORG, sessionMaxAgeMinutes: 60, idleTimeoutMinutes: 15,
      ssoRequired: false, passwordFallback: true, ...overrides } } };
}

function genre() {
  return { id: "cmtestgenrepop00000001", slug: "pop", name: "Pop", active: true,
    providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED" };
}

function track(index) {
  const mediaAssetId = `cmtestasset${String(index).padStart(10, "0")}`;
  return { id: `cmtesttrack${String(index).padStart(10, "0")}`, mediaAssetId, title: `Catalogue recording ${index}`,
    artist: `Artist ${index}`, status: "READY", catalogueProvider: null, minimumCatalogueLevel: "FOCUSED",
    rightsHolder: "Reviewed holder", rightsReference: "Reviewed direct catalogue permission", rightsBasis: "OTHER",
    rightsReviewStatus: "APPROVED", rightsReviewedAt: EARLIER, rightsReviewedById: OWNER,
    rightsConfirmedAt: EARLIER, rightsConfirmedById: OWNER, permittedTerritories: "MT", permittedUses: ["ONLINE_RADIO"],
    licenceStartsAt: null, licenceExpiresAt: new Date("2026-12-31T00:00:00.000Z"), updatedAt: EARLIER, distributorItems: [],
    mediaAsset: { id: mediaAssetId, organisationId: null, libraryType: "RUVANAS_CATALOGUE", mediaType: "MUSIC",
      status: "READY", licensedCatalogue: true, storageKey: `catalogue/music/${index.toString(16).padStart(64, "0")}.mp3`,
      sizeBytes: 1_000_000n, durationSeconds: 130, mimeType: "audio/mpeg", updatedAt: EARLIER,
      genres: [{ mediaGenre: genre() }] } };
}

function matches(row, where = {}) {
  for (const [key, expected] of Object.entries(where)) {
    if (key === "NOT") { if (matches(row, expected)) return false; continue; }
    if (key === "AND") { if (!expected.every((condition) => matches(row, condition))) return false; continue; }
    if (key === "OR") { if (!expected.some((condition) => matches(row, condition))) return false; continue; }
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("some" in expected) { if (!Array.isArray(row[key]) || !row[key].some((item) => matches(item, expected.some))) return false; continue; }
      if ("path" in expected) {
        const actual = expected.path.reduce((value, part) => value?.[part], row[key]);
        if ("equals" in expected && actual !== expected.equals) return false;
        continue;
      }
      if ("in" in expected && !expected.in.includes(row[key])) return false;
      if ("not" in expected && row[key] === expected.not) return false;
      continue;
    }
    if (row[key] !== expected) return false;
  }
  return true;
}

function ordered(rows, orderBy) {
  const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((left, right) => {
    for (const order of orders) for (const [key, direction] of Object.entries(order)) {
      const a = left[key] instanceof Date ? left[key].getTime() : left[key];
      const b = right[key] instanceof Date ? right[key].getTime() : right[key];
      const comparison = a < b ? -1 : a > b ? 1 : 0;
      if (comparison) return direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
}

function fixture() {
  const initial = {
    station: { id: LIMITS.stationId, organisationId: ORG, productFamily: "ONLINE", status: "DRAFT",
      publicPlayerEnabled: false, stationWebsiteEnabled: false, streamConfig: source(),
      organisation: { id: ORG, subscription: { organisationId: ORG, plan: copy(PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN),
        status: "TRIAL", onlineRadioEnabled: true, currentPeriodEnd: new Date("2026-11-18T12:00:00.000Z"), billingContract: null } } },
    genres: [genre()], tracks: [track(1), track(2), track(3)], ownerSessions: [ownerSession()], tests: [], audits: [],
  };
  const holder = { data: initial }, calls = { reads: [], writes: [], transactions: [] }, hooks = {};
  let nextId = 0, transactionTail = Promise.resolve();
  function database(readData) {
    const read = (model, method, args, value) => { calls.reads.push({ model, method, args: copy(args) }); return copy(value); };
    const db = {
      station: { async findUnique(args) { const data = readData(); return read("station", "findUnique", args, data.station?.id === args.where.id ? data.station : null); } },
      mediaGenre: { async findMany(args) { return read("mediaGenre", "findMany", args, readData().genres.filter((item) => args.where?.active !== true || item.active).slice(0, args.take)); } },
      track: { async findMany(args) { let rows = readData().tracks;
        if (args.where.id?.in) rows = rows.filter((item) => args.where.id.in.includes(item.id));
        if (args.where.status) rows = rows.filter((item) => item.status === args.where.status);
        if (args.where.mediaAsset) rows = rows.filter((item) => item.mediaAsset.libraryType === args.where.mediaAsset.libraryType && item.mediaAsset.organisationId === args.where.mediaAsset.organisationId);
        return read("track", "findMany", args, rows.slice(0, args.take)); } },
      session: { async findUnique(args) { return read("session", "findUnique", args, readData().ownerSessions.find((item) => item.id === args.where.id) || null); } },
      onlineRadioCatalogueTest: {
        async findFirst(args) { const rows = readData().tests.filter((row) => matches(row, args.where));
          return read("onlineRadioCatalogueTest", "findFirst", args, ordered(rows, args.orderBy)[0] || null); },
        async findUnique(args) { return read("onlineRadioCatalogueTest", "findUnique", args, readData().tests.find((row) => row.id === args.where.id) || null); },
        async create(args) { calls.writes.push({ model: "onlineRadioCatalogueTest", method: "create", args: copy(args) });
          const row = { id: `cmcataloguetest${String(++nextId).padStart(8, "0")}`, status: "PREPARED", createdAt: NOW, updatedAt: NOW,
            requestedAt: null, deadlineAt: null, publicExposureAcceptedAt: null, stopRequestedAt: null, startedAt: null,
            endedAt: null, endedReason: null, events: [], ...copy(args.data) };
          readData().tests.push(row); return copy(row); },
        async updateMany(args) { calls.writes.push({ model: "onlineRadioCatalogueTest", method: "updateMany", args: copy(args) });
          if (hooks.updateMany) { const replacement = await hooks.updateMany(args, readData()); if (replacement) return replacement; }
          let count = 0; for (const row of readData().tests) if (matches(row, args.where)) { Object.assign(row, copy(args.data)); count += 1; }
          return { count }; },
      },
      auditLog: { async create(args) { calls.writes.push({ model: "auditLog", method: "create", args: copy(args) });
        if (hooks.audit) await hooks.audit(args); readData().audits.push(copy(args.data)); return copy(args.data); } },
    };
    return db;
  }
  const db = database(() => holder.data);
  db.$transaction = async (operation, options) => {
    calls.transactions.push(copy(options));
    const before = transactionTail; let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await before;
    const draft = copy(holder.data);
    try { const result = await operation(database(() => draft)); holder.data = draft; return result; }
    finally { release(); }
  };
  return { db, calls, hooks, get data() { return holder.data; }, actor: copy(initial.ownerSessions[0]) };
}

const options = (f, additional = {}) => ({ actorSession: f.actor, now: NOW, ...additional });
async function prepared(f) { return prepareCatalogueTest(f.db, options(f)); }
async function armed(f) { const session = await prepared(f); await armCatalogueTest(f.db, options(f, {
  sessionId: session.id, startEnabled: true, publicExposureAccepted: true })); return session.id; }
async function rejected(promise, code) { await assert.rejects(promise, { code }); }

test("owner readiness inspection is SELECT-only and does not enable output or alter the tester subscription", async () => {
  const f = fixture(), before = copy(f.data);
  const result = await inspectCatalogueTest(f.db, options(f));
  assert.equal(LIMITS.stationId, "cmvcnbwi20008hr23sd76psi8");
  assert.equal(result.context.station.id, LIMITS.stationId);
  assert.equal(result.context.station.streamConfig.centovaUsername, "ruvanastestradio");
  assert.equal(result.plan.ready, true);
  assert.equal(result.sourceReady, true);
  assert.equal(result.workerReady, true);
  assert.equal(result.context.entitlements.outputEnabled, false);
  assert.equal(result.context.entitlements.licensedMusicCatalogueLevel, "NONE");
  assert.equal(result.context.entitlements.sandboxDraftOnly, true);
  assert.deepEqual(f.data, before);
  assert.equal(f.calls.writes.length, 0);
  assert.equal(f.calls.transactions.length, 0);
});

test("tester, revoked, expired, code-only and malformed sessions fail before any database read", async () => {
  for (const patch of [{ user: { id: OWNER, role: "OWNER" } }, { user: { id: OWNER, role: "ADMIN" } },
    { revokedAt: NOW }, { expiresAt: NOW }, { expiresAt: new Date(NaN) }, { userId: "cmotherowner000000001" },
    { authMethod: "PREVIEW_CODE" }, { authMethod: "PREVIEW_LOGIN_CODE" }, { authMethod: "UNKNOWN" }, { authMethod: undefined }]) {
    const f = fixture(), actorSession = { ...f.actor, ...patch };
    assert.equal(catalogueTestOwnerSessionValid(actorSession, actorSession.userId, NOW), false);
    await rejected(inspectCatalogueTest(f.db, options(f, { actorSession })), "TEST_OWNER_SESSION_REQUIRED");
    assert.equal(f.calls.reads.length, 0);
    assert.equal(f.calls.writes.length, 0);
  }
});

test("only the explicitly supported authenticated owner sign-in methods are accepted", () => {
  for (const authMethod of ["PASSWORD", "PREVIEW_PASSWORD", "SSO"]) {
    const session = ownerSession(); session.authMethod = authMethod;
    if (authMethod !== "PREVIEW_PASSWORD") session.user.privatePreviewAccess = null;
    assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW), true);
  }
  assert.equal(catalogueTestOwnerSessionValid(ownerSession(), "cmotherowner000000001", NOW), false);
});

test("preview password access must keep the exact enabled owner-only grant shape", async () => {
  for (const patch of [{ enabled: false }, { passwordEnabled: false }, { userId: "cmotherowner000000001" },
    { organisationId: ORG }, { expiresAt: NOW }, { expiresAt: new Date(NOW.getTime() + 3_600_000) },
    { pillars: ["ONLINE"] }, { pillars: undefined }, { organisationId: undefined }]) {
    const f = fixture(), session = copy(f.actor);
    Object.assign(session.user.privatePreviewAccess, patch);
    assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW), false);
    await rejected(inspectCatalogueTest(f.db, options(f, { actorSession: session })), "TEST_OWNER_SESSION_REQUIRED");
    assert.equal(f.calls.reads.length, 0);
  }
  const session = ownerSession(); session.user.privatePreviewAccess = null;
  assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW), false);
});

test("ordinary password and SSO methods cannot bypass an existing private preview access record", () => {
  for (const authMethod of ["PASSWORD", "SSO"]) {
    const session = ownerSession(); session.authMethod = authMethod;
    assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW), false);
    session.user.privatePreviewAccess.enabled = false;
    assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW), false);
  }
});

test("current preview environment policy and designated owner email are rechecked without ambient credentials", () => {
  const env = { NODE_ENV: "production", RUVANAS_ENVIRONMENT: "PRIVATE_PREVIEW",
    RUVANAS_PRIVATE_PREVIEW_ENABLED: "1", RUVANAS_PRIVATE_PREVIEW_PUBLIC_SITE: "1",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test", RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "owner@example.test",
    RUVANAS_PUBLIC_URL: "https://www.ruvanas.com", RUVANAS_PUBLIC_COMING_SOON_URL: "https://www.ruvanas.com/" };
  const session = ownerSession();
  assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW, env), true);
  const wrongEmail = copy(session); wrongEmail.user.email = "another@example.test";
  assert.equal(catalogueTestOwnerSessionValid(wrongEmail, OWNER, NOW, env), false);
  const changedOwner = { ...env, RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "another@example.test",
    RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "owner@example.test,another@example.test" };
  assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW, changedOwner), false);
  assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW, { ...env, RUVANAS_PRIVATE_PREVIEW_ENABLED: "true" }), false);
  assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW, { ...env, RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: "" }), false);
  for (const authMethod of ["PASSWORD", "SSO"]) {
    const ordinary = copy(session); ordinary.authMethod = authMethod; ordinary.user.privatePreviewAccess = null;
    assert.equal(catalogueTestOwnerSessionValid(ordinary, OWNER, NOW, env), false);
  }
  assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW, {}), true);
});

test("enterprise session maximum age and idle timeout are enforced at the exact expiry boundary", () => {
  const session = sessionWithPolicy();
  assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW), true);
  for (const [field, minutes] of [["createdAt", 60], ["lastSeenAt", 15]]) {
    const valid = copy(session); valid[field] = new Date(NOW.getTime() - minutes * 60_000 + 1);
    assert.equal(catalogueTestOwnerSessionValid(valid, OWNER, NOW), true);
    const expired = copy(session); expired[field] = new Date(NOW.getTime() - minutes * 60_000);
    assert.equal(catalogueTestOwnerSessionValid(expired, OWNER, NOW), false);
    expired[field] = new Date(expired[field].getTime() - 1);
    assert.equal(catalogueTestOwnerSessionValid(expired, OWNER, NOW), false);
  }
});

test("an unknown active organisation or malformed security policy cannot silently become policy-free", () => {
  for (const activeOrganisation of [undefined, null, { id: "cmotherorganisation001", enterpriseSecurityPolicy: null }, { id: ORG }]) {
    const session = ownerSession(); session.activeOrganisationId = ORG; session.activeOrganisation = activeOrganisation;
    assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW), false);
  }
  const knownNoPolicy = { ...ownerSession(), activeOrganisationId: ORG, activeOrganisation: { id: ORG, enterpriseSecurityPolicy: null } };
  assert.equal(catalogueTestOwnerSessionValid(knownNoPolicy, OWNER, NOW), true);
  for (const field of ["sessionMaxAgeMinutes", "idleTimeoutMinutes"]) {
    for (const value of [undefined, null, NaN, Infinity, "60", -1, 0]) {
      assert.equal(catalogueTestOwnerSessionValid(sessionWithPolicy({ [field]: value }), OWNER, NOW), false);
    }
  }
  for (const field of ["createdAt", "lastSeenAt"]) {
    for (const value of [undefined, null, new Date(NaN), NOW.toISOString()]) {
      const session = sessionWithPolicy(); session[field] = value;
      assert.equal(catalogueTestOwnerSessionValid(session, OWNER, NOW), false);
    }
  }
});

test("an SSO-only active organisation is not circumvented by the owner diagnostic", () => {
  const password = sessionWithPolicy({ ssoRequired: true, passwordFallback: false });
  assert.equal(catalogueTestOwnerSessionValid(password, OWNER, NOW), false);
  const sso = copy(password); sso.authMethod = "SSO"; sso.user.privatePreviewAccess = null;
  assert.equal(catalogueTestOwnerSessionValid(sso, OWNER, NOW), true);
  const fallback = sessionWithPolicy({ ssoRequired: true, passwordFallback: true });
  assert.equal(catalogueTestOwnerSessionValid(fallback, OWNER, NOW), true);
});

test("preparation persists only a private test and audit without audio, source writes, or ordinary entitlement changes", async () => {
  const f = fixture(), before = copy(f.data.station);
  const session = await prepared(f);
  assert.equal(session.status, "PREPARED");
  assert.equal(session.durationSeconds, 300);
  assert.equal(f.data.tests.length, 1);
  assert.equal(f.data.tests[0].authorization.actorSessionId, f.actor.id);
  assert.equal(f.data.tests[0].authorization.origin, LIMITS.origin);
  assert.equal(f.data.tests[0].authorization.catalogueLevel, "FOCUSED");
  assert.equal(f.data.tests[0].authorization.expiresAt, new Date(NOW.getTime() + 600_000).toISOString());
  assert.equal(f.data.audits[0].action, "ONLINE_RADIO_CATALOGUE_TEST_PREPARED");
  assert.equal(f.data.audits[0].details.audioStarted, false);
  assert.deepEqual(f.data.station, before);
  assert.deepEqual(f.calls.writes.map(({ model, method }) => `${model}.${method}`), ["onlineRadioCatalogueTest.create", "auditLog.create"]);
  assert.deepEqual(f.calls.transactions, [{ isolationLevel: "Serializable" }]);
  const dto = JSON.stringify(session);
  for (const value of ["catalogue/music/", "sourcePasswordEncrypted", "test-only-ciphertext", "fingerprint", "actorSessionId", "storageKey"]) assert.equal(dto.includes(value), false);
});

test("preparation refuses unavailable media, public Ruvanas exposure and a mismatched source without writes", async () => {
  for (const [change, code] of [
    [(f) => { f.data.tracks = []; }, "NO_RIGHTS_APPROVED_AUDIO"],
    [(f) => { f.data.tracks[0].catalogueProvider = "PROMO_ONLY"; f.data.tracks = [f.data.tracks[0]]; }, "NO_RIGHTS_APPROVED_AUDIO"],
    [(f) => { f.data.station.publicPlayerEnabled = true; }, "STATION_NOT_PRIVATE"],
    [(f) => { f.data.station.stationWebsiteEnabled = true; }, "STATION_NOT_PRIVATE"],
    [(f) => { f.data.station.streamConfig.sourcePort = 8198; }, "TEST_SOURCE_NOT_READY"],
    [(f) => { f.data.station.streamConfig.outboundAutoDjEnabled = true; }, "TEST_SOURCE_NOT_READY"],
  ]) {
    const f = fixture(); change(f);
    await rejected(prepared(f), code);
    assert.equal(f.calls.writes.length, 0);
  }
});

test("preparation cannot replace an already armed or running station test", async () => {
  for (const status of ["ARMED", "RUNNING"]) {
    const f = fixture(); f.data.tests.push({ id: "cmexistingtest00000001", stationId: LIMITS.stationId, status });
    await rejected(prepared(f), "TEST_ALREADY_ACTIVE");
    assert.equal(f.data.tests.length, 1);
    assert.equal(f.calls.writes.length, 0);
  }
});

test("arming is off by default and explicit public-stream exposure confirmation is mandatory", async () => {
  const f = fixture(), session = await prepared(f);
  f.calls.reads.length = 0; f.calls.writes.length = 0;
  await rejected(armCatalogueTest(f.db, options(f, { sessionId: session.id, publicExposureAccepted: true })), "TEST_START_NOT_ENABLED");
  await rejected(armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true })), "TEST_PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED");
  await rejected(armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true, publicExposureAccepted: "true" })), "TEST_PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED");
  assert.equal(f.calls.reads.length, 0);
  assert.equal(f.calls.writes.length, 0);
  assert.equal(f.data.tests[0].status, "PREPARED");
});

test("worker readiness requires this dedicated fresh lease with normal outbound still off", () => {
  assert.equal(catalogueTestWorkerReady(source(), NOW), true);
  for (const patch of [{ outboundAutoDjEnabled: true }, { encoderLeaseOwner: null }, { encoderLeaseOwner: "normal-live-worker" },
    { encoderLeaseUntil: NOW }, { encoderLeaseUntil: new Date(NaN) }, { encoderLeaseUntil: "2099-01-01" }]) {
    assert.equal(catalogueTestWorkerReady({ ...source(), ...patch }, NOW), false);
  }
});

test("a missing, stale or foreign worker lease prevents arming, while prepare remains harmless", async () => {
  for (const patch of [{ encoderLeaseOwner: null }, { encoderLeaseOwner: "normal-live-worker" }, { encoderLeaseUntil: NOW }]) {
    const f = fixture(); Object.assign(f.data.station.streamConfig, patch);
    const session = await prepared(f);
    await rejected(armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true, publicExposureAccepted: true })), "TEST_WORKER_NOT_READY");
    assert.equal(f.data.tests[0].status, "PREPARED");
  }
});

test("arming pins a five-minute absolute deadline without claiming source authentication or playback", async () => {
  const f = fixture(), before = copy(f.data.station), session = await prepared(f);
  const result = await armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true, publicExposureAccepted: true }));
  assert.equal(result.status, "ARMED");
  assert.equal(result.deadlineAt.toISOString(), "2026-10-21T12:05:00.000Z");
  assert.equal(f.data.tests[0].status, "ARMED");
  assert.equal(f.data.tests[0].publicExposureAcceptedAt.getTime(), NOW.getTime());
  assert.equal(f.data.tests[0].startedAt, null);
  assert.equal(f.data.tests[0].events.length, 0);
  assert.equal(f.data.audits.at(-1).action, "ONLINE_RADIO_CATALOGUE_TEST_ARMED");
  assert.deepEqual(f.data.station, before);
});

test("the same prepared session cannot be armed twice under concurrent requests", async () => {
  const f = fixture(), session = await prepared(f);
  const calls = Array.from({ length: 2 }, () => armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true, publicExposureAccepted: true })));
  const results = await Promise.allSettled(calls);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(f.data.tests.filter(({ status }) => status === "ARMED").length, 1);
  assert.equal(f.data.audits.filter(({ action }) => action === "ONLINE_RADIO_CATALOGUE_TEST_ARMED").length, 1);
});

test("two different prepared sessions cannot both arm for the same station", async () => {
  const f = fixture(), first = await prepared(f), second = await prepared(f);
  const results = await Promise.allSettled([first, second].map(({ id }) => armCatalogueTest(f.db, options(f, {
    sessionId: id, startEnabled: true, publicExposureAccepted: true }))));
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(f.data.tests.filter(({ status }) => ["ARMED", "RUNNING"].includes(status)).length, 1);
});

test("failed compare-and-swap arming cannot return success or persist a misleading audit", async () => {
  const f = fixture(), session = await prepared(f), beforeAudits = f.data.audits.length;
  f.hooks.updateMany = () => ({ count: 0 });
  await rejected(armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true, publicExposureAccepted: true })), "TEST_ALREADY_ACTIVE");
  assert.equal(f.data.tests[0].status, "PREPARED");
  assert.equal(f.data.audits.length, beforeAudits);
  const update = f.calls.writes.find(({ method }) => method === "updateMany");
  assert.deepEqual(update.args.where, { id: session.id, status: "PREPARED", stopRequestedAt: null });
});

test("the original creating owner and authenticated session remain bound at arm time", async () => {
  const f = fixture(), session = await prepared(f);
  const other = { ...ownerSession(), id: "cmotherownersession001" }; f.data.ownerSessions.push(copy(other));
  await rejected(armCatalogueTest(f.db, options(f, { actorSession: other, sessionId: session.id,
    startEnabled: true, publicExposureAccepted: true })), "TEST_AUTHORIZATION_INACTIVE");
  assert.equal(f.data.tests[0].status, "PREPARED");
});

test("authorized worker loads the fixed approved plan, not a replacement selection or ordinary output grant", async () => {
  const f = fixture(), id = await armed(f), stored = copy(f.data.tests[0].plan);
  const loaded = await loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: new Date(NOW.getTime() + 1000) });
  assert.equal(loaded.authorized, true);
  assert.equal(loaded.stationId, LIMITS.stationId);
  assert.equal(loaded.authorizationExpiresAt.toISOString(), "2026-10-21T12:05:00.000Z");
  assert.deepEqual(loaded.tracks.map(({ id: trackId }) => trackId), stored.items.map(({ trackId }) => trackId));
  assert.equal(loaded.tracks.reduce((sum, { durationSeconds }) => sum + durationSeconds, 0), 300);
  assert.equal(new Set(loaded.tracks.map(({ id: trackId }) => trackId)).size, loaded.tracks.length);
  assert.equal(f.data.station.streamConfig.outboundAutoDjEnabled, false);
  assert.equal(f.data.station.organisation.subscription.plan.licensedMusicCatalogueLevel, "NONE");
});

function reorderJsonObjects(value) {
  if (Array.isArray(value)) return value.map(reorderJsonObjects);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort((a, b) => b.length - a.length || b.localeCompare(a))
    .map(key => [key, reorderJsonObjects(value[key])]));
  return value;
}

test("fresh plan hashes survive recursive JSONB-style object reordering through prepared, armed and worker loads", async () => {
  const f = fixture(), session = await prepared(f), row = f.data.tests[0], original = copy(row.plan), originalHash = row.fingerprint;
  row.plan = reorderJsonObjects(row.plan);
  assert.notEqual(JSON.stringify(row.plan), JSON.stringify(original), "the fixture must actually change persisted key order");
  assert.deepEqual(row.plan, original, "object values and all array positions stay identical");
  const preparedLoad = await loadAuthorizedCatalogueTest(f.db, { sessionId: session.id, now: NOW, allowPrepared: true });
  assert.equal(preparedLoad.authorized, true); assert.equal(preparedLoad.fingerprint, originalHash);
  assert.deepEqual(preparedLoad.tracks.map(item => item.id), original.items.map(item => item.trackId));
  await armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true, publicExposureAccepted: true }));
  const armedLoad = await loadAuthorizedCatalogueTest(f.db, { sessionId: session.id, now: new Date(NOW.getTime() + 1000) });
  assert.equal(armedLoad.authorized, true); assert.equal(armedLoad.fingerprint, originalHash);
  assert.equal(f.data.station.streamConfig.outboundAutoDjEnabled, false);
});

test("canonical plan hashes still reject changed scalars, added fields and reordered arrays before current media lookup", async () => {
  for (const mutate of [plan => { plan.targetSeconds -= 1; }, plan => { plan.items[0].playDurationSeconds += 1; },
    plan => { plan.items[0].title += " changed"; }, plan => { plan.validation.authorizationFingerprint = "f".repeat(64); },
    plan => { plan.extraField = true; }, plan => { plan.items.reverse(); }, plan => { plan.validation.tracks.reverse(); }]) {
    const f = fixture(), session = await prepared(f);
    f.data.tests[0].plan = reorderJsonObjects(f.data.tests[0].plan);
    mutate(f.data.tests[0].plan); f.calls.reads.length = 0;
    await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: session.id, now: NOW, allowPrepared: true }), "TEST_PLAN_CHANGED");
    assert.equal(f.calls.reads.some(({ model }) => model === "track"), false);
  }
});

test("legacy insertion-order plan hashes are not accepted as a fallback", async () => {
  const f = fixture(), session = await prepared(f), row = f.data.tests[0];
  const legacy = createHash("sha256").update(JSON.stringify(row.plan)).digest("hex");
  assert.notEqual(legacy, row.fingerprint);
  row.fingerprint = legacy; row.plan = reorderJsonObjects(row.plan);
  await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: session.id, now: NOW, allowPrepared: true }), "TEST_PLAN_CHANGED");
});

// Opt-in SELECT-only acceptance against the explicitly named disposable LOCAL
// fixture. No application DATABASE_URL, production table or cloud is used.
const localJsonbFixture = process.env.RUVANAS_ENCODER_LOCAL_TEST_DB;
test("actual local PostgreSQL JSONB plan roundtrip retains exact authorization and detects tampering", { skip: !localJsonbFixture }, async () => {
  const url = new URL(localJsonbFixture);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "58582" ||
      url.pathname !== "/encoder_source_fixture" || url.username !== "encoder_fixture" || url.password || url.search || url.hash) {
    throw new Error("Explicit passwordless local JSONB fixture required.");
  }
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: url.href });
  try {
    const f = fixture(), session = await prepared(f), row = f.data.tests[0], before = JSON.stringify(row.plan);
    const records = await db.$queryRaw`SELECT ${before}::jsonb AS plan`;
    assert.equal(records.length, 1); assert.notEqual(JSON.stringify(records[0].plan), before);
    assert.deepEqual(records[0].plan, row.plan);
    row.plan = records[0].plan;
    assert.equal((await loadAuthorizedCatalogueTest(f.db, { sessionId: session.id, now: NOW, allowPrepared: true })).authorized, true);
    await armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true, publicExposureAccepted: true }));
    assert.equal((await loadAuthorizedCatalogueTest(f.db, { sessionId: session.id, now: new Date(NOW.getTime() + 1000) })).authorized, true);
    f.data.tests[0].plan.items.reverse();
    await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: session.id, now: NOW }), "TEST_PLAN_CHANGED");
  } finally { await db.$disconnect(); }
});

test("revoked, expired, deleted or demoted original owners cannot authorize later worker playback", async () => {
  for (const change of [(f) => { f.data.ownerSessions[0].revokedAt = NOW; },
    (f) => { f.data.ownerSessions[0].expiresAt = NOW; }, (f) => { f.data.ownerSessions = []; },
    (f) => { f.data.ownerSessions[0].user.role = "OWNER"; }, (f) => { f.data.ownerSessions[0].authMethod = "PREVIEW_CODE"; }]) {
    const f = fixture(), id = await armed(f); change(f);
    await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "TEST_OWNER_SESSION_REQUIRED");
  }
});

test("worker revalidation reloads and respects newly disabled preview access and enterprise session policy", async () => {
  for (const change of [(session) => { session.user.privatePreviewAccess.enabled = false; },
    (session) => { session.user.privatePreviewAccess.passwordEnabled = false; },
    (session) => { session.user.privatePreviewAccess.expiresAt = NOW; },
    (session) => { session.authMethod = "PASSWORD"; },
    (session) => { Object.assign(session, sessionWithPolicy({ sessionMaxAgeMinutes: 1 }, session)); },
    (session) => { Object.assign(session, sessionWithPolicy({ ssoRequired: true, passwordFallback: false }, session)); }]) {
    const f = fixture(), id = await armed(f); change(f.data.ownerSessions[0]);
    await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "TEST_OWNER_SESSION_REQUIRED");
    const lookup = f.calls.reads.filter(({ model }) => model === "session").at(-1);
    assert.deepEqual(lookup.args.include, { user: { include: { privatePreviewAccess: true } },
      activeOrganisation: { include: { enterpriseSecurityPolicy: true } } });
  }
});

test("current approval, immutable audio identity, genre or source-origin changes invalidate a selected track", async () => {
  for (const change of [(item) => { item.rightsReviewStatus = "REJECTED"; }, (item) => { item.permittedTerritories = "US"; },
    (item) => { item.permittedUses = ["RETAIL_RADIO"]; }, (item) => { item.catalogueProvider = "PROMO_ONLY"; },
    (item) => { item.distributorItems = [{ id: "cmnewdistributor00001" }]; },
    (item) => { item.mediaAsset.storageKey = `catalogue/music/${"f".repeat(64)}.mp3`; },
    (item) => { item.mediaAsset.sizeBytes += 1n; }, (item) => { item.mediaAsset.durationSeconds += 1; },
    (item) => { item.mediaAsset.genres[0].mediaGenre.active = false; }]) {
    const f = fixture(), id = await armed(f), selected = f.data.tests[0].plan.items[0].trackId;
    change(f.data.tracks.find(({ id: trackId }) => trackId === selected));
    await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "TEST_TRACK_APPROVAL_CHANGED");
  }
});

test("missing selected tracks cannot silently substitute a newly eligible recording", async () => {
  const f = fixture(), id = await armed(f), selected = f.data.tests[0].plan.items[0].trackId;
  f.data.tracks = f.data.tracks.filter(({ id: trackId }) => trackId !== selected);
  f.data.tracks.push(track(99));
  await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "TEST_TRACK_APPROVAL_CHANGED");
});

test("any saved transport field change invalidates source binding before worker use", async () => {
  for (const patch of [{ streamUrl: "https://changed.example/stream" }, { sourcePasswordEncrypted: "changed-test-only-ciphertext" },
    { providerKey: "GENERIC_HTTP" }, { serverHost: "another.example" }, { sourcePort: 8198 },
    { sourceUsername: "different" }, { centovaUsername: "ruvanas_studio_test" }, { bitrateKbps: 96 }, { outboundAutoDjEnabled: true }]) {
    const f = fixture(), id = await armed(f); Object.assign(f.data.station.streamConfig, patch);
    await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "TEST_SOURCE_CHANGED");
  }
});

test("a plan digest mismatch or stopped/expired session is refused before any current-track lookup", async () => {
  for (const [change, code] of [
    [(row) => { row.plan.items[0].playDurationSeconds += 1; }, "TEST_PLAN_CHANGED"],
    [(row) => { row.stopRequestedAt = NOW; }, "TEST_AUTHORIZATION_INACTIVE"],
    [(row) => { row.status = "STOPPED"; }, "TEST_AUTHORIZATION_INACTIVE"],
    [(row) => { row.expiresAt = NOW; }, "TEST_AUTHORIZATION_INACTIVE"],
    [(row) => { row.deadlineAt = NOW; }, "TEST_DEADLINE_INVALID"],
    [(row) => { row.publicExposureAcceptedAt = null; }, "TEST_DEADLINE_INVALID"],
  ]) {
    const f = fixture(), id = await armed(f); change(f.data.tests[0]); f.calls.reads.length = 0;
    await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), code);
    assert.equal(f.calls.reads.some(({ model }) => model === "track"), false);
  }
});

test("public exposure or service suspension after preparation remains a worker denial", async () => {
  const f = fixture(), id = await armed(f);
  f.data.station.publicPlayerEnabled = true;
  await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "STATION_NOT_PRIVATE");
  f.data.station.publicPlayerEnabled = false;
  f.data.station.organisation.subscription.status = "SUSPENDED";
  await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "SERVICE_INACTIVE");
});

test("expiry of the unchanged metadata-only service prevents later worker use", async () => {
  const f = fixture(), id = await armed(f);
  f.data.station.organisation.subscription.currentPeriodEnd = NOW;
  await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "SERVICE_EXPIRED");
});

test("prepared-only plans cannot be picked up by the worker before explicit arming", async () => {
  const f = fixture(), { id } = await prepared(f);
  await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "TEST_AUTHORIZATION_INACTIVE");
  assert.equal(f.data.tests[0].status, "PREPARED");
});

test("stop requests never claim an encoder actually stopped or release the normal worker lease", async () => {
  const f = fixture(), id = await armed(f), beforeSource = copy(f.data.station.streamConfig);
  f.data.tests[0].status = "RUNNING";
  const result = await stopCatalogueTest(f.db, options(f, { sessionId: id }));
  assert.deepEqual(result, { id, status: "STOP_REQUESTED" });
  assert.equal(f.data.tests[0].status, "RUNNING");
  assert.equal(f.data.tests[0].endedAt, null);
  assert.equal(f.data.tests[0].stopRequestedAt.getTime(), NOW.getTime());
  assert.equal(f.data.audits.at(-1).action, "ONLINE_RADIO_CATALOGUE_TEST_STOP_REQUESTED");
  assert.deepEqual(f.data.station.streamConfig, beforeSource);
  await rejected(loadAuthorizedCatalogueTest(f.db, { sessionId: id, now: NOW }), "TEST_AUTHORIZATION_INACTIVE");
});

test("stop requires an owner and a still-active Test Radio session", async () => {
  const f = fixture(), session = await prepared(f);
  await rejected(stopCatalogueTest(f.db, options(f, { sessionId: session.id, actorSession: { ...f.actor, user: { id: OWNER, role: "OWNER" } } })), "TEST_OWNER_SESSION_REQUIRED");
  f.data.tests[0].status = "COMPLETED";
  await rejected(stopCatalogueTest(f.db, options(f, { sessionId: session.id })), "TEST_NOT_ACTIVE");
});

test("an audit failure rolls back arming rather than leaving an unaudited start request", async () => {
  const f = fixture(), session = await prepared(f);
  f.hooks.audit = () => { throw Object.assign(new Error("INJECTED_AUDIT_FAILURE"), { code: "INJECTED_AUDIT_FAILURE" }); };
  await rejected(armCatalogueTest(f.db, options(f, { sessionId: session.id, startEnabled: true, publicExposureAccepted: true })), "INJECTED_AUDIT_FAILURE");
  assert.equal(f.data.tests[0].status, "PREPARED");
  assert.equal(f.data.tests[0].deadlineAt, null);
  assert.equal(f.data.audits.length, 1);
});

test("dashboard and safe session views never disclose transport secrets, private keys, grants or internal fingerprints", async () => {
  const f = fixture(), session = await prepared(f);
  const result = await catalogueTestDashboard(f.db, options(f));
  assert.equal(result.startEnabled, false);
  assert.equal(result.latest.id, session.id);
  assert.match(result.note, /not listener proof of play/i);
  const encoded = JSON.stringify(result);
  for (const value of ["catalogue/music/", "test-only-ciphertext", "sourcePasswordEncrypted", "sourceFingerprint", "actorSessionId", "storageKey"]) assert.equal(encoded.includes(value), false, value);
  assert.equal(safeCatalogueTestSession(null), null);
  assert.notEqual(catalogueTestSourceFingerprint(source()), catalogueTestSourceFingerprint({ ...source(), sourcePort: 8198 }));
});

test("an older armed or running test remains visible above a newer prepared review", async () => {
  for (const status of ["ARMED", "RUNNING"]) {
    const f = fixture(), first = await prepared(f), second = await prepared(f);
    await armCatalogueTest(f.db, options(f, { sessionId: first.id, startEnabled: true, publicExposureAccepted: true }));
    const older = f.data.tests.find(({ id }) => id === first.id), newer = f.data.tests.find(({ id }) => id === second.id);
    older.status = status; older.createdAt = new Date(NOW.getTime() - 2000); newer.createdAt = new Date(NOW.getTime() - 1000);
    const before = copy(f.data), dashboard = await catalogueTestDashboard(f.db, options(f, { startEnabled: true }));
    assert.equal(dashboard.latest.id, first.id);
    assert.equal(dashboard.latest.status, status);
    assert.equal(dashboard.attentionRequired, false);
    assert.deepEqual(f.data, before, "Selecting visible status never changes playback or saved plans");
  }
});

test("a running test outranks a separately armed row instead of hiding the currently sending source", async () => {
  const f = fixture(), first = await prepared(f), second = await prepared(f);
  f.data.tests[0].status = "RUNNING"; f.data.tests[0].createdAt = new Date(NOW.getTime() - 2000);
  f.data.tests[1].status = "ARMED"; f.data.tests[1].createdAt = new Date(NOW.getTime() - 1000);
  const dashboard = await catalogueTestDashboard(f.db, options(f));
  assert.equal(dashboard.latest.id, first.id);
  assert.notEqual(dashboard.latest.id, second.id);
});

test("unconfirmed stop quarantine outranks newer prepared, active and terminal rows indefinitely", async () => {
  for (const newerStatus of ["PREPARED", "ARMED", "RUNNING", "COMPLETE", "STOPPED", "EXPIRED"]) {
    const f = fixture(), first = await prepared(f); await prepared(f);
    const quarantined = f.data.tests[0]; quarantined.status = "FAILED";
    quarantined.createdAt = new Date(NOW.getTime() - 86_400_000);
    quarantined.expiresAt = new Date(NOW.getTime() - 80_000_000);
    quarantined.endedReason = "CATALOGUE_TEST_STOP_UNCONFIRMED";
    f.data.tests[1].status = newerStatus;
    const dashboard = await catalogueTestDashboard(f.db, options(f, { startEnabled: true }));
    assert.equal(dashboard.latest.id, first.id, newerStatus);
    assert.equal(dashboard.attentionRequired, true);
    assert.equal(dashboard.startEnabled, false);
    assert.equal(dashboard.latest.endedReason, "CATALOGUE_TEST_STOP_UNCONFIRMED");
  }
});

test("an explicit unconfirmed-stop event also quarantines a row even if terminal bookkeeping missed its reason", async () => {
  const f = fixture(), first = await prepared(f); await prepared(f);
  f.data.tests[0].status = "FAILED";
  f.data.tests[0].createdAt = new Date(NOW.getTime() - 10_000);
  f.data.tests[0].events.push({ kind: "TEST_ENDED", details: { stopConfirmed: false }, occurredAt: NOW });
  const dashboard = await catalogueTestDashboard(f.db, options(f, { startEnabled: true }));
  assert.equal(dashboard.latest.id, first.id);
  assert.equal(dashboard.attentionRequired, true);
  assert.equal(dashboard.startEnabled, false);
});

test("dashboard fallback and same-priority freshness use deterministic createdAt and ID ordering", async () => {
  const f = fixture(), first = await prepared(f), second = await prepared(f);
  f.data.tests.reverse();
  const newestTie = await catalogueTestDashboard(f.db, options(f));
  assert.equal(newestTie.latest.id, second.id);
  f.data.tests.find(({ id }) => id === first.id).createdAt = new Date(NOW.getTime() + 1000);
  const newestTime = await catalogueTestDashboard(f.db, options(f));
  assert.equal(newestTime.latest.id, first.id);
  for (const row of f.data.tests) { row.status = "RUNNING"; row.createdAt = NOW; }
  assert.equal((await catalogueTestDashboard(f.db, options(f))).latest.id, second.id);
});

test("unresolved stop quarantine blocks preparing and arming, not merely the dashboard start button", async () => {
  const f = fixture(), toArm = await prepared(f), quarantine = await prepared(f);
  const quarantined = f.data.tests.find(({ id }) => id === quarantine.id);
  quarantined.status = "FAILED"; quarantined.endedReason = "CATALOGUE_TEST_STOP_UNCONFIRMED";
  quarantined.expiresAt = new Date(NOW.getTime() - 1);
  const before = copy(f.data);
  await rejected(prepared(f), "TEST_STOP_UNCONFIRMED");
  await rejected(armCatalogueTest(f.db, options(f, { sessionId: toArm.id, startEnabled: true, publicExposureAccepted: true })), "TEST_STOP_UNCONFIRMED");
  assert.deepEqual(f.data, before);
});

test("a confirmed terminal test does not quarantine newer preparation or disable otherwise-ready start controls", async () => {
  const f = fixture(); await prepared(f); const second = await prepared(f);
  f.data.tests[0].status = "STOPPED"; f.data.tests[0].endedReason = "CATALOGUE_TEST_ABORTED";
  f.data.tests[0].events.push({ kind: "TEST_ENDED", details: { stopConfirmed: true }, occurredAt: NOW });
  const dashboard = await catalogueTestDashboard(f.db, options(f, { startEnabled: true }));
  assert.equal(dashboard.latest.id, second.id);
  assert.equal(dashboard.attentionRequired, false);
  assert.equal(dashboard.startEnabled, true);
});
