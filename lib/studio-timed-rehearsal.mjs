import path from "node:path";
import { TIMED_PLAYLIST_CROSSFADE_SECONDS } from "./timed-playlist-generator.mjs";

const AUDIO_EXTENSIONS = new Set([".mp3", ".aac", ".m4a", ".wav", ".flac", ".ogg"]);

function privatePath(value, directory, extension = null) {
  if (typeof value !== "string" || !path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || /[\r\n\0]/.test(value)) {
    throw new Error("The isolated rehearsal needs private Linux file paths.");
  }
  const relative = path.posix.relative(directory, value);
  if (!relative || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative) ||
      (extension ? path.posix.extname(value).toLowerCase() !== extension : !AUDIO_EXTENSIONS.has(path.posix.extname(value).toLowerCase()))) {
    throw new Error("The isolated rehearsal accepts only protected files inside its private cache.");
  }
  return value;
}

// Return text for a one-pass, file-only Liquidsoap rehearsal. This does not
// write files, run Liquidsoap, connect to Centova or certify measured timing.
export function renderTimedRehearsalBundle(plan, {
  privateDirectory, mediaByAssetId, playlistPath, outputPath, bitrateKbps = 128
}) {
  if (typeof privateDirectory !== "string" || privateDirectory === "/" || !path.posix.isAbsolute(privateDirectory) ||
      path.posix.normalize(privateDirectory) !== privateDirectory || /[\r\n\0]/.test(privateDirectory) ||
      !Number.isInteger(bitrateKbps) || bitrateKbps < 32 || bitrateKbps > 320 ||
      plan?.ready !== true || plan.reason !== "FROZEN_SEQUENCE_PLANNED_NOT_ON_AIR" ||
      plan.commandIssued !== false || plan.listenerVerified !== false ||
      !Array.isArray(plan.items) || !plan.items.length || plan.items.length > 2500 ||
      !(mediaByAssetId instanceof Map)) {
    throw new Error("A current dry-run sequence plan is required for isolated rehearsal.");
  }
  privatePath(playlistPath, privateDirectory, ".m3u");
  privatePath(outputPath, privateDirectory, ".mp3");
  if (playlistPath === outputPath) throw new Error("Rehearsal input and output must be separate.");
  const files = plan.items.map((item, position) => {
    if (item?.position !== position || typeof item.mediaAssetId !== "string" || !item.mediaAssetId) {
      throw new Error("The frozen rehearsal order is invalid.");
    }
    const file = privatePath(mediaByAssetId.get(item.mediaAssetId), privateDirectory);
    if (file === playlistPath || file === outputPath) throw new Error("Rehearsal output cannot overwrite source audio.");
    return file;
  });
  const crossfade = `${TIMED_PLAYLIST_CROSSFADE_SECONDS}.`;
  return {
    playlistText: `${files.join("\n")}\n`,
    liquidsoapText: `source = playlist(mode="normal", loop=false, reload_mode="never", ${JSON.stringify(playlistPath)})\n` +
      `source = crossfade(duration=${crossfade}, fade_in=${crossfade}, fade_out=${crossfade}, smart=false, source)\n` +
      `output.file(fallible=true, %mp3(bitrate=${bitrateKbps}), ${JSON.stringify(outputPath)}, source)\n`,
    expectedOrder: plan.items.map((item) => ({ position: item.position, trackId: item.trackId, startOffsetSeconds: item.startOffsetSeconds })),
    commandIssued: false,
    listenerVerified: false
  };
}
