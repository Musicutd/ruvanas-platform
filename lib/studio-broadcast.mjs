import { studioExternalDestinationLimit } from "./entitlements.mjs";
import { nextReconnectDelayMs } from "./studio-playout.mjs";

export const STUDIO_DESTINATION_TYPES = Object.freeze(["RUVANAS_MANAGED", "ICECAST", "SHOUTCAST"]);
export const STUDIO_DESTINATION_CODECS = Object.freeze(["MP3", "AAC"]);

export function validateStudioDestination(input, { managed = false } = {}) {
  const type = managed ? "RUVANAS_MANAGED" : String(input.type || "");
  if (!STUDIO_DESTINATION_TYPES.includes(type)) throw new Error("Choose a supported Studio destination type.");
  if (type !== "RUVANAS_MANAGED") {
    if (!String(input.host || "").trim()) throw new Error("Enter the streaming host.");
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Enter a valid streaming port.");
    if (!String(input.mountOrService || "").trim()) throw new Error("Enter the mount or service identifier.");
    if (!String(input.credential || "").trim()) throw new Error("Enter the source credential. It will be encrypted and cannot be viewed again.");
  }
  const codec = STUDIO_DESTINATION_CODECS.includes(input.codec) ? input.codec : "MP3";
  const bitrateKbps = Number(input.bitrateKbps || 128);
  if (![64, 96, 128, 160, 192, 256, 320].includes(bitrateKbps)) throw new Error("Choose an approved bitrate profile.");
  return { type, codec, bitrateKbps };
}

export function assertDestinationCapacity({ tierNumber, customLimit = null, activeCount, requestedCount }) {
  const limit = studioExternalDestinationLimit(tierNumber, customLimit);
  if (Number(activeCount) + Number(requestedCount) > limit) throw new Error(`This Studio Pro plan supports ${limit} simultaneous external destinations.`);
  return limit;
}

export function safeStudioDestination(destination) {
  const { credentialEncrypted: _credentialEncrypted, ...safe } = destination;
  return { ...safe, credentialStored: Boolean(destination.credentialEncrypted), listenerCount: destination.listenerTelemetryAt ? destination.listenerCount : null };
}

export function broadcastMetadata({ override, currentItem }) {
  if (override) return override;
  if (!currentItem) return null;
  return currentItem.artistOrProgramme ? `${currentItem.artistOrProgramme} — ${currentItem.title}` : currentItem.title;
}

export function reconnectState(destination, now = new Date()) {
  const attempt = Number(destination.reconnectAttempt || 0) + 1;
  return { connectionState: "RECONNECTING", reconnectAttempt: attempt, nextReconnectAt: new Date(now.getTime() + nextReconnectDelayMs(attempt)), lastDisconnectedAt: now };
}
