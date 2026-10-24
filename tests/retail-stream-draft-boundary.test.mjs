import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as pillarAudio from "../lib/pillar-audio.mjs";
import { isManagedRetailStreamDraftStation, RETAIL_STREAM_DRAFT_PROTECTED_MESSAGE } from "../lib/retail-stream-draft-boundary.mjs";
import { retailStreamStationSlug } from "../lib/retail-stream-setup-service.mjs";

const organisationId = "org-retail-fixture";
const managed = (overrides = {}) => ({ id: "station-retail-fixture", organisationId, productFamily: "RETAIL",
  slug: retailStreamStationSlug(organisationId), status: "DRAFT", ...overrides });

test("only the exact scoped managed Retail identity is fenced, regardless of status", () => {
  for (const status of ["DRAFT", "PENDING_SETUP", "ACTIVE", "PAUSED", "SUSPENDED", "CANCELLED"])
    assert.equal(isManagedRetailStreamDraftStation(managed({ status })), true, status);
  for (const station of [null, {}, managed({ id: "" }), managed({ organisationId: "bad/id" }),
    managed({ productFamily: "ONLINE" }), managed({ productFamily: null }), managed({ slug: "ordinary-retail" }),
    managed({ organisationId: "org-other" }), managed({ slug: "cmvcnbwi20008hr23sd76psi8" })])
    assert.equal(isManagedRetailStreamDraftStation(station), false);
});

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const compiled = new Map();
async function route(file, imports) {
  if (!compiled.has(file)) compiled.set(file, babel.transformSync(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
    filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
  }).code);
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(file), { module, exports: module.exports, Request, Response, URL, console,
    require: name => {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name === "next/server") return { NextResponse: { json: (body, options) => Response.json(body, options) } };
      if (name === "@/lib/retail-stream-draft-boundary.mjs")
        return { isManagedRetailStreamDraftStation, RETAIL_STREAM_DRAFT_PROTECTED_MESSAGE };
      if (name === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
      if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      return require(name.startsWith("@babel/runtime/") ? `next/dist/compiled/${name}` : name);
    }
  }, { filename: file });
  return module.exports;
}
const admin = { ok: true, user: { id: "admin-fixture", role: "SUPER_ADMIN" } };
const params = { params: Promise.resolve({ stationId: "station-retail-fixture" }) };
const fail = name => () => { throw new Error(`${name} must not run for the protected draft`); };

test("generic station setup denies managed draft before encryption, health settings or writes", async () => {
  let writes = 0;
  const module = await route("app/api/stations/[stationId]/setup/route.js", {
    "@/lib/prisma": { prisma: { station: { findUnique: async () => managed({ streamConfig: null }) },
      $transaction: async () => { writes++; throw new Error("transaction must not run"); } } },
    "@/lib/access-control": { requirePlatformAdmin: async () => admin },
    "@/lib/api-response": { accessDenied: fail("accessDenied") },
    "@/lib/crypto": { encryptSecret: fail("encryptSecret") },
    "@/lib/stream-source-health.mjs": { normalizeStreamProviderKey: () => "CENTOVA_CAST", normalizeStreamHealthSettings: fail("normalizeStreamHealthSettings") }
  });
  const response = await module.POST(new Request("https://example.test/api/stations/station-retail-fixture/setup", {
    method: "POST", body: JSON.stringify({ streamUrl: "https://audio.example.test/stream", serverHost: "source.example.test",
      serverPort: 8000, centovaUsername: "account", sourcePassword: "synthetic-secret" })
  }), params);
  assert.equal(response.status, 409); assert.match((await response.json()).error, /private draft/); assert.equal(writes, 0);
});

test("generic manual probe denies managed draft before any remote request or audit write", async () => {
  let probes = 0, writes = 0;
  const module = await route("app/api/admin/streams/[stationId]/probe/route.js", {
    "@/lib/prisma": { prisma: { stationStreamConfig: { findUnique: async () => ({ station: managed(), streamUrl: "https://audio.example.test/stream" }) },
      auditLog: { create: async () => { writes++; } } } },
    "@/lib/access-control": { requirePlatformAdmin: async () => admin },
    "@/lib/api-response": { accessDenied: fail("accessDenied") },
    "@/lib/stream-source-health-service": { probeStationStream: async () => { probes++; } },
    "@/lib/security-log": { getRequestId: () => "fixture-request" }
  });
  const response = await module.POST(new Request("https://example.test/api/admin/streams/station-retail-fixture/probe", { method: "POST" }), params);
  assert.equal(response.status, 409); assert.equal(probes, 0); assert.equal(writes, 0);
});

test("generic activation denies managed draft before entitlement mapping, stream probe or transaction", async () => {
  let probes = 0, writes = 0;
  const module = await route("app/api/admin/stations/[stationId]/activate/route.js", {
    "@/lib/prisma": { prisma: { station: { findUnique: async () => managed({ channels: [], streamConfig: { streamUrl: "https://audio.example.test/stream" } }) } } },
    "@/lib/access-control": { requirePlatformAdmin: async () => admin },
    "@/lib/api-response": { accessDenied: fail("accessDenied") },
    "@/lib/entitlements.mjs": { resolveEntitlements: fail("resolveEntitlements") },
    "@/lib/product-access.mjs": { subscriberProductAccess: fail("subscriberProductAccess"), subscriberProductForStationFamily: fail("subscriberProductForStationFamily") },
    "@/lib/stream-source-health-service": { probeStationStream: async () => { probes++; } },
    "@/lib/transaction-retry.mjs": { runSerializableTransaction: async () => { writes++; } }
  });
  const response = await module.POST(new Request("https://example.test/api/admin/stations/station-retail-fixture/activate", { method: "POST" }), params);
  assert.equal(response.status, 409); assert.equal(probes, 0); assert.equal(writes, 0);
});

test("generic Studio streaming profile writes deny managed draft before parsing, encryption or writes", async () => {
  let writes = 0;
  const module = await route("app/api/admin/stations/[stationId]/streaming-profiles/route.js", {
    "@/lib/prisma": { prisma: { station: { findUnique: async () => managed() }, $transaction: async () => { writes++; } } },
    "@/lib/access-control": { requirePlatformAdmin: async () => admin },
    "@/lib/api-response": { accessDenied: fail("accessDenied") },
    "@/lib/crypto": { encryptSecret: fail("encryptSecret") },
    "@/lib/external-live.mjs": { parseExternalLiveSourceInput: fail("parseExternalLiveSourceInput") },
    "@/lib/external-live-service": { createExternalLiveSource: fail("createExternalLiveSource") },
    "@/lib/studio-broadcast.mjs": { safeStudioDestination: fail("safeStudioDestination"), validateStudioDestination: fail("validateStudioDestination") }
  });
  for (const [method, input] of [["POST", { kind: "STUDIO_DESTINATION", credential: "synthetic-secret" }],
    ["PATCH", { destinationId: "destination-fixture", enabled: true }]]) {
    const response = await module[method](new Request("https://example.test/api/admin/stations/station-retail-fixture/streaming-profiles", {
      method, body: JSON.stringify(input)
    }), params);
    assert.equal(response.status, 409, method);
  }
  assert.equal(writes, 0);
});

test("other stations retain established generic setup and activation paths", async () => {
  const setup = await route("app/api/stations/[stationId]/setup/route.js", {
    "@/lib/prisma": { prisma: { station: { findUnique: async () => managed({ slug: "ordinary-retail", streamConfig: null }) },
      $transaction: async fn => fn({ stationStreamConfig: { upsert: async () => ({}) }, auditLog: { create: async () => ({}) } }) } },
    "@/lib/access-control": { requirePlatformAdmin: async () => admin },
    "@/lib/api-response": { accessDenied: fail("accessDenied") },
    "@/lib/crypto": { encryptSecret: () => "fixture-encrypted" },
    "@/lib/stream-source-health.mjs": { normalizeStreamProviderKey: () => "GENERIC_HTTP",
      normalizeStreamHealthSettings: () => ({ providerKey: "GENERIC_HTTP", backupStreamUrl: null, probeEnabled: true,
        probeIntervalSeconds: 60, probeTimeoutMs: 8000 }) }
  });
  const saved = await setup.POST(new Request("https://example.test/api/stations/station-retail-fixture/setup", {
    method: "POST", body: JSON.stringify({ streamUrl: "https://audio.example.test/stream" })
  }), params);
  assert.equal(saved.status, 200);

  const activate = await route("app/api/admin/stations/[stationId]/activate/route.js", {
    "@/lib/prisma": { prisma: { station: { findUnique: async () => managed({ slug: "ordinary-retail", status: "ACTIVE", channels: [], streamConfig: { streamUrl: "https://audio.example.test/stream" } }) } } },
    "@/lib/access-control": { requirePlatformAdmin: async () => admin },
    "@/lib/api-response": { accessDenied: fail("accessDenied") },
    "@/lib/entitlements.mjs": { resolveEntitlements: fail("resolveEntitlements") },
    "@/lib/product-access.mjs": { subscriberProductAccess: fail("subscriberProductAccess"), subscriberProductForStationFamily: fail("subscriberProductForStationFamily") },
    "@/lib/stream-source-health-service": { probeStationStream: fail("probeStationStream") },
    "@/lib/transaction-retry.mjs": { runSerializableTransaction: fail("runSerializableTransaction") }
  });
  const active = await activate.POST(new Request("https://example.test/api/admin/stations/station-retail-fixture/activate", { method: "POST" }), params);
  assert.equal(active.status, 200);
});

test("admin station navigation does not offer the generic setup to a managed Retail draft", async () => {
  const [list, page] = await Promise.all([
    readFile(new URL("../app/admin/stations/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/stations/[stationId]/setup/page.js", import.meta.url), "utf8")
  ]);
  assert.match(list, /isManagedRetailStreamDraftStation\(station\)/);
  assert.match(list, /Retail draft setup/);
  assert.match(list, /Private draft · not live/);
  assert.match(page, /isManagedRetailStreamDraftStation\(station\)/);
  assert.match(page, /redirect\(`\/admin\/organisations\/\$\{encodeURIComponent\(station.organisationId\)\}\/retail-stream`\)/);
});

test("Retail Listen suppresses exact managed draft output and rejects its direct station link", async () => {
  const listenerUrl = "https://retail-provider.example.test/private-stream?credential=SYNTHETIC_PRIVATE_URL";
  const draft = managed({ name: "Private Retail draft", streamConfig: { streamUrl: listenerUrl }, publicPlayerEnabled: true });
  const navigation = { notFound: () => { throw new Error("NOT_FOUND"); } };
  const page = await route("app/dashboard/listen/[product]/page.js", {
    "@/lib/prisma": { prisma: { station: { findMany: async () => [draft] } } },
    "@/lib/pillar-audio.mjs": pillarAudio,
    "@/lib/subscriber-product-access": { requireSubscriberProduct: async () => ({ context: { membership: { organisationId } } }) },
    "next/navigation": navigation
  });
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ product: "retail" }), searchParams: Promise.resolve({}) }));
  assert.match(html, /private draft, not a live listening channel/);
  assert.doesNotMatch(html, /<audio|private-stream|SYNTHETIC_PRIVATE_URL|Other channels|Open secure stream directly|Private Retail draft/);
  await assert.rejects(() => page.default({ params: Promise.resolve({ product: "retail" }),
    searchParams: Promise.resolve({ stationId: draft.id }) }), /NOT_FOUND/);
});

test("Retail Listen retains ordinary channel and Online Test Radio listening", async () => {
  const ordinary = managed({ id: "ordinary-retail", slug: "ordinary-retail", name: "Ordinary Retail", status: "ACTIVE",
    streamConfig: { streamUrl: "https://ordinary.example.test/live" }, publicPlayerEnabled: false });
  const online = managed({ id: "test-radio", productFamily: "ONLINE", name: "Test Radio", status: "ACTIVE",
    streamConfig: { streamUrl: "https://radio.example.test/live" }, publicPlayerEnabled: false });
  let stations = [managed({ name: "Private Retail draft", streamConfig: { streamUrl: "https://managed.example.test/private" } }), ordinary];
  const page = await route("app/dashboard/listen/[product]/page.js", {
    "@/lib/prisma": { prisma: { station: { findMany: async () => stations } } },
    "@/lib/pillar-audio.mjs": pillarAudio,
    "@/lib/subscriber-product-access": { requireSubscriberProduct: async () => ({ context: { membership: { organisationId } } }) },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } }
  });
  const retailHtml = renderToStaticMarkup(await page.default({ params: Promise.resolve({ product: "retail" }), searchParams: Promise.resolve({}) }));
  assert.match(retailHtml, /Ordinary Retail/);
  assert.match(retailHtml, /https:\/\/ordinary.example.test\/live/);
  assert.doesNotMatch(retailHtml, /managed.example.test|Private Retail draft/);
  stations = [online];
  const onlineHtml = renderToStaticMarkup(await page.default({ params: Promise.resolve({ product: "online" }), searchParams: Promise.resolve({}) }));
  assert.match(onlineHtml, /Test Radio/);
  assert.match(onlineHtml, /https:\/\/radio.example.test\/live/);
});

test("exact managed Retail station detail and setup pages never claim the connection is live", async () => {
  const protectedStation = managed({ name: "Private Retail draft", description: "Synthetic draft", status: "ACTIVE",
    streamConfig: { streamUrl: "https://managed.example.test/private?credential=SYNTHETIC" }, publicPlayerEnabled: true });
  const context = { membership: { organisationId, organisation: { subscription: {} } } };
  const productChecks = [];
  const shared = {
    "@/lib/auth": { getActiveOrganisationContext: async () => context },
    "@/lib/prisma": { prisma: { station: { findFirst: async () => protectedStation } } },
    "@/lib/subscriber-product-access": { requireSubscriberProduct: async product => { productChecks.push(product); return {}; } },
    "@/app/components/SkipLink": { __esModule: true, default: () => React.createElement("a", { href: "#main-content" }, "Skip") },
    "@/app/components/ContextHelp": { __esModule: true, default: () => null },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }
  };
  const details = await route("app/stations/[stationId]/page.js", {
    ...shared,
    "@/lib/product-access.mjs": { subscriberProductForStationFamily: fail("generic product mapping") },
    "@/lib/private-preview-online-draft.mjs": { onlineDraftSubscription: fail("onlineDraftSubscription") },
    "@/lib/test-radio-subscriber-access.mjs": { resolveTestRadioSubscriberWorkspace: fail("Test Radio resolver") }
  });
  const setup = await route("app/stations/[stationId]/setup/page.js", shared);
  for (const page of [details.default, setup.default]) {
    const html = renderToStaticMarkup(await page({ params: Promise.resolve({ stationId: protectedStation.id }) }));
    assert.match(html, /PRIVATE CONNECTION DRAFT/);
    assert.match(html, /not available for subscriber listening|not a subscriber listening channel/);
    assert.doesNotMatch(html, /managed.example.test|SYNTHETIC|Your public player is live|Streaming configured|Manage public player|Review public player settings/);
  }
  assert.deepEqual(productChecks, ["RETAIL", "RETAIL"]);
});

test("public playback service rejects exact managed Retail draft before issuing listening authority", async () => {
  const service = await route("lib/public-player-service.js", {
    "./player-manifest.mjs": { buildPlayerManifest: fail("buildPlayerManifest") },
    "./player-programming": { resolvePlayerProgramming: fail("resolvePlayerProgramming") },
    "./listener-analytics.mjs": { createListenerTelemetryToken: fail("createListenerTelemetryToken") },
    "./music-mode-playback.mjs": { playableLiveMusicModeEntries: fail("playableLiveMusicModeEntries") },
    "./entitlements.mjs": { resolveEntitlements: () => ({ outputEnabled: true }) },
    "./retail-stream-draft-boundary.mjs": { isManagedRetailStreamDraftStation },
    "./public-player.mjs": { appendPublicPlaybackToken: fail("appendPublicPlaybackToken"), claimPublicListenerLease: fail("claimPublicListenerLease"),
      PUBLIC_LISTENER_HEARTBEAT_SECONDS: 30, publicNowPlaying: fail("publicNowPlaying"), releasePublicListenerLease: fail("releasePublicListenerLease"),
      verifyPublicPlaybackToken: fail("verifyPublicPlaybackToken"), isPublicPlaybackTokenActive: fail("isPublicPlaybackTokenActive") }
  });
  let station = managed({ status: "ACTIVE", publicPlayerEnabled: true, organisation: { subscription: {} },
    streamConfig: { streamUrl: "https://managed.example.test/private" } });
  const database = { station: { findFirst: async () => station } };
  assert.equal(await service.loadPublicPlayerStation(database, station.slug), null);
  const denied = await service.authorizePublicPlayback(database, { slug: station.slug, token: "synthetic-token" });
  assert.equal(denied.status, 404);
  station = { ...station, slug: "ordinary-retail" };
  assert.equal(await service.loadPublicPlayerStation(database, station.slug), station);
});

test("public-player publishing denies the managed draft before product mapping or writes", async () => {
  let writes = 0;
  const module = await route("app/api/stations/[stationId]/public-player/route.js", {
    "@/lib/prisma": { prisma: { station: { findUnique: async () => managed({ status: "ACTIVE", streamConfig: { streamUrl: "https://managed.example.test/private" } }) },
      $transaction: async () => { writes++; } } },
    "@/lib/access-control": { requireOrganisationProductAccess: fail("requireOrganisationProductAccess"), ORGANISATION_MANAGER_ROLES: ["OWNER"] },
    "@/lib/public-player.mjs": { normalizePublicPlayerSettings: fail("normalizePublicPlayerSettings") },
    "@/lib/product-access.mjs": { subscriberProductForStationFamily: fail("subscriberProductForStationFamily") }
  });
  const result = await module.PATCH(new Request("https://example.test/api/stations/station-retail-fixture/public-player", {
    method: "PATCH", body: JSON.stringify({ enabled: true })
  }), params);
  assert.equal(result.status, 409); assert.equal(writes, 0);
});

test("public listening and metadata routes check the same managed identity", async () => {
  const protectedStation = managed({ name: "Private Retail draft", status: "ACTIVE", publicPlayerEnabled: true });
  const listening = await route("app/listen/[slug]/page.js", {
    "@/lib/prisma": { prisma: { station: { findFirst: async () => protectedStation } } },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/app/components/PublicRadioPlayer": { __esModule: true, default: fail("PublicRadioPlayer") },
    "@/app/components/PwaLifecycle": { __esModule: true, default: fail("PwaLifecycle") }
  });
  assert.equal((await listening.generateMetadata({ params: Promise.resolve({ slug: protectedStation.slug }) })).title, "Station unavailable | Ruvanas");
  await assert.rejects(() => listening.default({ params: Promise.resolve({ slug: protectedStation.slug }) }), /NOT_FOUND/);
  const publicStation = await route("app/api/public/stations/[slug]/route.js", {
    "@/lib/prisma": { prisma: { station: { findFirst: async () => protectedStation } } }
  });
  const result = await publicStation.GET(new Request("https://example.test/api/public/stations/private"), { params: { slug: protectedStation.slug } });
  assert.equal(result.status, 404);
});
