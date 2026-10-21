import crypto from "node:crypto";
import { playableLiveMusicModeEntries } from "./music-mode-playback.mjs";
import { buildGenreRotation } from "./subscriber-playlists.mjs";
import { licensedManualCatalogueDecision } from "./online-radio-catalogue-policy.mjs";

function sourceEntryAllowed(entry, station, entitlements, instant, configuredGenres, deliveryOptions, policy) {
  if (deliveryOptions?.deliveryAccounting === true && (entry.track?.catalogueProvider !== null ||
      !Array.isArray(entry.track?.distributorItems) || entry.track.distributorItems.length !== 0 ||
      entry.track.rightsBasis === "DISTRIBUTOR_LICENCE")) return false;
  if (onlineRadioSourceScope(entry) !== "LICENSED_CATALOGUE") return true;
  const duration = Number(entry.track?.mediaAsset?.durationSeconds);
  return licensedManualCatalogueDecision(entry.track, {
    enabled: deliveryOptions?.manualCatalogueOutput === true && deliveryOptions?.deliveryAccounting === true,
    organisationId: station.organisationId, entitlements, territory: policy?.territory,
    instant, stopAt: new Date(instant.getTime() + (duration + 2) * 1000), configuredGenres,
    selectedGenreCodes: Array.isArray(policy?.selectedGenreCodes) ? policy.selectedGenreCodes : []
  }).allowed;
}

export function onlineRadioSourceScope(entry) {
  const asset = entry?.track?.mediaAsset;
  if (asset?.libraryType === "ORGANISATION_MUSIC") return "SUBSCRIBER_LIBRARY";
  if (asset?.libraryType === "RUVANAS_CATALOGUE") return asset.licensedCatalogue ? "LICENSED_CATALOGUE" : "RUVANAS_CORE";
  return null;
}

export function eligibleOnlineRadioRotation(station, entitlements, instant = new Date(), configuredGenres = [], deliveryOptions = {}) {
  if (entitlements?.outputEnabled === false) return { ready: false, reason: "OUTPUT_NOT_PERMITTED" };
  if (deliveryOptions.deliveryAccounting === true && (entitlements?.outputEnabled !== true || entitlements?.sandboxDraftOnly === true)) return { ready: false, reason: "OUTPUT_NOT_PERMITTED" };
  if (deliveryOptions.deliveryAccounting === true && entitlements?.serviceEnabled !== true) return { ready: false, reason: "SERVICE_INACTIVE" };
  if (station?.productFamily !== "ONLINE" || !["PENDING_SETUP", "DRAFT", "ACTIVE"].includes(station.status)) return { ready: false, reason: "STATION_NOT_READY" };
  if (!entitlements?.onlineRadioEnabled) return { ready: false, reason: "SERVICE_INACTIVE" };
  const config = station.streamConfig;
  if (!config?.outboundAutoDjEnabled || config.providerKey !== "CENTOVA_CAST" || !config.serverHost || !config.sourcePort || !config.sourcePasswordEncrypted) return { ready: false, reason: "SOURCE_NOT_CONFIGURED" };
  const channel = station.channels?.find((item) => item.status === "ACTIVE");
  if (!channel) return { ready: false, reason: "CHANNEL_NOT_ACTIVE" };
  if (deliveryOptions.deliveryAccounting === true && (station.channels.filter(item => item.status === "ACTIVE").length !== 1 ||
      channel.organisationId !== station.organisationId || channel.stationId !== station.id || channel.musicRightsUse !== "ONLINE_RADIO")) return { ready: false, reason: "CHANNEL_SCOPE_INVALID" };
  const policy = channel.autoDjPolicy;
  if (deliveryOptions.deliveryAccounting === true && (policy?.organisationId !== station.organisationId || policy.channelId !== channel.id ||
      [policy.defaultMusicMode, policy.backupMusicMode].some(mode => mode && mode.organisationId !== station.organisationId))) return { ready: false, reason: "AUTODJ_SCOPE_INVALID" };
  if (!policy?.enabled || policy.state !== "ACTIVE" || policy.playbackPolicy !== "RUN_24_7" || policy.rightsUse !== "ONLINE_RADIO") return { ready: false, reason: "AUTODJ_NOT_ACTIVE" };
  const options = {
    organisationId: station.organisationId,
    requiredUse: "ONLINE_RADIO",
    territory: policy.territory || null,
    licensedCatalogueLevel: entitlements.licensedMusicCatalogueLevel,
    selectedGenreCodes: Array.isArray(policy.selectedGenreCodes) ? policy.selectedGenreCodes : [],
    configuredGenres,
    instant
  };
  const scopes = new Set(Array.isArray(policy.sourceScopes) ? policy.sourceScopes : []);
  for (const mode of [policy.defaultMusicMode, policy.backupMusicMode]) {
    if (mode?.status !== "ACTIVE") continue;
    const entries = playableLiveMusicModeEntries(mode, instant, options)
      // The opt-in accounted sender admits only reviewed manual catalogue.
      // Provider/distributor feeds stay excluded; legacy/default behaviour is unchanged.
      .filter((entry) => scopes.has(onlineRadioSourceScope(entry)) &&
        sourceEntryAllowed(entry, station, entitlements, instant, configuredGenres, deliveryOptions, policy))
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    const bounded = deliveryOptions.deliveryAccounting === true ? boundEncoderCache(entries) : entries;
    if (bounded.length) return { ready: true, station, channel, policy, mode, entries: bounded };
  }
  return { ready: false, reason: "NO_RIGHTS_APPROVED_AUDIO" };
}

export function eligibleScheduledOnlineRotation(station, entitlements, event, eligibleEntries, instant = new Date(), deliveryOptions = {}) {
  if (entitlements?.outputEnabled === false) return { ready: false, reason: "OUTPUT_NOT_PERMITTED" };
  if (deliveryOptions.deliveryAccounting === true && (entitlements?.outputEnabled !== true || entitlements?.sandboxDraftOnly === true)) return { ready: false, reason: "OUTPUT_NOT_PERMITTED" };
  if (deliveryOptions.deliveryAccounting === true && entitlements?.serviceEnabled !== true) return { ready: false, reason: "SERVICE_INACTIVE" };
  if (station?.productFamily !== "ONLINE" || !["PENDING_SETUP", "DRAFT", "ACTIVE"].includes(station.status)) return { ready: false, reason: "STATION_NOT_READY" };
  if (!event || event.cancelledAt || event.startsAt > instant || event.endsAt <= instant) return { ready: false, reason: "NO_ACTIVE_PLAYLIST_EVENT" };
  const playlist = event.smartPlaylist;
  const channel = station?.channels?.find((entry) => entry.id === event.channelId && entry.organisationId === station.organisationId && entry.status === "ACTIVE");
  if (deliveryOptions.deliveryAccounting === true && (event.organisationId !== station.organisationId || channel?.stationId !== station.id ||
      channel?.musicRightsUse !== "ONLINE_RADIO" || channel?.autoDjPolicy?.organisationId !== station.organisationId || channel?.autoDjPolicy?.channelId !== channel?.id)) return { ready: false, reason: "PLAYLIST_SCOPE_OR_RIGHTS_INVALID" };
  if (station?.productFamily !== "ONLINE" || !entitlements?.onlineRadioEnabled || !channel || playlist?.organisationId !== station.organisationId || playlist.status !== "ACTIVE" || playlist.rightsUse !== "ONLINE_RADIO") return { ready: false, reason: "PLAYLIST_SCOPE_OR_RIGHTS_INVALID" };
  const config = station.streamConfig;
  if (!config?.outboundAutoDjEnabled || config.providerKey !== "CENTOVA_CAST" || !config.serverHost || !config.sourcePort || !config.sourcePasswordEncrypted) return { ready: false, reason: "SOURCE_NOT_CONFIGURED" };
  const chunkMinutes = Math.min(360, Math.max(1, playlist.durationMinutes || 60));
  const cycle = Math.floor((instant.getTime() - event.startsAt.getTime()) / (chunkMinutes * 60000));
  const policy = channel.autoDjPolicy;
  const sequence = buildGenreRotation({ entries: eligibleEntries.filter((entry) =>
    sourceEntryAllowed(entry, station, entitlements, instant, deliveryOptions.configuredGenres || [], deliveryOptions, policy) &&
    (onlineRadioSourceScope(entry) !== "LICENSED_CATALOGUE" ||
      policy?.enabled === true && policy.state === "ACTIVE" && policy.rightsUse === "ONLINE_RADIO" &&
      Array.isArray(policy.sourceScopes) && policy.sourceScopes.includes("LICENSED_CATALOGUE"))
  ), genreCodes: Array.isArray(playlist.genreCodes) ? playlist.genreCodes : [], buildMode: playlist.simpleBuildMode, durationMinutes: chunkMinutes, seed: `${event.id}:${playlist.version}:${cycle}` });
  const bounded = boundEncoderCache(sequence.entries);
  if (!bounded.length) return { ready: false, reason: "NO_RIGHTS_APPROVED_AUDIO" };
  return { ready: true, station, channel, policy: { updatedAt: playlist.updatedAt }, mode: { id: playlist.musicModeId }, entries: bounded, scheduleKey: `${event.id}:${cycle}:${playlist.version}`, scheduleEndsAt: event.endsAt };
}

export function boundEncoderCache(entries, maximumBytes = 850 * 1024 * 1024) {
  const output = [];
  let bytes = 0;
  for (const entry of entries || []) {
    if (output.length >= 1000) break;
    const size = Number(entry.track?.mediaAsset?.sizeBytes || 0);
    if (!Number.isFinite(size) || size < 0 || bytes + size > maximumBytes) break;
    output.push(entry);
    bytes += size;
  }
  return output;
}

export function rotationFingerprint(rotation) {
  if (!rotation?.ready) return null;
  const { station, channel, policy, mode, entries } = rotation;
  const payload = {
    stationId: station.id, channelId: channel.id, modeId: mode.id,
    scheduleKey: rotation.scheduleKey || null,
    host: station.streamConfig.serverHost, sourcePort: station.streamConfig.sourcePort,
    sourceUsername: station.streamConfig.sourceUsername, sourceSecret: station.streamConfig.sourcePasswordEncrypted,
    bitrateKbps: station.streamConfig.bitrateKbps, policyUpdatedAt: policy.updatedAt,
    tracks: entries.map((entry) => [entry.track.id, entry.track.updatedAt, entry.track.mediaAsset.id, entry.track.mediaAsset.updatedAt])
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function liquidsoapScript({ playlistPath, host, port, username, password, bitrateKbps, stationName }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(bitrateKbps) || bitrateKbps < 32 || bitrateKbps > 320) throw new Error("Invalid encoder port or bitrate.");
  const q = (value) => JSON.stringify(String(value));
  const userOption = username ? `, user=${q(username)}` : "";
  return `source = playlist(mode="normal", ${q(playlistPath)})\noutput.shoutcast(%mp3(bitrate=${bitrateKbps}), fallible=true, host=${q(host)}, port=${port}${userOption}, password=${q(password)}, name=${q(stationName)}, public=false, source)\n`;
}
