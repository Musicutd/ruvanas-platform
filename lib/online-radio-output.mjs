import crypto from "node:crypto";
import { playableLiveMusicModeEntries } from "./music-mode-playback.mjs";

export function onlineRadioSourceScope(entry) {
  const asset = entry?.track?.mediaAsset;
  if (asset?.libraryType === "ORGANISATION_MUSIC") return "SUBSCRIBER_LIBRARY";
  if (asset?.libraryType === "RUVANAS_CATALOGUE") return asset.licensedCatalogue ? "LICENSED_CATALOGUE" : "RUVANAS_CORE";
  return null;
}

export function eligibleOnlineRadioRotation(station, entitlements, instant = new Date(), configuredGenres = []) {
  if (station?.productFamily !== "ONLINE" || !["PENDING_SETUP", "DRAFT", "ACTIVE"].includes(station.status)) return { ready: false, reason: "STATION_NOT_READY" };
  if (!entitlements?.onlineRadioEnabled) return { ready: false, reason: "SERVICE_INACTIVE" };
  const config = station.streamConfig;
  if (!config?.outboundAutoDjEnabled || config.providerKey !== "CENTOVA_CAST" || !config.serverHost || !config.sourcePort || !config.sourcePasswordEncrypted) return { ready: false, reason: "SOURCE_NOT_CONFIGURED" };
  const channel = station.channels?.find((item) => item.status === "ACTIVE");
  if (!channel) return { ready: false, reason: "CHANNEL_NOT_ACTIVE" };
  const policy = channel.autoDjPolicy;
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
      // Distributor catalogue output needs actual encoder play evidence before it can be enabled.
      .filter((entry) => onlineRadioSourceScope(entry) !== "LICENSED_CATALOGUE" && scopes.has(onlineRadioSourceScope(entry)))
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    if (entries.length) return { ready: true, station, channel, policy, mode, entries };
  }
  return { ready: false, reason: "NO_RIGHTS_APPROVED_AUDIO" };
}

export function rotationFingerprint(rotation) {
  if (!rotation?.ready) return null;
  const { station, channel, policy, mode, entries } = rotation;
  const payload = {
    stationId: station.id, channelId: channel.id, modeId: mode.id,
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
