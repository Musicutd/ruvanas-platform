import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GENERAL_STUDIO_CHANNEL_WHERE } from "../lib/studio-general-output-boundary.mjs";
import { GENERAL_SIMPLE_PLAYLIST_WHERE } from "../lib/subscriber-simple-private-boundary.mjs";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("ordinary simple playlists exclude both explicit Inside rights and historical private-channel events", () => {
  assert.deepEqual(GENERAL_SIMPLE_PLAYLIST_WHERE.rightsUse, { not: "CORRECTIONS_RADIO" });
  assert.deepEqual(GENERAL_SIMPLE_PLAYLIST_WHERE.subscriberEvents, {
    none: { channel: { isNot: GENERAL_STUDIO_CHANNEL_WHERE } }
  });
  assert.equal(Object.hasOwn(GENERAL_SIMPLE_PLAYLIST_WHERE.subscriberEvents.none, "cancelledAt"), false);
});

test("all simple-playlist read and write entry points use the private-output boundary", async () => {
  const [collection, events, eventId, playlistId, nonstop] = await Promise.all([
    source("../app/api/programming/simple/route.js"),
    source("../app/api/programming/simple/events/route.js"),
    source("../app/api/programming/simple/events/[eventId]/route.js"),
    source("../app/api/programming/simple/[playlistId]/route.js"),
    source("../app/api/programming/simple/nonstop/route.js")
  ]);
  assert.match(collection, /GENERAL_STUDIO_CHANNEL_WHERE/);
  assert.match(collection, /GENERAL_SIMPLE_PLAYLIST_WHERE/);
  assert.match(events, /GENERAL_STUDIO_CHANNEL_WHERE/);
  assert.match(events, /GENERAL_SIMPLE_PLAYLIST_WHERE/);
  assert.match(eventId, /GENERAL_STUDIO_CHANNEL_WHERE/);
  assert.match(eventId, /GENERAL_SIMPLE_PLAYLIST_WHERE/);
  assert.match(playlistId, /GENERAL_SIMPLE_PLAYLIST_WHERE/);
  assert.match(nonstop, /GENERAL_STUDIO_CHANNEL_WHERE/);
  assert.match(nonstop, /previous\?\.rightsUse === "CORRECTIONS_RADIO"/);
  assert.match(nonstop, /previous\?\.targetType === "LOCATION"/);
  assert.match(nonstop, /await assertCorrectionsSchedulingAllowed\(tx, \{ organisationId, channelId: channel\.id/);
});
