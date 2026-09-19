import path from "node:path";

const TARGET_PATTERN = /^\/tmp\/ruvanas-studio-handoff-[a-f0-9]{12}$/;

function fixturePath(value, directory, extension) {
  if (typeof value !== "string" || !path.posix.isAbsolute(value) ||
      path.posix.normalize(value) !== value || /[\r\n\0]/.test(value) ||
      path.posix.dirname(value) !== directory || path.posix.extname(value) !== extension) {
    throw new Error("Studio handoff rehearsal accepts only files in its private test directory.");
  }
  return value;
}

// Synthetic, file-only AutoDJ -> Manual -> AutoDJ graph. This is deliberately
// separate from the live encoder and cannot command a Centova source.
export function renderIsolatedStudioHandoffRehearsal({
  privateDirectory, autodjPath, manualPath, playlistPath, outputPath, socketPath
}) {
  if (!TARGET_PATTERN.test(privateDirectory) || path.posix.normalize(privateDirectory) !== privateDirectory) {
    throw new Error("Studio handoff rehearsal needs a new isolated /tmp directory.");
  }
  fixturePath(autodjPath, privateDirectory, ".mp3");
  fixturePath(manualPath, privateDirectory, ".mp3");
  fixturePath(playlistPath, privateDirectory, ".m3u");
  fixturePath(outputPath, privateDirectory, ".mp3");
  fixturePath(socketPath, privateDirectory, ".sock");
  if (new Set([autodjPath, manualPath, playlistPath, outputPath, socketPath]).size !== 5) {
    throw new Error("Studio handoff rehearsal inputs and outputs must be separate.");
  }
  return {
    playlistText: `${autodjPath}\n`,
    liquidsoapText: `settings.server.telnet := false\n` +
      `settings.server.socket := true\n` +
      `settings.server.socket.path := ${JSON.stringify(socketPath)}\n` +
      `settings.server.socket.permissions := 0o600\n` +
      `autodj = playlist(mode="normal", loop=true, reload_mode="never", ${JSON.stringify(playlistPath)})\n` +
      `studio_manual = request.queue(id="studio_manual")\n` +
      `source = fallback(track_sensitive=false, [studio_manual, autodj])\n` +
      `output.file(fallible=true, %mp3(bitrate=128), ${JSON.stringify(outputPath)}, source)\n`,
    manualPath,
    sourceCommandAllowed: false,
    listenerVerified: false
  };
}

export function matchesIsolatedStudioHandoff(labels) {
  if (!Array.isArray(labels) || labels.length < 6 || labels.length > 120 ||
      labels.some((label) => !["AUTODJ", "MANUAL", "UNKNOWN", "SILENCE", "PROTECTED"].includes(label)) ||
      labels.includes("PROTECTED") || labels.some((label, index) => label === "SILENCE" && labels[index + 1] === "SILENCE")) {
    return false;
  }
  const twoSecondRun = (label, after) => labels.findIndex((value, index) =>
    index > after && value === label && labels[index + 1] === label);
  const firstAuto = twoSecondRun("AUTODJ", -1);
  const manual = twoSecondRun("MANUAL", firstAuto + 1);
  const resumedAuto = twoSecondRun("AUTODJ", manual + 1);
  return firstAuto >= 0 && manual > firstAuto && resumedAuto > manual;
}
