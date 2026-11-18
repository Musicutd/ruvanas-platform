import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN, PREVIEW_ONLINE_DRAFT_PLAN, PREVIEW_TESTER_PLAN,
  previewTesterCatalogueMetadataPolicy } from "../lib/private-preview-account-policy.mjs";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";
import { onlineDraftChannelWhere } from "../lib/private-preview-online-draft.mjs";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { normaliseGenreCode, sourceScopeForTrack } from "../lib/autodj-genre-entitlements.mjs";
import { rightsUseForChannel } from "../lib/subscriber-playlist-service.mjs";
import { subscriberProductAccess } from "../lib/product-access.mjs";

const id = (n) => `c${String(n).padStart(24, "0")}`;
const ORG = id(1), FOREIGN = id(2), USER = id(3), CHANNEL = id(4), STATION = id(5);
const EXPIRY = new Date(Date.now() + 24 * 60 * 60 * 1000);
const NextResponse = { json: (body, options) => Response.json(body, options) };
const routePath = new URL("../app/api/catalogue/music/route.js", import.meta.url);
const routeSource = await readFile(routePath, "utf8");
const executable = routeSource.replace(/import[\s\S]*?from ["'][^"']+["'];\r?\n/g, "").replace(/^export /gm, "");

function subscription(plan) {
  return { organisationId: ORG, plan: { ...plan }, status: "TRIAL", billingContract: null,
    currentPeriodEnd: EXPIRY, complimentaryAccessActive: false,
    retailRadioEnabled: false, schoolRadioEnabled: false, onlineRadioEnabled: true,
    healthRadioEnabled: false, faithRadioEnabled: false, organisationsEnabled: false,
    correctionsRadioEnabled: false, schoolPublicPublishingEnabled: false,
    retailMediaEnabled: false, digitalSignageEnabled: false };
}

function actor(plan, overrides = {}) {
  const grantExpiry = overrides.grantExpiry || EXPIRY;
  const sub = subscription(plan);
  sub.currentPeriodEnd = grantExpiry;
  const grant = { userId: USER, organisationId: overrides.grantOrganisationId || ORG,
    enabled: overrides.grantEnabled !== false, passwordEnabled: false,
    pillars: ["ONLINE"], expiresAt: grantExpiry };
  const user = { id: USER, role: "OWNER", email: "synthetic-radio@example.test",
    privatePreviewAccess: grant, memberships: [{ organisationId: ORG, role: "OWNER",
      organisation: { id: ORG, subscription: sub } }] };
  const session = { userId: USER, user, authMethod: "PREVIEW_CODE", revokedAt: overrides.revoked ? new Date() : null,
    activeOrganisationId: overrides.activeOrganisationId || ORG, expiresAt: EXPIRY };
  return { session, subscription: sub };
}

function draftChannel(overrides = {}) {
  return { id: CHANNEL, organisationId: ORG, status: "DRAFT", musicRightsUse: "ONLINE_RADIO",
    stationId: STATION, station: { id: STATION, organisationId: ORG, productFamily: "ONLINE",
      status: "PENDING_SETUP", publicPlayerEnabled: false, stationWebsiteEnabled: false,
      streamConfig: null }, autoDjPolicy: { territory: "US" },
    zoneAssignments: [{ zone: { location: { countryCode: "GB" } } }], ...overrides };
}

function matches(row, where) {
  return Object.entries(where || {}).every(([key, expected]) => {
    const actual = row?.[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) return matches(actual, expected);
    return actual === expected;
  });
}

function entry(number, { status = "APPROVED", licensed = false, title = "Synthetic approved song" } = {}) {
  return { genreCodes: ["POP"], track: { id: id(number), title, artist: "Fixture artist",
    album: "Fixture album", mixName: "Radio mix", bpm: 120, isExplicit: false,
    minimumCatalogueLevel: "FOCUSED", rightsReviewStatus: status,
    providerMetadata: { supplierToken: "DO_NOT_SERIALIZE_PROVIDER" },
    mediaAsset: { libraryType: "RUVANAS_CATALOGUE", licensedCatalogue: licensed,
      durationSeconds: 183, storageKey: "DO_NOT_SERIALIZE_STORAGE", sourceUrl: "DO_NOT_SERIALIZE_URL" } } };
}

function harness({ plan = PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN, sessionPlan = null, sessionOverrides = {},
  channel = draftChannel(), entries = [entry(11), entry(12, { licensed: true, title: "Synthetic licensed song" }),
    entry(13, { status: "IN_REVIEW", title: "Not reviewed" })],
  entitlements: suppliedEntitlements, sandboxDraftOnly: suppliedDraft } = {}) {
  const { session, subscription: sub } = actor(plan, sessionOverrides);
  if (sessionPlan) session.user.memberships[0].organisation.subscription = { ...sub, plan: { ...sessionPlan } };
  const entitlements = suppliedEntitlements || resolveEntitlements(sub);
  const access = { context: { session, user: session.user, membership: { organisationId: ORG, role: "OWNER",
    organisation: { id: ORG, subscription: sub } } }, entitlements,
    sandboxDraftOnly: suppliedDraft ?? entitlements.sandboxDraftOnly };
  const calls = { channel: [], genres: [], loader: [], zone: 0 };
  const unexpected = (label) => { throw new Error(`Unexpected database or media operation: ${label}`); };
  const prisma = new Proxy({
    channel: { findFirst: async (args) => { calls.channel.push(args); return matches(channel, args.where) ? channel : null; } },
    mediaGenre: { findMany: async (args) => { calls.genres.push(args); return [{ slug: "pop", name: "Pop", active: true, minimumCatalogueLevel: "FOCUSED" }]; } },
    zone: { findFirst: async () => { calls.zone += 1; return null; } }
  }, { get(target, key) { return key in target ? target[key] : unexpected(String(key)); } });
  const dependencies = { NextResponse, prisma, simplePlaylistAccess: async () => access,
    loadEligibleSubscriberMusic: async (db, args) => { assert.equal(db, prisma); calls.loader.push(args); return entries; },
    rightsUseForChannel, normaliseGenreCode, sourceScopeForTrack, subscriberProductAccess,
    previewTesterCatalogueMetadataPolicy, privatePreviewTesterRequestAllowed, onlineDraftChannelWhere };
  const GET = new Function(...Object.keys(dependencies), `${executable}\nreturn GET;`)(...Object.values(dependencies));
  const get = (query = `product=ONLINE&channelId=${CHANNEL}`) => GET(new Request(`https://preview.example.test/api/catalogue/music?${query}`));
  return { get, calls, access, session, prisma };
}

test("exact Malta preview mode returns only approved, rights-scoped metadata with no audio authority", async () => {
  const h = harness();
  assert.equal(h.access.sandboxDraftOnly, true);
  assert.equal(h.access.entitlements.outputEnabled, false);
  assert.equal(h.access.entitlements.includesRuvanasCatalogue, false);
  assert.equal(h.access.entitlements.licensedMusicCatalogueLevel, "NONE");
  assert.equal(privatePreviewTesterRequestAllowed({ session: h.session, pathname: "/api/catalogue/music", method: "GET" }), true);
  const response = await h.get(`product=ONLINE&channelId=${CHANNEL}&q=synthetic&genre=POP&limit=50&territory=US&catalogueLevel=PREMIUM`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const payload = await response.json();
  assert.equal(payload.metadataOnly, true);
  assert.equal(payload.territory, "MT");
  assert.equal(payload.territoryKnown, true);
  assert.equal(payload.catalogueLevel, "FOCUSED");
  assert.equal(payload.product, "ONLINE");
  assert.deepEqual(payload.sources, ["RUVANAS_CORE", "LICENSED_CATALOGUE"]);
  assert.deepEqual(payload.tracks.map(({ id: trackId }) => trackId), [id(11), id(12)]);
  assert.equal(payload.total, 2);
  assert.deepEqual(Object.keys(payload.tracks[0]).sort(), ["album", "artist", "bpm", "catalogueTier",
    "durationSeconds", "explicit", "genreCodes", "id", "mix", "source", "title"].sort());
  const serialised = JSON.stringify(payload);
  for (const forbidden of ["DO_NOT_SERIALIZE_PROVIDER", "DO_NOT_SERIALIZE_STORAGE", "DO_NOT_SERIALIZE_URL", "audioUrl", "mediaAssetId", "rightsReference"]) {
    assert.equal(serialised.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(h.calls.channel[0].where, { id: CHANNEL, ...onlineDraftChannelWhere(ORG) });
  assert.equal(h.calls.loader.length, 1);
  assert.deepEqual({ ...h.calls.loader[0], configuredGenres: undefined }, {
    organisationId: ORG, requiredUse: "ONLINE_RADIO", territory: "MT", catalogueLevel: "FOCUSED",
    sourceScopes: ["RUVANAS_CORE", "LICENSED_CATALOGUE"], configuredGenres: undefined
  });
  assert.equal(h.calls.genres.length, 1);
  assert.equal(h.calls.zone, 0);
});

test("original draft, read-only, expired, revoked and wrong-tenant testers cannot obtain preview catalogue metadata", async () => {
  for (const [label, options] of [
    ["original draft", { plan: PREVIEW_ONLINE_DRAFT_PLAN }],
    ["read-only tester", { plan: PREVIEW_TESTER_PLAN }],
    ["expired grant", { sessionOverrides: { grantExpiry: new Date(Date.now() - 60_000) } }],
    ["revoked session", { sessionOverrides: { revoked: true } }],
    ["wrong active organisation", { sessionOverrides: { activeOrganisationId: FOREIGN } }],
    ["wrong grant organisation", { sessionOverrides: { grantOrganisationId: FOREIGN } }],
    ["disabled grant", { sessionOverrides: { grantEnabled: false } }],
    ["session and context disagree on plan", { sessionPlan: PREVIEW_ONLINE_DRAFT_PLAN }],
    ["forged preview plan fields", { plan: { ...PREVIEW_ONLINE_DRAFT_CATALOGUE_PLAN, name: "Changed without approval" } }]
  ]) {
    const h = harness(options);
    assert.equal(privatePreviewTesterRequestAllowed({ session: h.session, pathname: "/api/catalogue/music", method: "GET" }), false, label);
    const response = await h.get();
    assert.equal(response.status, 403, label);
    assert.equal(h.calls.loader.length, 0, label);
    assert.equal(h.calls.channel.length, 0, label);
  }
});

test("metadata path rejects unscoped product, zones, foreign or activated channels before catalogue read", async () => {
  for (const query of ["", `channelId=${CHANNEL}`, "product=ONLINE", `product=RETAIL&channelId=${CHANNEL}`,
    `product=ONLINE&channelId=${CHANNEL}&zoneId=${id(8)}`, `product=ONLINE&zoneId=${id(8)}`]) {
    const h = harness();
    assert.notEqual((await h.get(query)).status, 200, query);
    assert.equal(h.calls.loader.length, 0, query);
  }
  for (const [label, channel] of [
    ["foreign tenant", draftChannel({ organisationId: FOREIGN })],
    ["active channel", draftChannel({ status: "ACTIVE" })],
    ["wrong rights use", draftChannel({ musicRightsUse: "RETAIL_RADIO" })],
    ["active station", draftChannel({ station: { ...draftChannel().station, status: "ACTIVE" } })],
    ["public player", draftChannel({ station: { ...draftChannel().station, publicPlayerEnabled: true } })],
    ["stream connected", draftChannel({ station: { ...draftChannel().station, streamConfig: { id: id(20) } } })]
  ]) {
    const h = harness({ channel });
    assert.equal((await h.get()).status, 404, label);
    assert.equal(h.calls.loader.length, 0, label);
    assert.deepEqual(h.calls.channel[0].where, { id: CHANNEL, ...onlineDraftChannelWhere(ORG) }, label);
  }
});

test("ordinary subscriber path keeps its existing entitlement and channel territory, not the preview override", async () => {
  const plan = { ...PREVIEW_ONLINE_DRAFT_PLAN, code: "ORDINARY_ONLINE_TEST_PLAN", productFamily: "ONLINE",
    includesRuvanasCatalogue: true, licensedMusicCatalogueLevel: "PROFESSIONAL" };
  const h = harness({ plan, channel: draftChannel({ status: "ACTIVE" }), entries: [entry(11)] });
  assert.equal(h.access.sandboxDraftOnly, false);
  const response = await h.get();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.metadataOnly, false);
  assert.equal(Object.hasOwn(payload, "territory"), false);
  assert.equal(payload.catalogueLevel, "PROFESSIONAL");
  assert.deepEqual(payload.sources, ["RUVANAS_CORE", "LICENSED_CATALOGUE"]);
  assert.equal(h.calls.loader[0].territory, "US");
  assert.equal(h.calls.loader[0].catalogueLevel, "PROFESSIONAL");
  assert.deepEqual(h.calls.channel[0].where, { id: CHANNEL, organisationId: ORG });
});

test("route source adds no media, storage or write operation", () => {
  assert.doesNotMatch(routeSource, /GetObjectCommand|S3Client|readObject|storageKey:|audioUrl:|\.create\(|\.update\(|\.delete\(|\$transaction\(/);
});
