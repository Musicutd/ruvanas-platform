import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRetailMusicAreas, retailMusicSelection } from "../lib/retail-music-setup.mjs";

const zone = { id: "zone-1", type: "ZONE", locationName: "Main shop", name: "Sales floor", channelId: "channel-1" };

test("Retail music setup renders safely before the first API response", () => {
  assert.deepEqual(buildRetailMusicAreas(null), []);
  assert.deepEqual(buildRetailMusicAreas({}), []);
  assert.deepEqual(retailMusicSelection(null, null), { modeId: "", playbackPolicy: "FOLLOW_LOCATION_HOURS" });
});

test("Retail quick setup lists listening zones and blocks shared channels", () => {
  const areas = buildRetailMusicAreas({
    targets: [{ id: "location-1", type: "LOCATION", name: "Main shop" }, zone],
    channels: [{ id: "channel-1", assignments: ["Main shop / Sales floor", "Main shop / Cafe"] }]
  });
  assert.equal(areas.length, 1);
  assert.equal(areas[0].label, "Main shop / Sales floor");
  assert.match(areas[0].blocker, /more than one area/);
});

test("Retail quick setup requires exactly one assigned channel", () => {
  const [unassigned] = buildRetailMusicAreas({ targets: [{ ...zone, channelId: null }] });
  const [ready] = buildRetailMusicAreas({ targets: [zone], channels: [{ id: "channel-1", assignments: ["Main shop / Sales floor"] }] });
  assert.match(unassigned.blocker, /needs one assigned channel/);
  assert.equal(ready.blocker, null);
});

test("Retail quick setup keeps an existing playable choice and shop-hour policy", () => {
  const area = { channel: { autoDjPolicy: { defaultMusicModeId: "mode-2", playbackPolicy: "RUN_24_7" } } };
  const musicModes = [{ id: "mode-1", playableTrackCount: 2 }, { id: "mode-2", playableTrackCount: 1 }];
  assert.deepEqual(retailMusicSelection(area, musicModes), { modeId: "mode-2", playbackPolicy: "RUN_24_7" });
  assert.deepEqual(retailMusicSelection(null, musicModes), { modeId: "mode-1", playbackPolicy: "FOLLOW_LOCATION_HOURS" });
});

test("Retail music page is product guarded and reuses existing programming authority", async () => {
  const [page, client] = await Promise.all([
    readFile(new URL("../app/dashboard/retail/music/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/retail/music/RetailMusicSetup.js", import.meta.url), "utf8")
  ]);
  assert.match(page, /requireSubscriberProduct\("RETAIL"\)/);
  assert.match(client, /\/api\/programming\/autodj/);
  assert.match(client, /targetType: "ZONE"/);
  assert.match(client, /rightsUse: "RETAIL_RADIO"/);
  assert.match(client, /Published schedules take priority/);
  assert.match(client, /areas\.length === 1/);
  assert.match(page, /Choose music for your shop/);
});
