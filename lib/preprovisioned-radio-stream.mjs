import { isIP } from "node:net";
import { isPrivateNetworkAddress } from "./stream-source-health.mjs";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function sourceKey(host, port) {
  const normalized = text(host).toLowerCase().replace(/\.$/, "");
  return normalized && validPort(port) ? `${normalized}:${port}` : "";
}

function listenerKey(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !publicSourceHost(url.hostname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function publicSourceHost(value) {
  const host = text(value).toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      (!isIP(host) && !host.includes(".")) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return !isIP(host) || !isPrivateNetworkAddress(host);
}

/** Syntactic intake only. A separate provider and listener check must promote the slot. */
export function normalizePreprovisionedRadioStreamInput(input) {
  if (!input || typeof input !== "object") throw new Error("INVALID_STREAM_SLOT");
  const centovaUsername = text(input.centovaUsername);
  const sourceUsername = text(input.sourceUsername) || null;
  const serverHost = text(input.serverHost).toLowerCase().replace(/\.$/, "");
  const streamUrl = listenerKey(input.streamUrl);
  const serverPort = Number(input.serverPort);
  const sourcePort = Number(input.sourcePort);
  const listenerLimit = Number(input.listenerLimit);
  const maxBitrateKbps = Number(input.maxBitrateKbps);
  const sourcePassword = input.sourcePassword;
  if (!/^[a-z0-9][a-z0-9_.-]{1,79}$/i.test(centovaUsername) ||
      (sourceUsername && !/^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(sourceUsername)) ||
      !streamUrl || streamUrl.length > 2_048 || !publicSourceHost(serverHost) ||
      !validPort(serverPort) || !validPort(sourcePort) ||
      !Number.isInteger(listenerLimit) || listenerLimit < 1 || listenerLimit > 100_000 ||
      !Number.isInteger(maxBitrateKbps) || maxBitrateKbps < 8 || maxBitrateKbps > 320 ||
      typeof sourcePassword !== "string" || !sourcePassword.length || sourcePassword.length > 1_024) {
    throw new Error("INVALID_STREAM_SLOT");
  }
  return {
    providerKey: "CENTOVA_CAST", centovaUsername, streamUrl,
    serverHost, serverPort, sourcePort, sourceUsername,
    listenerLimit, maxBitrateKbps, sourcePassword
  };
}

function validSlot(slot) {
  return Boolean(
    slot && text(slot.id) && slot.providerKey === "CENTOVA_CAST" &&
    text(slot.centovaUsername) && listenerKey(slot.streamUrl) &&
    publicSourceHost(slot.serverHost) && validPort(slot.serverPort) && validPort(slot.sourcePort) &&
    Number.isInteger(slot.listenerLimit) && slot.listenerLimit > 0 &&
    Number.isInteger(slot.maxBitrateKbps) && slot.maxBitrateKbps >= 8 && slot.maxBitrateKbps <= 320 &&
    text(slot.sourcePasswordEncrypted) &&
    slot.verifiedAt && !Number.isNaN(new Date(slot.verifiedAt).getTime())
  );
}

/**
 * Plans a claim only. The caller must re-read the inventory in a serializable
 * transaction, atomically claim the selected row, and leave output disabled
 * until rights, worker capacity and independent listener checks have passed.
 * No secret or connection detail is returned to the caller.
 */
export function planPreprovisionedRadioStream({ station, slots, occupiedConfigs } = {}) {
  if (station?.productFamily !== "ONLINE") return { ready: false, reason: "ONLINE_RADIO_REQUIRED" };
  if (station.streamConfig || station.providerAccountId) return { ready: false, reason: "STATION_ALREADY_CONFIGURED" };
  if (!Number.isInteger(station.listenerLimit) || station.listenerLimit < 1 ||
      !Number.isInteger(station.maxBitrateKbps) || station.maxBitrateKbps < 8 || station.maxBitrateKbps > 320) {
    return { ready: false, reason: "INVALID_STATION_LIMITS" };
  }
  if (!Array.isArray(slots) || !Array.isArray(occupiedConfigs)) return { ready: false, reason: "INVALID_INVENTORY" };

  const inventoryIds = new Set();
  const inventoryAccounts = new Set();
  const inventoryListeners = new Set();
  const inventorySources = new Set();
  for (const slot of slots) {
    if (!validSlot(slot)) return { ready: false, reason: "INVALID_INVENTORY" };
    const account = text(slot.centovaUsername).toLowerCase();
    const listener = listenerKey(slot.streamUrl);
    const source = sourceKey(slot.serverHost, slot.sourcePort);
    if (inventoryIds.has(slot.id) || inventoryAccounts.has(account) || inventoryListeners.has(listener) || inventorySources.has(source)) {
      return { ready: false, reason: "INVENTORY_CONFLICT" };
    }
    inventoryIds.add(slot.id);
    inventoryAccounts.add(account);
    inventoryListeners.add(listener);
    inventorySources.add(source);
  }

  const occupiedAccounts = new Set(occupiedConfigs.map((config) => text(config.centovaUsername).toLowerCase()).filter(Boolean));
  const occupiedListeners = new Set(occupiedConfigs.map((config) => listenerKey(config.streamUrl)).filter(Boolean));
  const occupiedSources = new Set(occupiedConfigs.map((config) => sourceKey(config.serverHost, config.sourcePort)).filter(Boolean));
  const eligible = slots.filter((slot) =>
    slot.status === "AVAILABLE" && !slot.stationId &&
    slot.listenerLimit >= station.listenerLimit && slot.maxBitrateKbps >= station.maxBitrateKbps &&
    !occupiedAccounts.has(text(slot.centovaUsername).toLowerCase()) &&
    !occupiedListeners.has(listenerKey(slot.streamUrl)) &&
    !occupiedSources.has(sourceKey(slot.serverHost, slot.sourcePort))
  );
  eligible.sort((left, right) =>
    left.maxBitrateKbps - right.maxBitrateKbps ||
    left.listenerLimit - right.listenerLimit ||
    text(left.id).localeCompare(text(right.id))
  );
  return eligible.length ? { ready: true, slotId: eligible[0].id } : { ready: false, reason: "NO_ELIGIBLE_STREAM_SLOT" };
}
