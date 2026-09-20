import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onlineStudioGuideState } from "../lib/studio-online-guide.mjs";

const channel = { id: "channel-1", name: "Test station", stationId: "station-1", autoDjPolicy: { enabled: true, state: "ACTIVE" } };
const session = { id: "session-1", channelId: channel.id, status: "ACTIVE", items: [{ area: "LIVE", status: "READY", rightsReady: true }] };

test("Online Studio guide advances through channel and queue preparation without claiming listener audio", () => {
  assert.equal(onlineStudioGuideState({ channels: [], sessions: [] }).nextStep, "CHANNEL");
  assert.equal(onlineStudioGuideState({ channels: [{ ...channel, autoDjPolicy: { enabled: false, state: "DRAFT" } }], sessions: [] }).nextStep, "CHANNEL");
  assert.equal(onlineStudioGuideState({ channels: [channel], sessions: [] }).nextStep, "QUEUE");
  assert.equal(onlineStudioGuideState({ channels: [channel], sessions: [{ ...session, status: "FALLBACK" }] }).readyItemCount, 1);
  assert.equal(onlineStudioGuideState({ channels: [channel], sessions: [{ ...session, items: [{ area: "LIVE", status: "READY", rightsReady: false }] }] }).nextStep, "QUEUE");
  const prepared = onlineStudioGuideState({ channels: [channel], sessions: [session], manualOutput: { connected: false } });
  assert.equal(prepared.readyItemCount, 1);
  assert.equal(prepared.nextStep, "OUTPUT");
  assert.equal(prepared.encoderConnected, false);
  assert.equal(prepared.listenerVerified, false);
  const acknowledged = onlineStudioGuideState({ channels: [channel], sessions: [session], manualOutput: { connected: true } });
  assert.equal(acknowledged.encoderConnected, true);
  assert.equal(acknowledged.listenerVerified, false);
});

test("Online Studio opens a simple first screen while retaining direct advanced workspace links", async () => {
  const [hub, guide] = await Promise.all([
    readFile(new URL("../app/dashboard/studio/StudioHubClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/studio/OnlineStudioGuideClient.js", import.meta.url), "utf8")
  ]);
  assert.match(hub, /isOnline \? "start" : "create"/);
  assert.match(hub, /setShowTools\(true\)/);
  assert.match(guide, /do not switch off your current AutoDJ/);
  assert.match(guide, /independent listener audio check/);
  assert.doesNotMatch(guide, /START_BROADCAST|START_NEXT/);
});

test("Manual Playout keeps preparation simple without suggesting unverified live output", async () => {
  const playout = await readFile(new URL("../app/dashboard/studio/ManualPlayoutClient.js", import.meta.url), "utf8");
  assert.match(playout, /Preview privately/);
  assert.match(playout, /Send to Next/);
  assert.match(playout, /<details className=\{styles\.advancedEditor\}>/);
  assert.match(playout, /Edit title, cue, fades and gain/);
  assert.match(playout, /Programme packs \(advanced\)/);
  assert.match(playout, /Live controls will appear only after Ruvanas verifies Studio output/);
  assert.match(playout, /manualOutputConnected \? <div className=\{styles\.actions\}>/);
});
