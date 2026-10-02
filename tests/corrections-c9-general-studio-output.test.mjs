import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encryptSecret } from "../lib/crypto.js";
import { refreshStudioBroadcastMetadata, scanStudioBroadcastConnections } from "../lib/studio-broadcast-service.js";
import {
  assertGeneralStudioBroadcastSession, assertGeneralStudioChannel, assertGeneralStudioDestination,
  generalStudioChannelIds, generalStudioStationIds,
  GENERAL_STUDIO_CHANNEL_WHERE, GENERAL_STUDIO_STATION_WHERE
} from "../lib/studio-general-output-boundary.mjs";

const organisationId = "fictional-studio-organisation";

test("general Studio predicates exclude private rights, private facility assignments and legacy sibling channels", async () => {
  assert.deepEqual(GENERAL_STUDIO_CHANNEL_WHERE.AND[0].OR, [
    { musicRightsUse: null }, { musicRightsUse: { not: "CORRECTIONS_RADIO" } }
  ]);
  assert.deepEqual(GENERAL_STUDIO_CHANNEL_WHERE.AND[1].OR, [
    { stationId: null }, { station: { is: GENERAL_STUDIO_STATION_WHERE } }
  ]);
  assert.deepEqual(GENERAL_STUDIO_CHANNEL_WHERE.AND[2], {
    zoneAssignments: { none: { zone: { location: { correctionsFacility: { isNot: null } } } } }
  });
  assert.deepEqual(GENERAL_STUDIO_STATION_WHERE.channels.none.OR, [
    { musicRightsUse: "CORRECTIONS_RADIO" },
    { zoneAssignments: { some: { zone: { location: { correctionsFacility: { isNot: null } } } } } }
  ]);
  const database = {
    channel: { findMany: async ({ where }) => {
      assert.equal(where.organisationId, organisationId);
      assert.deepEqual(where.AND, GENERAL_STUDIO_CHANNEL_WHERE.AND);
      return [{ id: "ordinary-channel" }];
    } },
    station: { findMany: async ({ where }) => {
      assert.equal(where.organisationId, organisationId);
      assert.deepEqual(where.channels, GENERAL_STUDIO_STATION_WHERE.channels);
      return [{ id: "ordinary-station" }];
    } }
  };
  assert.deepEqual([...await generalStudioChannelIds(database, organisationId, ["ordinary-channel", "private-channel"])], ["ordinary-channel"]);
  assert.deepEqual([...await generalStudioStationIds(database, organisationId, ["ordinary-station", "private-station"])], ["ordinary-station"]);
  await assertGeneralStudioChannel(database, organisationId, "ordinary-channel");
  await assert.rejects(assertGeneralStudioChannel(database, organisationId, "private-channel"), { code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED", status: 403 });
  await assertGeneralStudioDestination(database, organisationId, { organisationId, stationId: null, type: "ICECAST" });
  await assert.rejects(assertGeneralStudioDestination(database, organisationId, { organisationId, stationId: "private-station", type: "RUVANAS_MANAGED" }), { code: "CORRECTIONS_STUDIO_OUTPUT_BLOCKED" });
});

test("generic Studio routes guard reads, writes, existing sessions and idempotent replay", async () => {
  const [playout, broadcast, library] = await Promise.all([
    readFile(new URL("../app/api/studio/playout/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/studio/broadcast/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/studio/library/route.js", import.meta.url), "utf8")
  ]);
  assert.match(playout, /GENERAL_STUDIO_CHANNEL_WHERE/);
  assert.match(playout, /sessions: visibleSessions/);
  assert.match(playout, /assertGeneralStudioPlayoutSession\(tx,/);
  assert.match(playout, /assertGeneralStudioPlayoutSession\(prisma, access\.organisation\.id, prior\.sessionId\)/);
  assert.match(playout, /if \(existing\) \{\s*await assertGeneralStudioPlayoutSession\(prisma, access\.organisation\.id, existing\.id\)/);
  assert.match(playout, /GENERAL_STUDIO_MEDIA_ASSET_WHERE/);
  assert.match(playout, /assertGeneralStudioMediaAsset\(prisma, access\.organisation\.id, ownedAsset\.id\)/);
  assert.match(broadcast, /GENERAL_STUDIO_STATION_WHERE/);
  assert.match(broadcast, /visibleDestinations/);
  assert.match(broadcast, /visibleSessions/);
  assert.match(broadcast, /assertGeneralStudioPlayoutSession\(prisma, access\.organisation\.id, input\.playoutSessionId\)/);
  assert.match(broadcast, /assertGeneralStudioDestination\(prisma, access\.organisation\.id, destination\)/);
  assert.match(broadcast, /assertGeneralStudioBroadcastSession\(prisma, access\.organisation\.id, prior\.sessionId\)/);
  assert.match(broadcast, /input\.action !== "STOP_BROADCAST"/);
  assert.match(library, /GENERAL_STUDIO_CHANNEL_WHERE/);
  assert.match(library, /planProductFamily === "CORRECTIONS"/);
});

test("general subscriber programming hides channels also assigned to a private facility", async () => {
  const programming = await readFile(new URL("../app/api/programming/route.js", import.meta.url), "utf8");
  assert.match(programming, /\.\.\.GENERAL_STUDIO_CHANNEL_WHERE/);
  assert.match(programming, /visibleChannelIds\.has\(id\)/);
});

function fixture({ productFamily = "ONLINE", channelAllowed = true, stationAllowed = true, assetAllowed = true, destinationType = "ICECAST", stationId = null, credentialEncrypted = null } = {}) {
  const state = { active: true, linkState: "CONNECTED", changes: [], providerCalls: [] };
  const destination = { id: "destination", organisationId, stationId, type: destinationType, enabled: true, credentialEncrypted, connectionState: "CONNECTED", reconnectAttempt: 0 };
  const session = { id: "broadcast", organisationId, playoutSessionId: "playout", status: "ACTIVE", revision: 0, automaticMetadata: null, metadataOverride: null, destinations: [] };
  const link = { sessionId: session.id, destinationId: destination.id, state: "CONNECTED", destination, session };
  session.destinations = [link];
  const playout = { id: "playout", organisationId, channelId: "channel", productFamily, currentItemId: "item", items: [{ id: "item", title: "Fictional ordinary audio", artistOrProgramme: "Test" }] };
  const database = {
    studioBroadcastSessionDestination: {
      findMany: async () => state.active ? [link] : [],
      updateMany: async ({ data }) => { state.linkState = data.state; link.state = data.state; state.changes.push("links stopped"); return { count: 1 }; },
      update: async ({ data }) => { state.linkState = data.state; link.state = data.state; state.changes.push("link connected"); return link; }
    },
    studioBroadcastSession: {
      findFirst: async ({ where }) => where.organisationId === organisationId && state.active ? session : null,
      findMany: async () => state.active ? [session] : [],
      updateMany: async ({ data }) => { state.active = false; session.status = data.status; state.changes.push("session ended"); return { count: 1 }; },
      update: async ({ data }) => { Object.assign(session, data); state.changes.push("metadata updated"); return session; }
    },
    studioPlayoutSession: {
      findFirst: async ({ where }) => where.organisationId === organisationId ? playout : null,
      findUnique: async () => playout
    },
    studioPlayoutItem: { findMany: async () => [{ mediaAssetId: "ordinary-asset" }] },
    mediaAsset: { findMany: async () => assetAllowed ? [{ id: "ordinary-asset" }] : [] },
    channel: { findMany: async () => channelAllowed ? [{ id: "channel" }] : [] },
    station: { findMany: async () => stationAllowed && stationId ? [{ id: stationId }] : [] },
    stationStreamConfig: { findFirst: async () => ({ sourceConnectionStatus: "CONNECTED" }) },
    studioBroadcastDestination: { update: async () => { state.changes.push("destination connected"); return destination; } },
    $transaction: async (operations) => Promise.all(operations)
  };
  return { database, state, session };
}

test("worker never calls external provider for forbidden legacy broadcast links or metadata", async () => {
  const oldEnv = {
    url: process.env.STUDIO_BROADCAST_PROVIDER_URL,
    token: process.env.STUDIO_BROADCAST_PROVIDER_TOKEN,
    key: process.env.SECRET_ENCRYPTION_KEY,
    fetch: globalThis.fetch
  };
  process.env.STUDIO_BROADCAST_PROVIDER_URL = "https://provider.example.invalid/";
  process.env.STUDIO_BROADCAST_PROVIDER_TOKEN = "synthetic-test-only";
  process.env.SECRET_ENCRYPTION_KEY = "0".repeat(64);
  const outbound = [];
  globalThis.fetch = async (url) => { outbound.push(String(url)); return { ok: true, json: async () => ({ telemetryTrusted: false }) }; };
  try {
    const forbidden = [
      ["Corrections playout product family", { productFamily: "CORRECTIONS" }],
      ["Corrections-rights channel", { channelAllowed: false }],
      ["legacy station with private sibling channel", { stationAllowed: false, stationId: "legacy-station", destinationType: "RUVANAS_MANAGED" }],
      ["external destination on forbidden playout", { channelAllowed: false, stationId: null, destinationType: "ICECAST" }],
      ["protected destination on ordinary playout", { stationAllowed: false, stationId: "private-station", destinationType: "RUVANAS_MANAGED" }],
      ["historical protected asset queued on ordinary playout", { assetAllowed: false }]
    ];
    for (const [label, options] of forbidden) {
      const scan = fixture(options);
      const beforeScan = outbound.length;
      const result = await scanStudioBroadcastConnections(scan.database);
      assert.equal(outbound.length, beforeScan, `${label}: scan called provider`);
      assert.equal(result.blocked, 1, label);
      assert.equal(scan.state.active, false, label);
      assert.equal(scan.state.linkState, "STANDBY", label);

      const metadata = fixture(options);
      const beforeMetadata = outbound.length;
      const metadataResult = await refreshStudioBroadcastMetadata(metadata.database);
      assert.equal(outbound.length, beforeMetadata, `${label}: metadata called provider`);
      assert.equal(metadataResult.blocked, 1, label);
      assert.equal(metadata.state.active, false, label);
    }

    const ordinaryProducts = ["RETAIL", "SCHOOL", "ONLINE", "HEALTH", "FAITH", "ORGANISATIONS"];
    for (const productFamily of ordinaryProducts) {
      const allowed = fixture({ productFamily, credentialEncrypted: encryptSecret("synthetic-credential") });
      await assertGeneralStudioBroadcastSession(allowed.database, organisationId, allowed.session.id);
      const before = outbound.length;
      const scan = await scanStudioBroadcastConnections(allowed.database);
      const metadata = await refreshStudioBroadcastMetadata(allowed.database);
      assert.equal(scan.connected, 1, productFamily);
      assert.equal(metadata.externalUpdates, 1, productFamily);
      assert.equal(outbound.length, before + 2, productFamily);
      assert.equal(allowed.state.active, true, productFamily);
    }
  } finally {
    globalThis.fetch = oldEnv.fetch;
    for (const [name, value] of [
      ["STUDIO_BROADCAST_PROVIDER_URL", oldEnv.url],
      ["STUDIO_BROADCAST_PROVIDER_TOKEN", oldEnv.token],
      ["SECRET_ENCRYPTION_KEY", oldEnv.key]
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
