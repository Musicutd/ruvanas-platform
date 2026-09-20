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
  privateDirectory, autodjPath, manualPath, protectedPath = null, playlistPath, outputPath, socketPath
}) {
  if (!TARGET_PATTERN.test(privateDirectory) || path.posix.normalize(privateDirectory) !== privateDirectory) {
    throw new Error("Studio handoff rehearsal needs a new isolated /tmp directory.");
  }
  fixturePath(autodjPath, privateDirectory, ".mp3");
  fixturePath(manualPath, privateDirectory, ".mp3");
  if (protectedPath !== null) fixturePath(protectedPath, privateDirectory, ".mp3");
  fixturePath(playlistPath, privateDirectory, ".m3u");
  fixturePath(outputPath, privateDirectory, ".mp3");
  fixturePath(socketPath, privateDirectory, ".sock");
  const paths = [autodjPath, manualPath, playlistPath, outputPath, socketPath];
  if (protectedPath !== null) paths.push(protectedPath);
  if (new Set(paths).size !== paths.length) {
    throw new Error("Studio handoff rehearsal inputs and outputs must be separate.");
  }
  return {
    playlistText: `${autodjPath}\n`,
    liquidsoapText: `settings.server.telnet.set(false)\n` +
      `settings.server.socket.set(true)\n` +
      `settings.server.socket.path.set(${JSON.stringify(socketPath)})\n` +
      `settings.server.socket.permissions.set(0o600)\n` +
      `autodj = playlist(mode="normal", loop=true, reload_mode="never", ${JSON.stringify(playlistPath)})\n` +
      `studio_manual = request.queue(id="studio_manual")\n` +
      (protectedPath ? `studio_protected = request.queue(id="studio_protected")\n` : "") +
      `source = fallback(track_sensitive=false, [${protectedPath ? "studio_protected, " : ""}studio_manual, autodj])\n` +
      `output.file(fallible=true, %mp3(bitrate=128), ${JSON.stringify(outputPath)}, source)\n`,
    manualPath,
    sourceCommandAllowed: false,
    listenerVerified: false
  };
}

// File-only priority rehearsal. The classifier cannot establish where the
// recording came from or that a real encoder stopped on a rights change.
export function matchesIsolatedStudioPriorityHandoff(labels) {
  if (!Array.isArray(labels) || labels.length < 8 || labels.length > 120 ||
      labels.some((label) => !["AUTODJ", "MANUAL", "PROTECTED", "UNKNOWN", "SILENCE"].includes(label)) ||
      labels.some((label, index) => label === "SILENCE" && labels[index + 1] === "SILENCE")) return false;
  const twoSecondRun = (label, after) => labels.findIndex((value, index) =>
    index > after && value === label && labels[index + 1] === label);
  const firstAuto = twoSecondRun("AUTODJ", -1);
  const manual = twoSecondRun("MANUAL", firstAuto + 1);
  const protectedStart = twoSecondRun("PROTECTED", manual + 1);
  const resumedAuto = twoSecondRun("AUTODJ", protectedStart + 1);
  // The Manual fixture lasts eight seconds. An interruption must be heard
  // while it is still playing, not merely after it naturally finishes.
  return firstAuto >= 0 && manual > firstAuto && protectedStart > manual &&
    protectedStart - manual <= 6 &&
    labels.indexOf("PROTECTED") >= manual && resumedAuto > protectedStart &&
    !labels.slice(labels.lastIndexOf("PROTECTED") + 1).includes("MANUAL");
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
