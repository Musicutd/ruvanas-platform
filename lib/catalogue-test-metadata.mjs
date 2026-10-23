// Network-free confirmed-audio metadata dispatcher. The opt-in owner-test
// entry point requires an injected, separately guarded provider updater.
// The off-air entry point remains useful with local mock adapters only.
import { TEST_RADIO_CATALOGUE_TEST } from "./online-radio-catalogue-test.mjs";
import { catalogueTestProfileForSession } from "./catalogue-test-profiles.mjs";
import { validateCatalogueTestTarget } from "./catalogue-test-transport.mjs";

const fail = code => Object.assign(new Error(code), { code });
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const safeResult = code => Object.freeze({ code });
const validSignal = signal => signal && typeof signal.aborted === "boolean" &&
  typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function";

function text(value, maximumBytes) {
  if (typeof value !== "string") return "";
  // Bound input work as well as the output. Never split a Unicode code point.
  const normalized = value.slice(0, 4096).normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, " ").replace(/\s+/gu, " ").trim();
  let result = "", bytes = 0;
  for (const point of normalized) {
    const size = Buffer.byteLength(point, "utf8");
    if (bytes + size > maximumBytes) break;
    result += point; bytes += size;
  }
  return result.trim();
}

export function catalogueTestTrackMetadata(item) {
  const track = item?.track;
  if (!identifier(item?.id) || track?.id !== item.id) return null;
  const title = text(track.title, 256), artist = text(track.artist, 192);
  if (!title) return null;
  return Object.freeze({ trackId: item.id, title, artist,
    displayTitle: artist ? `${artist} — ${title}` : title });
}

/**
 * An adapter must honor AbortSignal and settle only after its operation has stopped.
 * We never overlap adapters: a stalled/uncertain prior operation suppresses
 * new metadata, without holding up or cancelling the audio path.
 *
 * Integration must call audioStarted only AFTER a successful source write,
 * not when a file is queued/decoded, and must call close at source shutdown.
 * The runner's existing heartbeat remains the authority for rights/leases.
 */
function createMetadataDispatcher({ mode, session, source, connection,
  update, signal, clock, timeoutMs = 750 } = {}) {
  const profile = catalogueTestProfileForSession(session);
  if (!["OFF_AIR", "BOUNDED_OWNER_TEST"].includes(mode) || typeof update !== "function" || !validSignal(signal) ||
      !clock || ["now", "setTimeout", "clearTimeout"].some(key => typeof clock[key] !== "function") ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > (mode === "OFF_AIR" ? 1000 : 3000)) throw fail("TEST_METADATA_OPTIONS_INVALID");
  if (!profile || session?.authorized !== true || !identifier(session.id) ||
      session.stationId !== TEST_RADIO_CATALOGUE_TEST.stationId || connection?.authenticated !== true ||
      !Array.isArray(session.tracks) || !session.tracks.length || session.tracks.length > profile.maximumItems ||
      !(session.deadlineAt instanceof Date) || !(session.authorizationExpiresAt instanceof Date)) throw fail("TEST_METADATA_SESSION_INVALID");
  validateCatalogueTestTarget(source);
  const deadline = Math.min(session.deadlineAt.getTime(), session.authorizationExpiresAt.getTime());
  const instant = clock.now();
  if (!Number.isFinite(instant) || !Number.isFinite(deadline) || deadline <= instant) throw fail("TEST_METADATA_SESSION_INVALID");
  const tracks = session.tracks.map(catalogueTestTrackMetadata);
  if (tracks.some(value => !value) || new Set(tracks.map(value => value.trackId)).size !== tracks.length) throw fail("TEST_METADATA_TRACK_INVALID");
  const scope = Object.freeze({ stationId: session.stationId, sessionId: session.id });
  let closed = false, latestIndex = -1, sequence = 0, rawTail = Promise.resolve();
  const requests = new Set();
  const close = () => {
    closed = true;
    signal.removeEventListener("abort", close);
    clock.clearTimeout(deadlineTimer);
    for (const controller of requests) controller.abort("TEST_METADATA_CANCELLED");
  };
  const deadlineTimer = clock.setTimeout(close, Math.max(1, deadline - instant));
  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) close();

  function audioStarted({ trackId, audioBytesSent } = {}) {
    const now = clock.now();
    if (closed || signal.aborted || !Number.isFinite(now) || now >= deadline) {
      close(); return Promise.resolve(safeResult("TEST_METADATA_CLOSED"));
    }
    const index = tracks.findIndex(track => track.trackId === trackId);
    if (index < 0 || !Number.isSafeInteger(audioBytesSent) || audioBytesSent < 1) return Promise.resolve(safeResult("TEST_METADATA_AUDIO_UNCONFIRMED"));
    if (index <= latestIndex) return Promise.resolve(safeResult("TEST_METADATA_DUPLICATE_OR_STALE"));
    latestIndex = index;
    const currentSequence = ++sequence;
    for (const request of requests) request.abort("TEST_METADATA_SUPERSEDED");
    const controller = new AbortController();
    requests.add(controller);
    const metadata = Object.freeze({ ...tracks[index], ...scope, sequence: currentSequence });
    const prior = rawTail;
    // The raw tail intentionally remains pending if a mock ignores abort.
    // Later calls time out without launching a concurrent, out-of-order update.
    const raw = prior.then(async () => {
      const currentTime = clock.now();
      if (closed || controller.signal.aborted || currentSequence !== sequence || !Number.isFinite(currentTime) || currentTime >= deadline) return false;
      return await update({ metadata, signal: controller.signal });
    });
    rawTail = raw.catch(() => undefined);
    return new Promise(resolve => {
      let settled = false;
      const finish = code => {
        if (settled) return;
        settled = true; clock.clearTimeout(timer);
        controller.signal.removeEventListener("abort", aborted);
        requests.delete(controller);
        resolve(safeResult(code));
      };
      const aborted = () => finish(controller.signal.reason === "TEST_METADATA_TIMEOUT" ? "TEST_METADATA_TIMEOUT" : "TEST_METADATA_CANCELLED");
      const timer = clock.setTimeout(() => controller.abort("TEST_METADATA_TIMEOUT"), Math.max(1, Math.min(timeoutMs, deadline - now)));
      controller.signal.addEventListener("abort", aborted, { once: true });
      raw.then(result => finish(!closed && !controller.signal.aborted && currentSequence === sequence && result === true
        ? mode === "OFF_AIR" ? "TEST_METADATA_MOCK_UPDATED" : "TEST_METADATA_VERIFIED" : "TEST_METADATA_NOT_UPDATED"), () => finish("TEST_METADATA_UPDATE_FAILED"));
      if (controller.signal.aborted) aborted();
    });
  }
  return Object.freeze({ audioStarted, close });
}

export function createOffAirCatalogueTestMetadata(options = {}) {
  if (options.mode !== "OFF_AIR") throw fail("TEST_METADATA_OPTIONS_INVALID");
  return createMetadataDispatcher(options);
}

export function createCatalogueTestMetadata(options = {}) {
  if (options.mode !== "BOUNDED_OWNER_TEST") throw fail("TEST_METADATA_OPTIONS_INVALID");
  return createMetadataDispatcher({ timeoutMs: 2000, ...options });
}
