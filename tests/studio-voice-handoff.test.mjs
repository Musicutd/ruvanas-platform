import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { studioVoiceTrackingUrl, verifiedStudioVoiceChannel } from "../lib/studio-voice-handoff.mjs";

test("Broadcast Console handoff opens the production tab with an encoded channel", () => {
  assert.equal(studioVoiceTrackingUrl("channel-1"), "/dashboard/programming?studioChannelId=channel-1#workspace-production");
  assert.equal(studioVoiceTrackingUrl("channel?other=1"), "/dashboard/programming?studioChannelId=channel%3Fother%3D1#workspace-production");
  assert.equal(studioVoiceTrackingUrl(""), "/dashboard/programming#workspace-production");
});

test("Voice Tracking accepts handoff context only for a channel returned by its scoped catalogue", () => {
  const channels = [{ id: "owned", name: "Owned channel" }];
  assert.equal(verifiedStudioVoiceChannel(channels, "owned"), channels[0]);
  assert.equal(verifiedStudioVoiceChannel(channels, "another-tenant"), null);
  assert.equal(verifiedStudioVoiceChannel(null, "owned"), null);
  assert.equal(verifiedStudioVoiceChannel(channels, null), null);
});

test("handoff stays within existing Voice Tracking draft and approval workflow", async () => {
  const [consoleUi, voiceUi] = await Promise.all([
    readFile(new URL("../app/dashboard/studio/BroadcastConsoleClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/programming/VoiceTrackingWorkspace.js", import.meta.url), "utf8")
  ]);
  assert.match(consoleUi, /href=\{studioVoiceTrackingUrl\(channelId\)\}/);
  assert.match(voiceUi, /verifiedStudioVoiceChannel\(data\?\.channels, requestedChannelId\)/);
  assert.match(voiceUi, /method: editing \? "PATCH" : "POST"/);
  assert.match(voiceUi, /previewAcknowledged: previewed === segue\.id/);
});
