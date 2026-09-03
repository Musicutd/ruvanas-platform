import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildAdminNavigation,
  buildSubscriberNavigation,
  resolveDashboardNextAction
} from "../lib/user-experience-navigation.mjs";

test("subscriber navigation is organised by tasks and hides unavailable products", () => {
  const navigation = buildSubscriberNavigation({
    entitlements: {
      serviceEnabled: true,
      schoolRadioEnabled: false,
      retailMediaEnabled: true,
      digitalSignageEnabled: false
    },
    firstStationId: "station-1"
  });

  assert.deepEqual(navigation.map((section) => section.label), [
    "Run your radio",
    "Create and schedule",
    "Monitor and report"
  ]);
  const items = navigation.flatMap((section) => section.items);
  assert.equal(items.find((item) => item.id === "station").href, "/stations/station-1");
  assert.ok(items.some((item) => item.id === "retail"));
  assert.ok(!items.some((item) => item.id === "school"));
  assert.ok(!items.some((item) => item.id === "signage"));
});

test("subscriber navigation sends a new organisation to station creation", () => {
  const navigation = buildSubscriberNavigation({ entitlements: {}, firstStationId: null });
  const station = navigation.flatMap((section) => section.items).find((item) => item.id === "station");
  assert.equal(station.href, "/stations/new");
  assert.equal(station.label, "Create your station");
});

test("dashboard next action follows the subscriber setup journey", () => {
  assert.equal(resolveDashboardNextAction({ serviceEnabled: false }).code, "SERVICE_ATTENTION");
  assert.equal(resolveDashboardNextAction({ stationCount: 0 }).code, "CREATE_STATION");
  assert.equal(resolveDashboardNextAction({ stationCount: 1, configuredPlayerCount: 0 }).code, "SET_UP_PLAYER");
  assert.equal(resolveDashboardNextAction({ stationCount: 1, configuredPlayerCount: 1, activePlayerStreams: 0 }).code, "BRING_PLAYER_ONLINE");
  assert.equal(resolveDashboardNextAction({ stationCount: 1, configuredPlayerCount: 1, activePlayerStreams: 1 }).code, "MONITOR_SERVICE");
});

test("support navigation excludes super-admin controls", () => {
  const supportItems = buildAdminNavigation("SUPPORT").flatMap((section) => section.items);
  const superAdminItems = buildAdminNavigation("SUPER_ADMIN").flatMap((section) => section.items);

  assert.ok(supportItems.some((item) => item.href === "/admin/organisations"));
  assert.ok(supportItems.some((item) => item.href === "/admin/compliance"));
  assert.ok(!supportItems.some((item) => item.href === "/admin/billing"));
  assert.ok(!supportItems.some((item) => item.href === "/admin/recovery"));
  assert.ok(superAdminItems.some((item) => item.href === "/admin/billing"));
  assert.ok(superAdminItems.some((item) => item.href === "/admin/recovery"));
});

test("admin navigation keeps each destination unique", () => {
  const hrefs = buildAdminNavigation("SUPER_ADMIN")
    .flatMap((section) => section.items)
    .map((item) => item.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("subscriber command centre keeps shortcuts permission-filtered and accessible", async () => {
  const [dashboard, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/dashboard.module.css", import.meta.url), "utf8")
  ]);

  assert.match(dashboard, /allNavigationItems\.find/);
  assert.match(dashboard, /aria-label="Portal navigation"/);
  assert.match(dashboard, /<progress/);
  assert.match(dashboard, /SERVICE PULSE/);
  assert.match(dashboard, /QUICK ACTIONS/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /:focus-visible/);
});

test("admin command centre uses role-filtered tabs and accessible interactive analytics", async () => {
  const [layout, tabs, dashboard, service, exportRoute, proofOfPlay, styles] = await Promise.all([
    readFile(new URL("../app/admin/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/AdminNavigationTabs.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-analytics-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/analytics/summary/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/proof-of-play/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-dashboard.module.css", import.meta.url), "utf8")
  ]);

  assert.match(layout, /buildAdminNavigation\(adminUser\.role\)/);
  assert.match(layout, /<AdminNavigationTabs navigation=\{navigation\}/);
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /aria-selected/);
  assert.match(service, /analyticsHourlyAggregate\.groupBy/);
  assert.match(dashboard, /ADMIN_ANALYTICS_RANGES\.map/);
  assert.match(dashboard, /api\/admin\/analytics\/summary/);
  assert.match(dashboard, /Operational action centre/);
  assert.match(dashboard, /Top organisations/);
  assert.match(dashboard, /Top stations/);
  assert.match(dashboard, /role="img"/);
  assert.match(dashboard, /<title id="playback-chart-title"/);
  assert.match(exportRoute, /requirePlatformAdmin/);
  assert.match(exportRoute, /access\.user\.role === "SUPER_ADMIN"/);
  assert.match(exportRoute, /ADMIN_MANAGEMENT_REPORT_DOWNLOADED/);
  assert.match(exportRoute, /private, no-store/);
  assert.match(proofOfPlay, /normaliseAdminAnalyticsRange\(params\?\.range\)/);
  assert.match(proofOfPlay, /aria-label=\{periodLabel\}/);
  assert.match(styles, /@media \(max-width: 650px\)/);
});

test("subscriber service insights are visual, actionable, responsive, and tenant-scoped", async () => {
  const [client, service, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/analytics/OperationalAnalyticsClient.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/operational-analytics-service.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/analytics/subscriber-insights.module.css", import.meta.url), "utf8")
  ]);

  assert.match(client, /title="Service insights"/);
  assert.match(client, /SUBSCRIBER_INSIGHT_RANGES\.map/);
  assert.match(client, /role="tablist"/);
  assert.match(client, /aria-selected/);
  assert.match(client, /role="img"/);
  assert.match(client, /<title id="subscriber-chart-title"/);
  assert.match(client, /subscriberInsightActions/);
  assert.match(service, /analyticsHourlyAggregate\.groupBy/);
  assert.match(service, /where: \{ organisationId, bucketStart:/);
  assert.match(service, /buildSubscriberBreakdowns/);
  assert.match(service, /buildStationBreakdown/);
  assert.match(styles, /@media \(max-width: 600px\)/);
});
