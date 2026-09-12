import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { faithLiveServiceState, healthFaithProduct, assertNoSensitiveHealthFields, normalizeHealthSongRequest } from "../lib/health-faith-core.mjs";
import { musicTrackEligibility, MUSIC_RIGHTS_USES } from "../lib/media-library-pro.mjs";
import { PUBLIC_PLAN_CATALOGUE, publicPlansForProduct } from "../lib/product-plan-catalogue.mjs";
import { studioDestinationAvailability, studioWorkflowPath } from "../lib/studio-product-handoff.mjs";
import { BETA_PRODUCTS } from "../lib/beta-operations.mjs";
import { subscriberProductForStationFamily } from "../lib/product-access.mjs";

test("Health and Faith add exactly ten plans to the authoritative 25-plan catalogue", () => {
  assert.equal(PUBLIC_PLAN_CATALOGUE.length, 30);
  assert.deepEqual(publicPlansForProduct("HEALTH").map((plan) => [plan.code, plan.monthlyPriceCents, plan.licensedMusicCatalogueLevel]), [
    ["HEALTH_START", 2900, "NONE"], ["HEALTH_CONNECT", 7900, "NONE"], ["HEALTH_PRO", 17900, "FOCUSED"], ["HEALTH_NETWORK", 44900, "PROFESSIONAL"], ["HEALTH_ENTERPRISE", 99900, "PREMIUM"]
  ]);
  assert.deepEqual(publicPlansForProduct("FAITH").map((plan) => [plan.code, plan.monthlyPriceCents, plan.licensedMusicCatalogueLevel]), [
    ["FAITH_START", 1990, "NONE"], ["FAITH_CONNECT", 4900, "NONE"], ["FAITH_PRO", 9900, "FOCUSED"], ["FAITH_MINISTRY", 19900, "PROFESSIONAL"], ["FAITH_NETWORK", 49900, "PREMIUM"]
  ]);
  assert.equal(publicPlansForProduct("HEALTH")[4].enterpriseContactRequired, true);
  assert.equal(publicPlansForProduct("FAITH")[4].enterpriseContactRequired, true);
});

test("product definitions preserve separate capability, rights, target and dashboard identities", () => {
  assert.deepEqual(healthFaithProduct("health"), { key: "HEALTH", label: "Ruvanas Health", capability: "healthRadioEnabled", rightsUse: "HEALTH_RADIO", targetType: "HEALTH_CHANNEL", route: "/dashboard/health", siteLabel: "hospital or health site", areaLabel: "ward, department or wellbeing area" });
  assert.equal(healthFaithProduct("faith").capability, "faithRadioEnabled");
  assert.ok(MUSIC_RIGHTS_USES.includes("HEALTH_RADIO"));
  assert.ok(MUSIC_RIGHTS_USES.includes("FAITH_RADIO"));
  assert.equal(subscriberProductForStationFamily("HEALTH"), "HEALTH");
  assert.equal(subscriberProductForStationFamily("FAITH"), "FAITH");
  assert.equal(subscriberProductForStationFamily(null), "ONLINE");
});

test("Health request normalization keeps only non-clinical minimal data", () => {
  assert.deepEqual(normalizeHealthSongRequest({ trackQuery: "  Blue in Green  ", displayName: " Pat ", diagnosis: "discard" }), { trackQuery: "Blue in Green", displayName: "Pat" });
  assert.equal(assertNoSensitiveHealthFields({ trackQuery: "Song" }), true);
  assert.throws(() => assertNoSensitiveHealthFields({ diagnosis: "private" }), /cannot collect clinical/);
});

test("Faith live service state makes AutoDJ return and missing fallback explicit", () => {
  const startsAt = "2026-09-12T10:00:00Z";
  const endsAt = "2026-09-12T11:00:00Z";
  assert.deepEqual(faithLiveServiceState({ startsAt, endsAt, now: "2026-09-12T09:00:00Z", fallbackReady: true }), { state: "SCHEDULED", next: "LIVE_HANDOFF" });
  assert.deepEqual(faithLiveServiceState({ startsAt, endsAt, now: "2026-09-12T10:30:00Z", fallbackReady: false }), { state: "LIVE", next: "FALLBACK_REQUIRED" });
  assert.deepEqual(faithLiveServiceState({ startsAt, endsAt, now: "2026-09-12T11:30:00Z", fallbackReady: true }), { state: "ENDED", next: "AUTODJ_RESUMED" });
});

test("catalogue music remains product-use, approval, tier, genre, territory and date gated", () => {
  const track = { status: "READY", licenceStartsAt: null, licenceExpiresAt: new Date("2027-01-01"), rightsReviewStatus: "APPROVED", permittedUses: ["HEALTH_RADIO"], permittedTerritories: "MT", mediaAsset: { status: "READY", mediaType: "MUSIC", libraryType: "RUVANAS_CATALOGUE", organisationId: null, licensedCatalogue: true, genres: [{ mediaGenre: { slug: "pop" } }] } };
  const options = { requiredUse: "HEALTH_RADIO", territory: "MT", licensedCatalogueLevel: "FOCUSED", configuredGenres: [{ code: "POP", minimumLevel: "FOCUSED", active: true }], instant: new Date("2026-09-12") };
  assert.equal(musicTrackEligibility(track, options).playable, true);
  assert.equal(musicTrackEligibility(track, { ...options, requiredUse: "FAITH_RADIO" }).reason, "USE_NOT_PERMITTED");
  assert.equal(musicTrackEligibility(track, { ...options, territory: "GB" }).reason, "RIGHTS_NOT_APPROVED");
});

test("Studio and Beta preserve Health and Faith while exposing the sixth product", () => {
  const destinations = studioDestinationAvailability({ entitlements: { healthRadioEnabled: true, faithRadioEnabled: true }, project: {} });
  assert.equal(destinations.find((item) => item.key === "HEALTH_PODCAST").available, true);
  assert.equal(destinations.find((item) => item.key === "FAITH_SERMON").available, true);
  assert.equal(studioWorkflowPath({ destination: "FAITH_SERMON", promoVersionId: "promo", mediaAssetId: "asset 1" }), "/dashboard/podcasts?product=FAITH&mediaAssetId=asset%201");
  assert.deepEqual(BETA_PRODUCTS.map((item) => item.value), ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"]);
});

test("new routes derive tenant access server-side and keep unsafe domains out of scope", async () => {
  const [channelRoute, healthPage, faithPage, podcastRoute, requestQueueRoute, websiteRoute, stationLayout, migration] = await Promise.all([
    readFile(new URL("../app/api/product-channels/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/health/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/faith/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/podcasts/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/listener-requests/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stations/[stationId]/website/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/stations/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261112010000_health_faith_expansion/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(channelRoute, /getActiveOrganisationContext/);
  assert.doesNotMatch(channelRoute, /body\.organisationId/);
  assert.match(channelRoute, /HEALTH_CHANNEL_CREATED|FAITH_CHANNEL_CREATED|\$\{product\.key\}_CHANNEL_CREATED/);
  assert.match(healthPage, /without storing clinical records/);
  assert.match(faithPage, /without prescribing doctrine/);
  assert.match(podcastRoute, /audiencePolicy !== "PUBLIC"/);
  assert.match(requestQueueRoute, /subscriberProductForStationFamily\(station\.productFamily\)/);
  assert.match(websiteRoute, /subscriberProductForStationFamily\(station\.productFamily\)/);
  assert.match(stationLayout, /"ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"/);
  assert.match(migration, /Ruvanas Health QA/);
  assert.match(migration, /Ruvanas Faith QA/);
  assert.doesNotMatch(`${healthPage}\n${faithPage}\n${channelRoute}`, /diagnosis field|prayer record/i);
});
