import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GENERAL_STATION_MANAGEMENT_WHERE } from "../lib/general-station-boundary.mjs";

const routeSource = (path) => readFile(new URL(`../app/api/stations/[stationId]/${path}/route.js`, import.meta.url), "utf8");

test("generic station management excludes Corrections and legacy private-rights or facility stations", () => {
  assert.deepEqual(GENERAL_STATION_MANAGEMENT_WHERE, {
    OR: [{ productFamily: null }, { productFamily: { not: "CORRECTIONS" } }],
    channels: { none: { OR: [
      { musicRightsUse: "CORRECTIONS_RADIO" },
      { zoneAssignments: { some: { zone: { location: { correctionsFacility: { isNot: null } } } } } }
    ] } }
  });
});

test("every subscriber station-management API applies the private-station boundary before access", async () => {
  for (const path of [
    "public-player",
    "website",
    "website/domains",
    "website/domains/[domainId]",
    "listener-requests",
    "listener-requests/[requestId]"
  ]) {
    const source = await routeSource(path);
    assert.match(source, /import \{ GENERAL_STATION_MANAGEMENT_WHERE \} from "@\/lib\/general-station-boundary\.mjs"/, path);
    assert.match(source, /findFirst\(\{ where: \{[^\n]*GENERAL_STATION_MANAGEMENT_WHERE/, path);
    assert.match(source, /if \(!(?:station|domain|requestRecord)\) return NextResponse\.json\([^\n]*status: 404/, path);
  }
});

test("Organisations workspace reuses the facility-aware station boundary for reads and writes", async () => {
  const source = await readFile(new URL("../app/api/organisations/workspace/route.js", import.meta.url), "utf8");
  assert.match(source, /import \{ GENERAL_STATION_MANAGEMENT_WHERE \} from "@\/lib\/general-station-boundary\.mjs"/);
  assert.match(source, /publicOrganisationsStationWhere\s*=\s*\{[\s\S]*?channels: GENERAL_STATION_MANAGEMENT_WHERE\.channels/);
  assert.doesNotMatch(source, /channels: \{ none: \{ musicRightsUse: "CORRECTIONS_RADIO" \} \}/);
  assert.match(source, /station: publicOrganisationsStationWhere/);
  assert.match(source, /\.\.\.publicOrganisationsStationWhere/);
});

test("stream setup retains its separate Super Admin-only authority", async () => {
  const source = await routeSource("setup");
  assert.match(source, /requirePlatformAdmin\(\)/);
  assert.match(source, /access\.user\.role !== "SUPER_ADMIN"/);
});
