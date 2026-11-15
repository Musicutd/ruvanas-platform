import jsQR from "jsqr";
import { parseCheckoutQrPayload } from "./checkout-qr.mjs";

export const SCANNER_MAX_DIMENSION = 640;
export const SCANNER_INTERVAL_MS = 250;
export const SCANNER_TIMEOUT_MS = 60_000;
const MESSAGES = Object.freeze({
  STARTING: "Allow camera access to scan the shopper’s QR code.",
  SCANNING: "Point the camera at the shopper’s current checkout QR code.",
  INVALID_CODE: "This is not a Ruvanas checkout QR code. Keep scanning or paste the code manually.",
  SUCCESS: "Code scanned. Review the coupon and purchase conditions before confirming redemption.",
  CANCELLED: "Camera stopped. You can paste the checkout code instead.",
  HIDDEN: "Camera stopped because you left this screen. Start scanning again when ready.",
  TIMEOUT: "Scanning timed out and the camera stopped. Try again or paste the checkout code.",
  UNSUPPORTED: "Camera scanning is unavailable here. Paste the checkout code instead.",
  DENIED: "Camera access was not allowed. Paste the checkout code or change your browser’s camera permission.",
  NO_CAMERA: "No usable camera was found. Paste the checkout code instead.",
  ERROR: "The camera could not continue. It has stopped; paste the checkout code or try again."
});
export function scannerStatusMessage(code) { return MESSAGES[code] || MESSAGES.ERROR; }
function stopTracks(stream) {
  try { for (const track of stream?.getTracks?.() || []) { try { track.stop(); } catch {} } } catch {}
}

/** Browser-only camera adapter. Construction never requests camera access.
 * Frames stay in memory, decode serially at <=4fps, and never leave the device.
 * Injection points support synthetic browser/tests without touching real cameras. */
export function createCheckoutScanner({ video, canvas, onToken = () => {}, onState = () => {},
  mediaDevices = globalThis.navigator?.mediaDevices, decode = jsQR,
  documentTarget = globalThis.document, windowTarget = globalThis.window,
  setTimeoutFn = globalThis.setTimeout, clearTimeoutFn = globalThis.clearTimeout } = {}) {
  let generation = 0, active = false, disposed = false, stream = null, context = null;
  let frameTimer = null, deadlineTimer = null, lastState = null;
  function state(value) {
    if (disposed || lastState === value) return;
    lastState = value;
    try { onState(value); } catch {}
  }
  function release() {
    if (frameTimer !== null) clearTimeoutFn(frameTimer);
    if (deadlineTimer !== null) clearTimeoutFn(deadlineTimer);
    frameTimer = deadlineTimer = null;
    const previous = stream; stream = null;
    stopTracks(previous);
    try { video?.pause?.(); } catch {}
    try { if (video) video.srcObject = null; } catch {}
    // Drop all captured pixels, including a possibly valid private checkout QR.
    try { if (canvas) { canvas.width = 0; canvas.height = 0; } } catch {}
    context = null;
  }
  function stop(reason = "CANCELLED") {
    const wasActive = active;
    active = false; generation++; release();
    if (wasActive) state(Object.hasOwn(MESSAGES, reason) ? reason : "CANCELLED");
  }
  function current(id) { return active && !disposed && generation === id; }
  async function frame(id) {
    frameTimer = null;
    if (!current(id)) return;
    if (documentTarget?.hidden) { stop("HIDDEN"); return; }
    try {
      const sourceWidth = Number(video.videoWidth), sourceHeight = Number(video.videoHeight);
      if (video.readyState >= 2 && Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight) && sourceWidth > 0 && sourceHeight > 0) {
        const ratio = Math.min(1, SCANNER_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.floor(sourceWidth * ratio)), height = Math.max(1, Math.floor(sourceHeight * ratio));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        const result = await decode(image.data, width, height, { inversionAttempts: "dontInvert" });
        if (!current(id)) return;
        if (result?.data !== undefined) {
          const token = parseCheckoutQrPayload(result.data);
          if (token) {
            stop("SUCCESS");
            try { onToken(token); } catch {}
            return;
          }
          state("INVALID_CODE");
        }
      }
    } catch { if (current(id)) stop("ERROR"); return; }
    if (current(id)) frameTimer = setTimeoutFn(() => frame(id), SCANNER_INTERVAL_MS);
  }
  async function start() {
    if (disposed || active) return false;
    if (documentTarget?.hidden) { state("HIDDEN"); return false; }
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function" || !video || typeof video.play !== "function" ||
      !canvas || typeof canvas.getContext !== "function" || typeof decode !== "function") { state("UNSUPPORTED"); return false; }
    try { context = canvas.getContext("2d", { willReadFrequently: true }); }
    catch { state("UNSUPPORTED"); return false; }
    if (!context) { state("UNSUPPORTED"); return false; }
    active = true; const id = ++generation; state("STARTING");
    deadlineTimer = setTimeoutFn(() => { if (current(id)) stop("TIMEOUT"); }, SCANNER_TIMEOUT_MS);
    try {
      const acquired = await mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } } });
      if (!current(id)) { stopTracks(acquired); return false; }
      if (!acquired || typeof acquired.getTracks !== "function" || acquired.getTracks().length === 0) { stopTracks(acquired); stop("NO_CAMERA"); return false; }
      stream = acquired; video.muted = true; video.playsInline = true; video.srcObject = acquired;
      await video.play();
      if (!current(id)) return false;
      state("SCANNING"); frameTimer = setTimeoutFn(() => frame(id), SCANNER_INTERVAL_MS);
      return true;
    } catch (error) {
      if (current(id)) stop(["NotAllowedError", "SecurityError"].includes(error?.name) ? "DENIED" :
        ["NotFoundError", "DevicesNotFoundError", "OverconstrainedError"].includes(error?.name) ? "NO_CAMERA" : "ERROR");
      return false;
    }
  }
  const hidden = () => { if (documentTarget?.hidden) stop("HIDDEN"); };
  const pagehide = () => stop("HIDDEN");
  documentTarget?.addEventListener?.("visibilitychange", hidden);
  windowTarget?.addEventListener?.("pagehide", pagehide);
  function dispose() {
    disposed = true; stop();
    documentTarget?.removeEventListener?.("visibilitychange", hidden);
    windowTarget?.removeEventListener?.("pagehide", pagehide);
  }
  return Object.freeze({ start, stop, dispose });
}
