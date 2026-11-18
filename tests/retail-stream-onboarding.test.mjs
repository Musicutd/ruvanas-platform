import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { retailSharedStreamPlan, RetailStreamOnboardingError, RETAIL_SHARED_STREAM_POLICY } from "../lib/retail-stream-onboarding.mjs";

const fixture = () => ({ organisationId: "org-retail-a", entitlements: { serviceEnabled: true, retailRadioEnabled: true,
  maxBitrateKbps: 128, stationLimit: 12, streamLimit: 12, siteLimit: 20, displayLimit: 40, digitalSignageDisplayLimit: 12 },
connection: { stationId: "station-retail-a", organisationId: "org-retail-a", productFamily: "RETAIL", providerKey: "CENTOVA_CAST",
  streamUrl: "https://retail-a.example.com/stream", serverHost: "source.example.com", serverPort: 8110, sourcePort: 8112,
  centovaUsername: "retail_a", sourceUsername: "", bitrateKbps: 128, credentialConfigured: true, outputCodec: "MP3" } });
const code = reason => ({ code: `RETAIL_STREAM_${reason}` });
const current = (overrides = {}) => ({ stationId: "station-retail-a", organisationId: "org-retail-a", productFamily: "RETAIL", status: "DRAFT",
  providerKey: "CENTOVA_CAST", serverHost: "source.example.com", sourcePort: 8112, centovaUsername: "retail_a",
  outboundAutoDjEnabled: false, encoderLeaseOwner: null, encoderLeaseUntil: null, probeEnabled: false,
  publicPlayerEnabled: false, stationWebsiteEnabled: false, sourceConnectionStatus: "DISCONNECTED", streamingProfileCount: 0, ...overrides });
function frozen(value) { if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }

test("one subscriber stream is independent of existing shop/display/stream allowances", () => {
  const input = fixture(), plan = retailSharedStreamPlan(input);
  assert.equal(plan.outputCount, 1); assert.equal(plan.sharedAcrossShops, true);
  assert.equal(plan.connection.bitrateKbps, 128); assert.equal(plan.maxBitrateKbps, 128);
  assert.deepEqual(plan.originalEntitlementLimits, { stationLimit: 12, streamLimit: 12, siteLimit: 20, displayLimit: 40, digitalSignageDisplayLimit: 12 });
  assert.equal(plan.requiresPlanLimitReview, false); assert.equal(plan.limitsAreMetadataOnly, true);
  assert.equal(plan.status, "DRAFT_VALIDATED_ONLY"); assert.equal(plan.planDraftValidation, true);
});
test("all playback, activation, public, provisioning and verification claims stay off", () => {
  const plan = retailSharedStreamPlan(fixture());
  for (const field of ["canStart", "outboundAutoDjEnabled", "probeEnabled", "publicPlayerEnabled", "stationWebsiteEnabled", "listenerRequestsEnabled", "activationAllowed", "provisioningAllowed", "workerAllocated", "enterpriseMultistreamEnabled"]) assert.equal(plan[field], false, field);
  assert.ok(Object.values(plan.verification).every(value => value === false));
  assert.equal(plan.audiencePolicy, "INTERNAL"); assert.equal(plan.requiresFreshServerRecheck, true);
  assert.equal(Object.hasOwn(plan, "ready"), false);
});
test("current active Retail permission and valid organisation are mandatory", () => {
  for (const organisationId of ["", null, 2, "org/a", "foreign\norg"]) assert.throws(() => retailSharedStreamPlan({ ...fixture(), organisationId }), code("ORGANISATION_REQUIRED"));
  for (const serviceEnabled of [false, undefined, "true", 1]) { const f = fixture(); f.entitlements.serviceEnabled = serviceEnabled; assert.throws(() => retailSharedStreamPlan(f), code("SERVICE_INACTIVE")); }
  for (const retailRadioEnabled of [false, undefined, "true", 1]) { const f = fixture(); f.entitlements.retailRadioEnabled = retailRadioEnabled; assert.throws(() => retailSharedStreamPlan(f), code("RETAIL_NOT_INCLUDED")); }
  const f = fixture(); f.connection.organisationId = "org-foreign"; assert.throws(() => retailSharedStreamPlan(f), code("CONNECTION_INVALID"));
});
test("Enterprise and large site/display limits never enable multiple outputs", () => {
  for (const requestedOutputCount of [0, 2, 50, "1", null, NaN]) {
    const f = fixture(); f.entitlements.planName = "Enterprise"; f.entitlements.siteLimit = 10000;
    assert.throws(() => retailSharedStreamPlan({ ...f, requestedOutputCount }), code("MULTISTREAM_NOT_SUPPORTED"));
  }
});
test("bitrate comes only from the supplied current ceiling, not a commercial tier table", () => {
  const f = fixture(); f.entitlements.maxBitrateKbps = 96; f.connection.bitrateKbps = 96;
  assert.equal(retailSharedStreamPlan(f).connection.bitrateKbps, 96);
  f.connection.bitrateKbps = 128; assert.throws(() => retailSharedStreamPlan(f), code("BITRATE_NOT_ALLOWED"));
  f.entitlements.maxBitrateKbps = 256; assert.equal(retailSharedStreamPlan(f).maxBitrateKbps, 256);
  for (const value of [null, "128", NaN, Infinity, 0, 321]) { const x = fixture(); x.entitlements.maxBitrateKbps = value; assert.throws(() => retailSharedStreamPlan(x), code("ENTITLEMENTS_INVALID")); }
  for (const value of [null, undefined, "96", 7, 129, 96.5]) { const x = fixture(); x.connection.bitrateKbps = value; assert.throws(() => retailSharedStreamPlan(x), code("BITRATE_NOT_ALLOWED")); }
});
test("missing explicit commercial metadata stays null and never derives sites from stream count", () => {
  const f = fixture(); delete f.entitlements.siteLimit; delete f.entitlements.displayLimit; delete f.entitlements.digitalSignageDisplayLimit;
  const plan = retailSharedStreamPlan(f); assert.equal(plan.requiresPlanLimitReview, true);
  assert.equal(plan.originalEntitlementLimits.siteLimit, null); assert.equal(plan.originalEntitlementLimits.displayLimit, null);
  assert.equal(plan.originalEntitlementLimits.streamLimit, 12); assert.equal(plan.outputCount, 1);
  for (const value of [-1, "20", Infinity, 2.5, Number.MAX_SAFE_INTEGER + 1]) { const x = fixture(); x.entitlements.siteLimit = value; assert.throws(() => retailSharedStreamPlan(x), code("ENTITLEMENTS_INVALID")); }
  f.entitlements.siteLimit = 0; assert.equal(retailSharedStreamPlan(f).originalEntitlementLimits.siteLimit, 0);
});
test("source port is explicitly supplied, not guessed from listener or server port", () => {
  for (const sourcePort of [undefined, null, "8110", 0, 65536, 80.5]) { const f = fixture(); f.connection.sourcePort = sourcePort; assert.throws(() => retailSharedStreamPlan(f), code("CONNECTION_INVALID")); }
  const f = fixture(); delete f.connection.serverPort; f.connection.sourcePort = 8110;
  const plan = retailSharedStreamPlan(f); assert.equal(plan.connection.serverPort, null); assert.equal(plan.connection.sourcePort, 8110);
});
test("listener requires HTTPS and rejects credentials, query secrets, fragments and URL coercions", () => {
  for (const streamUrl of ["http://retail.example.com/stream", "https://a:b@retail.example.com/stream", "https://retail.example.com/stream?token=SECRET", "https://retail.example.com/#secret", "https://localhost/stream", "https://127.0.0.1/stream", "https://0x7f000001/stream", "https://0177.0.0.1/stream", "https://127.1/stream", "https://retail.example.com\\@127.0.0.1/", "https://[::1]/", "https://retail.example.com:0/", "https://retail.example.com:99999/", " https://retail.example.com/", "https://retail.example.com/\n"]) {
    const f = fixture(); f.connection.streamUrl = streamUrl; assert.throws(() => retailSharedStreamPlan(f), code("LISTENER_INVALID"), streamUrl);
  }
});
test("source host validates canonical public syntax only and rejects private or ambiguous targets", () => {
  for (const serverHost of ["localhost", "radio.local", "radio.internal", "radio.invalid", "private.lan", "source", "127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.1.2", "172.31.1.1", "192.168.1.1", "192.0.2.1", "198.18.1.2", "203.0.113.4", "224.0.0.1", "999.2.3.4", "01.2.3.4", "127.1", "0x7f000001", "[::1]", "2001:4860:4860::8888", "https://source.example.com", "user@source.example.com", "source.example.com:8000", "source.example.com/", "source.example.com..", "source_1.example.com", "-bad.example.com"]) {
    const f = fixture(); f.connection.serverHost = serverHost; assert.throws(() => retailSharedStreamPlan(f), code("HOST_INVALID"), serverHost);
  }
  const f = fixture(); f.connection.serverHost = "8.8.8.8"; assert.equal(retailSharedStreamPlan(f).connection.serverHost, "8.8.8.8");
  f.connection.serverHost = "SOURCE.EXAMPLE.COM."; assert.equal(retailSharedStreamPlan(f).connection.serverHost, "source.example.com");
});
test("provider, codec, account and credential-presence fields fail closed", () => {
  for (const providerKey of [undefined, "ICECAST", "GENERIC_HTTP", "centova_cast"]) { const f = fixture(); f.connection.providerKey = providerKey; assert.throws(() => retailSharedStreamPlan(f), code("PROVIDER_NOT_SUPPORTED")); }
  const f = fixture(); f.connection.outputCodec = "AAC"; assert.throws(() => retailSharedStreamPlan(f), code("PROVIDER_NOT_SUPPORTED"));
  for (const centovaUsername of ["", "name:secret", "name\nother", " name ", 5]) { const x = fixture(); x.connection.centovaUsername = centovaUsername; assert.throws(() => retailSharedStreamPlan(x), code("CONNECTION_INVALID")); }
  for (const credentialConfigured of [undefined, null, "true", 1]) { const x = fixture(); x.connection.credentialConfigured = credentialConfigured; assert.throws(() => retailSharedStreamPlan(x), code("CONNECTION_INVALID")); }
  const missing = fixture(); missing.connection.credentialConfigured = false;
  assert.match(retailSharedStreamPlan(missing).warnings.join(" "), /not configured/);
});
test("all unexpected credential fields are rejected with fixed errors and no leaked bytes", () => {
  const secret = "DO_NOT_LEAK_ secret with trailing spaces  ";
  for (const field of ["sourcePassword", "sourcePasswordEncrypted", "adminPassword", "secret", "apiKey", "accessToken", "credential", "passwordHint"]) {
    for (const target of ["connection", "entitlements", "top", "inventory"]) {
      const f = fixture(); if (target === "top") f[field] = secret;
      else if (target === "inventory") f.existingOutputs = [{ ...current(), [field]: secret }];
      else f[target][field] = secret;
      assert.throws(() => retailSharedStreamPlan(f), error => error instanceof RetailStreamOnboardingError && error.code === "RETAIL_STREAM_CREDENTIAL_FIELDS_NOT_ALLOWED" && !JSON.stringify(error).includes(secret) && !error.message.includes(secret));
    }
  }
  const f = fixture(); f.connection.unexpected = secret; assert.throws(() => retailSharedStreamPlan(f), code("CONNECTION_INVALID"));
  assert.doesNotMatch(JSON.stringify(retailSharedStreamPlan(fixture())), /password|secret|token|cookie|encrypted/i);
});
test("the current Test Radio station, account, listener and source tuple are never reusable", () => {
  const mutations = [f => { f.connection.stationId = "cmvcnbwi20008hr23sd76psi8"; },
    f => { f.connection.centovaUsername = "ruvanastestradio"; }, f => { f.connection.centovaUsername = "RUVANAS_TEST_RADIO"; },
    f => { f.connection.serverHost = "POLLUX.SHOUTCA.ST."; f.connection.sourcePort = 8282; },
    f => { f.connection.serverHost = "88.198.70.25"; f.connection.sourcePort = 8282; },
    f => { f.connection.streamUrl = "https://ruvanastestradio-radio105network.radioca.st/stream"; }];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => retailSharedStreamPlan(f), code("TARGET_RESERVED")); }
});
test("only an explicitly off, unleased same-tenant Retail draft may be updated", () => {
  const f = fixture(); f.existingOutputs = [current()]; assert.equal(retailSharedStreamPlan(f).existingProfileReused, true);
  f.existingOutputs = [current({ organisationId: "org-foreign" })]; assert.throws(() => retailSharedStreamPlan(f), code("FOREIGN_PROFILE"));
  for (const change of [{ status: "ACTIVE" }, { status: "PENDING_SETUP" }, { status: "PAUSED" }, { productFamily: "ONLINE" },
    { outboundAutoDjEnabled: true }, { encoderLeaseOwner: "worker" }, { encoderLeaseUntil: "2026-10-20T00:00:00Z" },
    { encoderLeaseOwner: undefined }, { probeEnabled: true }, { publicPlayerEnabled: true }, { stationWebsiteEnabled: true },
    { sourceConnectionStatus: "CONNECTED" }, { sourceConnectionStatus: "UNKNOWN" }, { sourceConnectionStatus: undefined },
    { streamingProfileCount: undefined }, { streamingProfileCount: 1 }, { streamingProfileCount: -1 }, { streamingProfileCount: "0" }]) {
    f.existingOutputs = [current(change)]; assert.throws(() => retailSharedStreamPlan(f), code("PROFILE_NOT_EDITABLE"));
  }
});
test("one current Retail stream per subscriber is enforced independently of plan limits", () => {
  const f = fixture(); f.existingOutputs = [current({ stationId: "another-retail", serverHost: "other.example.com", sourcePort: 9000, centovaUsername: "other" })];
  for (const status of ["DRAFT", "PENDING_SETUP", "ACTIVE", "PAUSED", "SUSPENDED"]) { f.existingOutputs[0].status = status; assert.throws(() => retailSharedStreamPlan(f), code("SHARED_STREAM_EXISTS")); }
  f.existingOutputs[0].status = "ARCHIVED"; assert.equal(retailSharedStreamPlan(f).outputCount, 1);
  f.existingOutputs[0].status = "CANCELLED"; assert.equal(retailSharedStreamPlan(f).outputCount, 1);
});
test("foreign and terminal provider reservations still block source/account collisions", () => {
  for (const overrides of [{ sourcePort: 8112, centovaUsername: "different" }, { sourcePort: 9999, centovaUsername: "RETAIL_A" }]) {
    const f = fixture(); f.existingOutputs = [current({ stationId: "foreign-station", organisationId: "org-b", status: "CANCELLED", serverHost: "SOURCE.EXAMPLE.COM.", ...overrides })];
    assert.throws(() => retailSharedStreamPlan(f), code("SOURCE_ALREADY_ASSIGNED"));
  }
  const f = fixture(); f.existingOutputs = [current({ stationId: "foreign-station", organisationId: "org-b", serverHost: "other.example.com" })];
  assert.equal(retailSharedStreamPlan(f).outputCount, 1);
});
test("malformed, duplicate, oversized or unknown-state inventory is never silently ignored", () => {
  for (const existingOutputs of [null, {}, [current(), current()], [current({ status: "UNKNOWN" })], [current({ productFamily: null })], [current({ stationId: "bad/id" })], [current({ serverHost: "127.0.0.1" })], Array(2001).fill(current())]) {
    assert.throws(() => retailSharedStreamPlan({ ...fixture(), existingOutputs }), code("EXISTING_OUTPUTS_INVALID"));
  }
});
test("ambiguous legacy Centova ports or account identity require review rather than declaring the source free", () => {
  for (const change of [{ sourcePort: null }, { sourcePort: undefined }, { centovaUsername: null },
    { centovaUsername: undefined }, { serverHost: null }, { providerKey: null }, { providerKey: undefined }]) {
    const f = fixture(); f.existingOutputs = [current({ stationId: "legacy-station", organisationId: "org-other", ...change })];
    assert.throws(() => retailSharedStreamPlan(f), code("EXISTING_OUTPUTS_INVALID"));
  }
});
test("pure validation preserves inputs and returns independent allowlisted metadata", () => {
  const f = frozen(fixture()), before = JSON.stringify(f), plan = retailSharedStreamPlan(f);
  assert.equal(JSON.stringify(f), before); assert.notEqual(plan.connection, f.connection); assert.notEqual(plan.originalEntitlementLimits, f.entitlements);
  plan.connection.bitrateKbps = 8; plan.originalEntitlementLimits.siteLimit = 99;
  assert.equal(f.connection.bitrateKbps, 128); assert.equal(f.entitlements.siteLimit, 20);
  for (const input of [undefined, null, [], "input"]) assert.throws(() => retailSharedStreamPlan(input), code("INPUT_INVALID"));
  assert.equal(RETAIL_SHARED_STREAM_POLICY.outputCount, 1);
});
test("the policy has no imports, environment access, network, storage or process side effects", async () => {
  const source = await readFile(new URL("../lib/retail-stream-onboarding.mjs", import.meta.url), "utf8");
  const forbidden = /^\s*import\s|\bimport\s*\(|\bprocess\s*\.|\bfetch\s*\(|node:|child_process|\b(?:prisma|require|spawn|readFile|writeFile)\s*\(|(?<!\.)\bexec\s*\(/m;
  assert.equal(forbidden.test(source), false, "Pure policy must not import or invoke external I/O/process APIs.");
});
