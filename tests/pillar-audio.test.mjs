import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUDIO_PILLARS, audioPillar, channelMatchesPillar, dashboardAudioPillar, firstListenablePillarStation, pillarListenHref, secureListenerUrl } from "../lib/pillar-audio.mjs";

test("all six audio pillars have a listener and AutoDJ entry point", () => {
  assert.deepEqual(Object.keys(AUDIO_PILLARS), ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"]);
  for (const product of Object.keys(AUDIO_PILLARS)) {
    assert.ok(audioPillar(product.toLowerCase()));
    assert.equal(pillarListenHref(product), `/dashboard/listen/${product.toLowerCase()}`);
    assert.ok(AUDIO_PILLARS[product].autoDjHref);
    assert.equal(channelMatchesPillar({ rightsUse: AUDIO_PILLARS[product].rightsUse, productFamily: product }, product), true);
    assert.equal(channelMatchesPillar({ rightsUse: AUDIO_PILLARS[product].rightsUse, productFamily: "ONLINE" }, product), product === "ONLINE");
  }
  assert.equal(pillarListenHref("FAITH", "station id"), "/dashboard/listen/faith?stationId=station%20id");
  assert.equal(pillarListenHref("unknown"), null);
});

test("listener selection stays within a pillar and requires a secure URL", () => {
  const stations = [
    { id: "wrong", productFamily: "ONLINE", status: "ACTIVE", streamConfig: { streamUrl: "https://example.com/live" } },
    { id: "insecure", productFamily: "FAITH", status: "ACTIVE", streamConfig: { streamUrl: "http://example.com/live" } },
    { id: "pending", productFamily: "FAITH", status: "PENDING_SETUP", streamConfig: { streamUrl: "https://example.com/test" } },
    { id: "active", productFamily: "FAITH", status: "ACTIVE", streamConfig: { streamUrl: "https://example.com/faith" } }
  ];
  assert.equal(firstListenablePillarStation(stations, "FAITH")?.id, "active");
  assert.equal(firstListenablePillarStation(stations.slice(0, 3), "FAITH")?.id, "pending");
  assert.equal(secureListenerUrl("https://user:secret@example.com/live"), null);
  assert.equal(secureListenerUrl("http://example.com/live"), null);
});

test("the shared Listen shortcut follows the viewed product", () => {
  assert.equal(dashboardAudioPillar("/dashboard/retail/music"), "RETAIL");
  assert.equal(dashboardAudioPillar("/dashboard/school-radio"), "SCHOOL");
  assert.equal(dashboardAudioPillar("/dashboard/radio"), "ONLINE");
  assert.equal(dashboardAudioPillar("/dashboard/health/setup"), "HEALTH");
  assert.equal(dashboardAudioPillar("/dashboard/faith"), "FAITH");
  assert.equal(dashboardAudioPillar("/dashboard/organisations/workspace"), "ORGANISATIONS");
  assert.equal(dashboardAudioPillar("/dashboard/autodj/faith"), "FAITH");
  assert.equal(dashboardAudioPillar("/dashboard/listen/retail"), "RETAIL");
  assert.equal(dashboardAudioPillar("/dashboard/profile"), null);
});

test("pillar listening is tenant-scoped and AutoDJ reuses the existing API without altering schedules", async () => {
  const [listen, autodj, workspace, layout, shell] = await Promise.all([
    readFile(new URL("../app/dashboard/listen/[product]/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/autodj/[product]/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/autodj/[product]/PillarAutoDjWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/SubscriberPortalShell.js", import.meta.url), "utf8")
  ]);
  assert.match(listen, /requireSubscriberProduct\(product\)/);
  assert.match(listen, /organisationId: context\.membership\.organisationId, productFamily: product/);
  assert.match(listen, /if \(requestedId && !station\) notFound\(\)/);
  assert.match(listen, /secureListenerUrl\(station\?\.streamConfig\?\.streamUrl\)/);
  assert.match(autodj, /requireSubscriberProduct\(product\)/);
  assert.match(workspace, /channelMatchesPillar\(channel, product\)/);
  assert.match(workspace, /fetch\("\/api\/programming\/simple\/nonstop"/);
  assert.doesNotMatch(workspace, /fetch\("\/api\/programming\/simple\/events"/);
  assert.match(layout, /enabledSubscriberProducts\(entitlements\)/);
  assert.match(shell, /dashboardAudioPillar\(pathname\)/);
});
