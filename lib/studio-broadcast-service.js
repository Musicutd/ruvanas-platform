import { decryptSecret } from "./crypto.js";
import { broadcastMetadata, reconnectState, safeStudioDestination } from "./studio-broadcast.mjs";

function providerConfigured() {
  return Boolean(process.env.STUDIO_BROADCAST_PROVIDER_URL && process.env.STUDIO_BROADCAST_PROVIDER_TOKEN);
}

async function connectExternal(link) {
  const destination = link.destination;
  const response = await fetch(new URL("v1/studio-destinations/connect", `${process.env.STUDIO_BROADCAST_PROVIDER_URL.replace(/\/$/, "")}/`), {
    method: "POST", headers: { Authorization: `Bearer ${process.env.STUDIO_BROADCAST_PROVIDER_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId: `${link.sessionId}:${link.destinationId}`, type: destination.type, host: destination.host, port: destination.port, mountOrService: destination.mountOrService, codec: destination.codec, bitrateKbps: destination.bitrateKbps, credential: decryptSecret(destination.credentialEncrypted), metadata: link.session.metadataOverride || link.session.automaticMetadata || null }),
    signal: AbortSignal.timeout(10_000), cache: "no-store"
  });
  if (!response.ok) throw new Error(`Provider connection failed (${response.status}).`);
  const payload = await response.json().catch(() => ({}));
  return { listenerCount: Number.isInteger(payload.listenerCount) && payload.telemetryTrusted === true ? payload.listenerCount : null, telemetryTrusted: payload.telemetryTrusted === true };
}

async function updateExternalMetadata(link, metadata) {
  const response = await fetch(new URL("v1/studio-destinations/metadata", `${process.env.STUDIO_BROADCAST_PROVIDER_URL.replace(/\/$/, "")}/`), {
    method: "POST", headers: { Authorization: `Bearer ${process.env.STUDIO_BROADCAST_PROVIDER_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId: `${link.sessionId}:${link.destinationId}`, metadata }),
    signal: AbortSignal.timeout(10_000), cache: "no-store"
  });
  if (!response.ok) throw new Error(`Provider metadata update failed (${response.status}).`);
}

export async function scanStudioBroadcastConnections(database, { now = new Date() } = {}) {
  const links = await database.studioBroadcastSessionDestination.findMany({
    where: { session: { status: "ACTIVE" }, destination: { enabled: true }, OR: [{ state: "STANDBY" }, { state: "RECONNECTING", nextReconnectAt: { lte: now } }, { state: "CONNECTED" }] },
    include: { destination: true, session: true }, take: 100
  });
  const result = { scanned: links.length, connected: 0, reconnecting: 0, failed: 0 };
  for (const link of links) {
    try {
      let listenerCount = null;
      let telemetryTrusted = false;
      if (link.destination.type === "RUVANAS_MANAGED") {
        const config = await database.stationStreamConfig.findFirst({ where: { stationId: link.destination.stationId } });
        if (!config || config.sourceConnectionStatus !== "CONNECTED") throw new Error("The managed station stream is not connected.");
      } else {
        if (!providerConfigured()) {
          await database.studioBroadcastSessionDestination.update({ where: { sessionId_destinationId: { sessionId: link.sessionId, destinationId: link.destinationId } }, data: { state: "STANDBY", lastSafeError: "External encoder infrastructure is not configured." } });
          continue;
        }
        ({ listenerCount, telemetryTrusted } = await connectExternal(link));
      }
      await database.$transaction([
        database.studioBroadcastSessionDestination.update({ where: { sessionId_destinationId: { sessionId: link.sessionId, destinationId: link.destinationId } }, data: { state: "CONNECTED", reconnectAttempt: 0, nextReconnectAt: null, lastConnectedAt: now, lastSafeError: null } }),
        database.studioBroadcastDestination.update({ where: { id: link.destinationId }, data: { connectionState: "CONNECTED", reconnectAttempt: 0, nextReconnectAt: null, lastConnectedAt: now, lastSafeError: null, listenerCount: telemetryTrusted ? listenerCount : null, listenerTelemetryAt: telemetryTrusted ? now : null } })
      ]);
      result.connected += 1;
    } catch (error) {
      const state = reconnectState(link, now);
      const safeError = error instanceof Error ? error.message.replace(/credential|password|secret|token/gi, "connection detail").slice(0, 240) : "Destination connection failed.";
      await database.$transaction([
        database.studioBroadcastSessionDestination.update({ where: { sessionId_destinationId: { sessionId: link.sessionId, destinationId: link.destinationId } }, data: { state: state.connectionState, reconnectAttempt: state.reconnectAttempt, nextReconnectAt: state.nextReconnectAt, lastDisconnectedAt: now, lastSafeError: safeError } }),
        database.studioBroadcastDestination.update({ where: { id: link.destinationId }, data: { connectionState: state.connectionState, reconnectAttempt: state.reconnectAttempt, nextReconnectAt: state.nextReconnectAt, lastDisconnectedAt: now, lastSafeError: safeError, listenerCount: null, listenerTelemetryAt: null } })
      ]);
      result.reconnecting += 1;
    }
  }
  return result;
}

export async function refreshStudioBroadcastMetadata(database) {
  const sessions = await database.studioBroadcastSession.findMany({ where: { status: "ACTIVE" }, include: { destinations: { include: { destination: true } } }, take: 100 });
  let updated = 0; let externalUpdates = 0; let metadataFailures = 0;
  for (const session of sessions) {
    const playout = await database.studioPlayoutSession.findUnique({ where: { id: session.playoutSessionId }, include: { items: { where: { status: "ON_AIR" }, take: 1 } } });
    if (!playout) continue;
    const item = playout.items[0] || null;
    const clearOverride = Boolean(session.metadataOverride && session.metadataOverrideItemId && session.metadataOverrideItemId !== playout.currentItemId);
    const automaticMetadata = broadcastMetadata({ currentItem: item });
    if (automaticMetadata !== session.automaticMetadata || clearOverride) {
      await database.studioBroadcastSession.update({ where: { id: session.id }, data: { automaticMetadata, ...(clearOverride ? { metadataOverride: null, metadataOverrideItemId: null } : {}), revision: { increment: 1 } } });
      const effectiveMetadata = clearOverride ? automaticMetadata : session.metadataOverride || automaticMetadata;
      if (providerConfigured()) for (const link of session.destinations.filter((candidate) => candidate.state === "CONNECTED" && candidate.destination.type !== "RUVANAS_MANAGED")) {
        try { await updateExternalMetadata(link, effectiveMetadata); externalUpdates += 1; } catch { metadataFailures += 1; }
      }
      updated += 1;
    }
  }
  return { scanned: sessions.length, updated, externalUpdates, metadataFailures };
}

export { safeStudioDestination };
