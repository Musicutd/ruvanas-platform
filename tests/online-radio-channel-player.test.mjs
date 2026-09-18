import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Super Admin can prepare a zone-free Online Radio channel before Centova has audio", async () => {
  const [route, form, migration] = await Promise.all([
    source("../app/api/admin/stations/[stationId]/prepare-channel/route.js"),
    source("../app/admin/stations/[stationId]/setup/AdminStationSetupForm.js"),
    source("../prisma/migrations/20261120000000_online_radio_outbound_source/migration.sql")
  ]);
  assert.match(route, /role !== "SUPER_ADMIN"/);
  assert.match(route, /productFamily !== "ONLINE"/);
  assert.match(route, /runSerializableTransaction/);
  assert.match(route, /ONLINE_RADIO_CHANNEL_PREPARED/);
  assert.doesNotMatch(route, /probeStationStream/);
  assert.match(form, /Prepare Online Radio channel/);
  assert.match(migration, /"sourcePort" INTEGER/);
  assert.match(migration, /"outboundAutoDjEnabled" BOOLEAN NOT NULL DEFAULT false/);
});

test("Online Radio public player is a station stream and does not need a retail zone", async () => {
  const [service, settings, live, media] = await Promise.all([
    source("../lib/public-player-service.js"),
    source("../app/api/stations/[stationId]/public-player/route.js"),
    source("../app/api/public/player/[slug]/live/[sourceId]/route.js"),
    source("../app/api/public/player/[slug]/media/[mediaAssetId]/route.js")
  ]);
  assert.match(service, /station\?\.productFamily === "ONLINE"/);
  assert.match(service, /online: true, player: null/);
  assert.match(service, /if \(target\.online\)/);
  assert.match(service, /fallbackStream:/);
  assert.match(settings, /station\.productFamily === "ONLINE" \? \{\} : \{ zoneAssignments:/);
  assert.match(live, /if \(access\.target\.online\)/);
  assert.match(media, /if \(access\.target\.online\)/);
});
