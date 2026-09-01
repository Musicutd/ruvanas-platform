import { effectivePlayerStatus } from "./player-tokens.mjs";

export const PLAYER_READINESS_PLAYBACK_WINDOW_SECONDS = 15 * 60;

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function activeChannel(player) {
  return player?.zone?.channelAssignments?.[0]?.channel || null;
}

function latestHeartbeat(player) {
  return player?.heartbeatSamples?.[0] || null;
}

function latestPlayback(player) {
  return player?.proofOfPlayEvents?.[0] || null;
}

function checklistItem(key, label, complete, detail) {
  return { key, label, complete: Boolean(complete), detail };
}

export function subscriberPlayerReadiness(player, now = new Date()) {
  const observedAt = new Date(now);
  const health = effectivePlayerStatus(player, observedAt);
  const heartbeat = latestHeartbeat(player);
  const channel = activeChannel(player);
  const playback = latestPlayback(player);
  const playbackAt = dateValue(playback?.occurredAt);
  const playbackAgeMs = playbackAt ? observedAt.getTime() - playbackAt.getTime() : null;
  const playbackRecent = Boolean(
    playbackAt &&
    playbackAgeMs >= 0 &&
    playbackAgeMs <= PLAYER_READINESS_PLAYBACK_WINDOW_SECONDS * 1000 &&
    ["STARTED", "COMPLETED"].includes(playback.eventType)
  );
  const sourceStatus = heartbeat?.sourceStatus || null;
  const sourceHealthy = sourceStatus === "CONNECTED";
  const enrolled = Boolean(player?.enrolledAt);
  const connected = health === "ONLINE";
  const channelAssigned = Boolean(channel);

  const checklist = [
    checklistItem("ENROLLED", "Player enrolled", enrolled, enrolled ? "The one-time code has been accepted by a device." : "Enter the one-time code on the shop device."),
    checklistItem("CONNECTED", "Device online", connected, connected ? "The player is reporting normally." : enrolled ? "Open the player on the enrolled device and keep it connected." : "Connection starts after enrolment."),
    checklistItem("CHANNEL", "Channel assigned", channelAssigned, channelAssigned ? channel.name : "Assign a channel to this shop zone."),
    checklistItem("SOURCE", "Audio source connected", connected && sourceHealthy, sourceStatus ? `Latest source status: ${sourceStatus}.` : connected ? "Waiting for the first diagnostic sample." : "Source status is available when the device connects."),
    checklistItem("PLAYBACK", "Playback confirmed", playbackRecent, playbackRecent ? `${playback.trackArtist} — ${playback.trackTitle}` : playback?.eventType === "FAILED" ? "The latest playback attempt failed. Check the player screen." : "Start the shop player and allow audio playback." )
  ];

  let code = "READY";
  let level = "READY";
  let summary = "The shop player is online and recent playback has been confirmed.";
  if (health === "DISABLED") {
    code = "DISABLED"; level = "RETIRED"; summary = "This player has been retired and cannot reconnect.";
  } else if (!enrolled) {
    code = "WAITING_FOR_ENROLMENT"; level = "WAITING"; summary = "Waiting for the shop device to accept its one-time enrolment code.";
  } else if (!player.lastHeartbeatAt) {
    code = "WAITING_FOR_CONNECTION"; level = "WAITING"; summary = "Enrolled successfully; waiting for the first device heartbeat.";
  } else if (!connected) {
    code = "OFFLINE"; level = "ACTION_REQUIRED"; summary = "The enrolled shop player is offline.";
  } else if (!channelAssigned) {
    code = "CHANNEL_REQUIRED"; level = "ACTION_REQUIRED"; summary = "The device is online, but this shop zone has no active channel.";
  } else if (!sourceStatus) {
    code = "WAITING_FOR_SOURCE"; level = "WAITING"; summary = "The device is online; waiting for its first audio-source diagnostic.";
  } else if (!sourceHealthy) {
    code = "SOURCE_ATTENTION"; level = "ACTION_REQUIRED"; summary = `The device is online, but its audio source is ${sourceStatus.toLowerCase()}.`;
  } else if (!playbackRecent) {
    code = "WAITING_FOR_PLAYBACK"; level = playback?.eventType === "FAILED" ? "ACTION_REQUIRED" : "WAITING";
    summary = playback?.eventType === "FAILED" ? "The latest audio attempt failed on the shop device." : "Connected and assigned; waiting for recent playback evidence.";
  }

  return {
    code,
    level,
    ready: code === "READY",
    summary,
    checklist,
    channel: channel ? { id: channel.id, name: channel.name } : null,
    lastHeartbeatAt: dateValue(player?.lastHeartbeatAt)?.toISOString() || null,
    lastPlaybackAt: playbackAt?.toISOString() || null,
    latestPlayback: playback ? {
      eventType: playback.eventType,
      trackTitle: playback.trackTitle,
      trackArtist: playback.trackArtist,
      manifestVersion: playback.manifestVersion
    } : null,
    diagnostics: heartbeat ? {
      appVersion: heartbeat.appVersion,
      manifestVersion: heartbeat.manifestVersion,
      sourceStatus: heartbeat.sourceStatus,
      observedAt: dateValue(heartbeat.observedAt)?.toISOString() || null
    } : null
  };
}
