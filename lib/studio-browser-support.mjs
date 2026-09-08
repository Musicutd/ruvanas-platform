export const STUDIO_RECORDING_MIME_TYPES = Object.freeze([
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4"
]);

export function inspectStudioBrowserSupport({
  mediaDevices,
  MediaRecorderClass,
  AudioContextClass,
  indexedDb
} = {}) {
  const microphoneReady = typeof mediaDevices?.getUserMedia === "function";
  const deviceListReady = typeof mediaDevices?.enumerateDevices === "function";
  const recorderReady = typeof MediaRecorderClass === "function";
  const audioContextReady = typeof AudioContextClass === "function";
  const recoveryReady = Boolean(indexedDb && typeof indexedDb.open === "function");
  let preferredMimeType = "";

  if (recorderReady && typeof MediaRecorderClass.isTypeSupported === "function") {
    preferredMimeType = STUDIO_RECORDING_MIME_TYPES.find((type) => {
      try {
        return MediaRecorderClass.isTypeSupported(type);
      } catch {
        return false;
      }
    }) || "";
  }

  const missing = [];
  if (!microphoneReady) missing.push("microphone capture");
  if (!recorderReady) missing.push("audio recording");
  if (!audioContextReady) missing.push("live audio monitoring");

  return {
    ready: missing.length === 0,
    microphoneReady,
    deviceListReady,
    recorderReady,
    audioContextReady,
    recoveryReady,
    preferredMimeType,
    missing
  };
}

export function studioBrowserSupportMessage(support) {
  if (support?.ready) return "Studio recording is supported in this browser.";
  const missing = support?.missing?.length ? support.missing.join(", ") : "required audio features";
  return `This browser cannot provide ${missing}. Use a current version of Chrome, Edge, Firefox or Safari.`;
}
