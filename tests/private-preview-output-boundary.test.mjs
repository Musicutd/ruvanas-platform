import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { PREVIEW_ONLINE_DRAFT_PLAN, PREVIEW_TESTER_PLAN } from "../lib/private-preview-account-policy.mjs";
import { eligibleOnlineRadioRotation, eligibleScheduledOnlineRotation } from "../lib/online-radio-output.mjs";
import { claimPublicListenerLease } from "../lib/public-player.mjs";

const instant = new Date("2026-10-17T12:00:00.000Z");
const subscription = (plan = PREVIEW_ONLINE_DRAFT_PLAN, overrides = {}) => ({ status: "TRIAL", plan: { ...plan }, onlineRadioEnabled: true, currentPeriodEnd: new Date("2026-11-01"), ...overrides });
const commercialPlan = { ...PREVIEW_TESTER_PLAN, code: "ONLINE_1", name: "Online 1", tierNumber: 1, productFamily: "ONLINE", onlineRadioEnabled: true };

// Use the actual service module with only framework/database imports replaced.
// This exercises its production guard without a live Next server or database.
const moduleUrl = (source) => `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
async function isolatedService(relativePath, stubs = {}) {
  const location = new URL(relativePath, import.meta.url);
  const source = await readFile(location, "utf8");
  const rewritten = source.replace(/from\s+(["'])([^"']+)\1/g, (whole, quote, specifier) => {
    if (stubs[specifier]) return `from ${JSON.stringify(moduleUrl(stubs[specifier]))}`;
    if (specifier.startsWith("@/")) return `from ${JSON.stringify(new URL(`../${specifier.slice(2)}`, import.meta.url).href)}`;
    if (specifier.startsWith(".")) return `from ${JSON.stringify(new URL(specifier, location).href)}`;
    return whole;
  });
  return import(moduleUrl(rewritten));
}

test("exact draft plan enables only draft mode; every reserved preview code blocks output independently", () => {
  const editable = resolveEntitlements(subscription(), instant);
  assert.equal(editable.serviceEnabled, true);
  assert.equal(editable.onlineRadioEnabled, true);
  assert.equal(editable.sandboxDraftOnly, true);
  assert.equal(editable.outputEnabled, false);
  assert.equal(editable.storageLimitGb, 0);
  assert.equal(editable.licensedMusicCatalogueEnabled, false);
  const readOnly = resolveEntitlements(subscription(PREVIEW_TESTER_PLAN), instant);
  assert.equal(readOnly.sandboxDraftOnly, false);
  assert.equal(readOnly.outputEnabled, false);
  for (const code of ["PRIVATE_PREVIEW_ONLINE_DRAFT_V1", " private_preview_online_draft_v1 ", "PRIVATE_PREVIEW_UNKNOWN_VERSION"]) {
    const malformed = resolveEntitlements(subscription({ ...commercialPlan, code }), instant);
    assert.equal(malformed.sandboxDraftOnly, false, "a code or arbitrary flag cannot grant editable access");
    assert.equal(malformed.outputEnabled, false, "malformed reserved plans must not become commercial output");
  }
});

test("the output boundary does not redefine commercial subscription or billing behaviour", () => {
  for (const status of ["TRIAL", "ACTIVE", "CANCELLED"]) {
    const entitlements = resolveEntitlements(subscription(commercialPlan, { status, sandboxDraftOnly: true, outputEnabled: false }), instant);
    assert.equal(entitlements.outputEnabled, true, "billing/service enforcement remains in its existing gates");
    assert.equal(entitlements.sandboxDraftOnly, false);
    assert.equal(entitlements.serviceEnabled, status !== "CANCELLED");
  }
});

test("preview output stays blocked after expiry or a complimentary-plan override", () => {
  assert.equal(resolveEntitlements(subscription(PREVIEW_ONLINE_DRAFT_PLAN, { currentPeriodEnd: new Date("2026-01-01") }), instant).outputEnabled, false);
  const overridden = subscription(PREVIEW_ONLINE_DRAFT_PLAN, {
    complimentaryAccessActive: true, complimentaryPlanName: "Synthetic online", complimentaryPlanCode: "ONLINE_1",
    complimentaryProductFamily: "ONLINE", complimentaryTierNumber: 1, complimentaryStationLimit: 1,
    complimentaryStorageLimitGb: 1, complimentaryListenerLimit: 1, complimentaryMaxBitrateKbps: 128
  });
  assert.equal(resolveEntitlements(overridden, instant).outputEnabled, false);
});

test("encoder rotation guards reject preview output before processing configured station or schedule fields", () => {
  const entitlements = resolveEntitlements(subscription(), instant);
  const unsafeStation = { get productFamily() { throw new Error("Station output preparation must not start"); } };
  assert.deepEqual(eligibleOnlineRadioRotation(unsafeStation, entitlements, instant), { ready: false, reason: "OUTPUT_NOT_PERMITTED" });
  assert.deepEqual(eligibleScheduledOnlineRotation(unsafeStation, entitlements, {}, [], instant), { ready: false, reason: "OUTPUT_NOT_PERMITTED" });
});

test("even an accidentally active public sandbox station cannot allocate a listener lease or token", async () => {
  const database = { $transaction() { throw new Error("No output lease transaction may run"); } };
  const station = { id: "station-a", productFamily: "ONLINE", status: "ACTIVE", publicPlayerEnabled: true,
    listenerLimit: 1, organisation: { subscription: subscription() } };
  const decision = await claimPublicListenerLease(database, {
    station, channelId: "channel-a", sessionId: "11111111-1111-4111-8111-111111111111", instant, secret: "synthetic-secret-for-unit-tests-only"
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
  assert.equal(decision.playbackToken, undefined);
});

test("public station lookup rejects preview organisations before token-authorized stream access", async () => {
  const service = await isolatedService("../lib/public-player-service.js", {
    "./player-programming": "export async function resolvePlayerProgramming() { throw new Error('Not used by lookup test'); }"
  });
  const station = { id: "station-a", organisation: { subscription: subscription() } };
  const db = { station: { findFirst: async () => station } };
  assert.equal(await service.loadPublicPlayerStation(db, "synthetic-station"), null);
  station.organisation.subscription = subscription(commercialPlan);
  assert.equal(await service.loadPublicPlayerStation(db, "synthetic-station"), station);
});

test("actual public website helper requires both an active service and permission to deliver output", async () => {
  const service = await isolatedService("../lib/station-website-service.js", {
    "@/lib/prisma": "export const prisma = {};",
    "@/lib/public-player-service": "export async function loadPublicPlayerStation() { return null; } export function publicPlayerTarget() { return null; }",
    "@/lib/player-programming": "export async function resolvePlayerProgramming() { throw new Error('Not used by website test'); }"
  });
  const station = { productFamily: "ONLINE", stationWebsiteEnabled: true, organisation: { subscription: subscription() }, podcastSeries: [] };
  const db = { station: { findFirst: async () => station } };
  assert.equal(await service.loadPublicStationWebsiteBySlug("synthetic-station", db), null);
  for (const status of ["TRIAL", "ACTIVE"]) {
    station.organisation.subscription = subscription(commercialPlan, { status });
    assert.notEqual(await service.loadPublicStationWebsiteBySlug("synthetic-station", db), null, status);
  }
  for (const status of ["CANCELLED", "SUSPENDED"]) {
    station.organisation.subscription = subscription(commercialPlan, { status });
    assert.equal(resolveEntitlements(station.organisation.subscription).outputEnabled, true,
      "non-preview output permission must not substitute for the billing/service gate");
    assert.equal(await service.loadPublicStationWebsiteBySlug("synthetic-station", db), null, status);
  }
  station.organisation.subscription = subscription({ ...commercialPlan, active: false });
  assert.equal(await service.loadPublicStationWebsiteBySlug("synthetic-station", db), null, "inactive commercial plan");
  station.organisation.subscription = subscription({ ...commercialPlan, code: "PRIVATE_PREVIEW_UNKNOWN_VERSION" });
  assert.equal(await service.loadPublicStationWebsiteBySlug("synthetic-station", db), null, "reserved preview output stays closed");
});

test("device-cookie delivery and encoder worker enforce the canonical boundary before source access", async () => {
  const player = await readFile(new URL("../lib/player-auth.js", import.meta.url), "utf8");
  const worker = await readFile(new URL("../scripts/online-radio-encoder-worker.mjs", import.meta.url), "utf8");
  assert.match(player, /resolveEntitlements\(player\.organisation\?\.subscription\)\.outputEnabled \? player : null/);
  const outputGuard = worker.indexOf('if (!entitlements.outputEnabled) return { ready: false, reason: "OUTPUT_NOT_PERMITTED" }');
  assert.ok(outputGuard > worker.indexOf("const entitlements = resolveEntitlements"));
  assert.ok(outputGuard < worker.indexOf("const genres = await prisma.mediaGenre.findMany"));
  assert.ok(outputGuard < worker.indexOf("const object = await storage.send"));
});
