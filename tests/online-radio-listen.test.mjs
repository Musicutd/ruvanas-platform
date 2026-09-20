import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { firstListenableOnlineStation, onlineRadioListenHref, secureRadioListenerUrl } from "../lib/online-radio-listen.mjs";

test("the subscriber Listen shortcut uses only a secure Online Radio listener stream", () => {
  const stations = [
    { id: "retail", productFamily: "RETAIL", streamConfig: { streamUrl: "https://example.com/retail" } },
    { id: "insecure", productFamily: "ONLINE", streamConfig: { streamUrl: "http://example.com/live" } },
    { id: "radio", productFamily: "ONLINE", status: "PENDING_SETUP", publicPlayerEnabled: false, streamConfig: { streamUrl: "https://radio.example.com/stream" } }
  ];
  assert.equal(firstListenableOnlineStation(stations)?.id, "radio");
  assert.equal(firstListenableOnlineStation([...stations, { id: "live", productFamily: "ONLINE", status: "ACTIVE", streamConfig: { streamUrl: "https://live.example.com/stream" } }])?.id, "live");
  assert.equal(onlineRadioListenHref("radio"), "/dashboard/radio/listen?stationId=radio");
  assert.equal(secureRadioListenerUrl("https://user:secret@example.com/live"), null);
  assert.equal(secureRadioListenerUrl("http://example.com/live"), null);
  assert.equal(secureRadioListenerUrl("not a url"), null);
});

test("Listen remains available on the subscriber profile without publishing the public player", async () => {
  const [layout, shell, radio, preview, dashboard] = await Promise.all([
    readFile(new URL("../app/dashboard/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/SubscriberPortalShell.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/listen/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/ProductDashboard.js", import.meta.url), "utf8")
  ]);
  assert.match(layout, /entitlements\.onlineRadioEnabled/);
  assert.match(layout, /firstListenableOnlineStation\(organisation\.stations\)/);
  assert.match(shell, /listenHref \? <Link href=\{listenHref\}/);
  assert.match(shell, /target="_blank" rel="noopener noreferrer"/);
  assert.match(radio, /listenAction=\{listenStation/);
  assert.match(dashboard, /listenAction\.href/);
  assert.match(preview, /requireSubscriberProduct\("ONLINE"\)/);
  assert.match(preview, /where: \{ organisationId, productFamily: "ONLINE" \}/);
  assert.match(preview, /if \(requestedId && !station\) notFound\(\)/);
  assert.match(preview, /<audio className=\{styles\.player\} controls preload="none"/);
  assert.match(preview, /referrerPolicy="no-referrer"/);
  assert.match(preview, /does not activate the station or publish its Ruvanas public player/);
  assert.doesNotMatch(preview, /publicPlayerEnabled: true.*update/);
});
