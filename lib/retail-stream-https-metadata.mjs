// Optional song-title delivery for the existing Test Retail source only.
// This module grants no playback/lease authority and never starts audio.
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { validateSubscriberStreamTarget } from "./subscriber-stream-transport.mjs";
import { retailPublicAddress } from "./retail-stream-connection-check.mjs";

export const RETAIL_METADATA_STATION_ID = "cmvmg7rp1000flf2kelb1kzax";
export const RETAIL_METADATA_HOST = "ruvanastestretail-radio105network.radioca.st";
export const RETAIL_METADATA_STREAM_URL = `https://${RETAIL_METADATA_HOST}/stream`;
const fail = () => Object.assign(new Error("RETAIL_METADATA_UNAVAILABLE"), { code: "RETAIL_METADATA_UNAVAILABLE" });
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const validSignal = signal => typeof signal?.aborted === "boolean" && typeof signal?.addEventListener === "function" && typeof signal?.removeEventListener === "function";
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, point => `%${point.charCodeAt(0).toString(16).toUpperCase()}`);

function label(value, maximumBytes) {
  if (typeof value !== "string") return "";
  const normalized = value.slice(0, 4096).normalize("NFC").replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, " ").replace(/\s+/gu, " ").trim();
  let result = "", bytes = 0;
  for (const point of normalized) {
    const size = Buffer.byteLength(point, "utf8");
    if (bytes + size > maximumBytes) break;
    result += point; bytes += size;
  }
  return result.trim();
}
export function retailTrackMetadata(track) {
  if (!identifier(track?.id)) return null;
  const title = label(track.title, 256), artist = label(track.artist, 192);
  if (!title) return null;
  return Object.freeze({ stationId: RETAIL_METADATA_STATION_ID, trackId: track.id,
    displayTitle: artist ? `${artist} — ${title}` : title });
}
function validMetadata(value) {
  return value?.stationId === RETAIL_METADATA_STATION_ID && identifier(value.trackId) &&
    typeof value.displayTitle === "string" && value.displayTitle.trim() && Buffer.byteLength(value.displayTitle, "utf8") <= 512 &&
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value.displayTitle);
}

/** The source credential goes only to the fixed, TLS-verified Retail origin.
 * Requests settle after socket cleanup, so an old update cannot overlap a new
 * title. A 200 response alone never establishes that the song was accepted.
 */
export function createRetailHttpsMetadataUpdater({ enabled = false, stationId, source, password, connection,
  registerResource, requestImpl = httpsRequest, lookupImpl = dnsLookup, timeoutMs = 1500, clock = { setTimeout, clearTimeout } } = {}) {
  if (enabled !== true) return async () => false;
  try {
    validateSubscriberStreamTarget(source);
    if (stationId !== RETAIL_METADATA_STATION_ID || source.stationId !== stationId ||
        !["pollux.shoutca.st", "pollux.shoutcast.com"].includes(source.serverHost) || source.sourcePort !== 8330 || source.serverPort !== 8330 ||
        source.centovaUsername !== "ruvanastestretail" || source.streamUrl !== RETAIL_METADATA_STREAM_URL || source.outboundAutoDjEnabled !== false ||
        connection?.authenticated !== true || typeof connection.hasError !== "function" ||
        typeof password !== "string" || !password.length || password.length > 512 || /[\r\n\0]/.test(password) ||
        typeof registerResource !== "function" || typeof requestImpl !== "function" || typeof lookupImpl !== "function" ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 ||
        typeof clock?.setTimeout !== "function" || typeof clock?.clearTimeout !== "function") throw fail();
  } catch { throw fail(); }

  function request(path, signal, maximumBytes) {
    if (signal.aborted || connection.hasError()) return Promise.resolve(null);
    return new Promise(resolve => {
      let req = null, response = null, reqClosed = false, responseClosed = false, failed = false, settled = false;
      let result = null, total = 0, chunks = [], unregister = null, resolveClosed;
      const closed = new Promise(done => { resolveClosed = done; });
      const complete = () => {
        if (settled || !reqClosed || response && !responseClosed) return;
        settled = true; clock.clearTimeout(timer); signal.removeEventListener("abort", stop);
        try { unregister?.(); } catch { /* no adapter error or secret enters logs */ }
        resolveClosed(); resolve(!failed && !signal.aborted && !connection.hasError() ? result : null);
      };
      const stop = () => { failed = true; result = null; chunks = []; response?.destroy(); req?.destroy(); };
      const timer = clock.setTimeout(stop, timeoutMs);
      signal.addEventListener("abort", stop, { once: true });
      try {
        req = requestImpl({ protocol: "https:", hostname: RETAIL_METADATA_HOST, port: 443, servername: RETAIL_METADATA_HOST,
          rejectUnauthorized: true, agent: false, method: "GET", path, maxHeaderSize: 8192,
          headers: { "User-Agent": "ShoutcastDSP (Mozilla Compatible)", Accept: "text/plain, text/html;q=0.9", Connection: "close" },
          lookup(hostname, options, callback) {
            if (hostname !== RETAIL_METADATA_HOST || failed || signal.aborted) return callback(fail());
            Promise.resolve().then(() => lookupImpl(hostname, { all: true, family: 4, verbatim: true })).then(addresses => {
              if (failed || signal.aborted || !Array.isArray(addresses) || !addresses.length || addresses.length > 32 ||
                  addresses.some(entry => entry.family !== 4 || net.isIP(entry.address) !== 4 || !retailPublicAddress(entry.address))) return callback(fail());
              const selected = { address: addresses[0].address, family: 4 };
              if (options?.all) callback(null, [selected]); else callback(null, selected.address, selected.family);
            }, () => callback(fail()));
          }
        }, incoming => {
          response = incoming;
          response.once("close", () => { responseClosed = true; complete(); });
          response.once("error", stop); response.once("aborted", stop);
          response.on("data", chunk => {
            if (failed || signal.aborted) return stop();
            total += chunk.length; if (total > maximumBytes) return stop();
            chunks.push(Buffer.from(chunk));
          });
          response.once("end", () => {
            if (!failed && !signal.aborted && response.statusCode === 200) result = Buffer.concat(chunks).toString("utf8");
            chunks = [];
          });
          // Never follow redirects, retry authentication or return response text.
          if (failed || signal.aborted || response.statusCode !== 200) stop();
        });
        req.once("close", () => { reqClosed = true; complete(); }); req.once("error", stop);
        unregister = registerResource({ forceClose: stop, close: async () => { stop(); await closed; } });
        if (signal.aborted || failed || connection.hasError()) stop(); else req.end();
      } catch {
        failed = true; if (req) stop(); else { reqClosed = true; complete(); }
      }
    });
  }
  return async ({ metadata, signal } = {}) => {
    try {
      if (!validSignal(signal) || signal.aborted || connection.hasError() || !validMetadata(metadata)) return false;
      const expected = metadata.displayTitle;
      const submitted = await request(`/admin.cgi?pass=${encode(password)}&mode=updinfo&song=${encode(expected)}`, signal, 4096);
      if (submitted === null || signal.aborted || connection.hasError()) return false;
      const observed = await request("/currentsong?sid=1", signal, 1024);
      return Boolean(observed !== null && !signal.aborted && !connection.hasError() && observed.trim() === expected);
    } catch { return false; }
  };
}

/** A single in-flight request and one latest pending title. Superseding aborts
 * the old request, but its raw promise must settle before a later update runs.
 * Failures report a safe code only and never call the audio watchdog.
 */
export function createRetailMetadataQueue({ update, signal, onResult = () => {}, timeoutMs = 2500 } = {}) {
  if (typeof update !== "function" || !validSignal(signal) || typeof onResult !== "function" ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3000) throw fail();
  let latest = null, task = null, active = null, closed = false, sequence = 0;
  const report = verified => { try { onResult(verified ? "RETAIL_METADATA_VERIFIED" : "RETAIL_METADATA_UNVERIFIED"); } catch {} };
  const stop = () => { closed = true; latest = null; active?.abort(); };
  signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
  async function drain() {
    while (!closed && latest) {
      const item = latest; latest = null;
      const controller = new AbortController(); active = controller;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let verified = false;
      try { verified = await update({ metadata: item.metadata, signal: controller.signal }) === true; }
      catch { /* request/credential text stays private */ }
      finally { clearTimeout(timer); if (active === controller) active = null; }
      if (!closed && item.sequence === sequence) report(verified && !controller.signal.aborted);
    }
  }
  function start() {
    if (!task && !closed) task = Promise.resolve().then(drain).finally(() => { task = null; if (!closed && latest) start(); });
  }
  return Object.freeze({
    push(metadata) {
      if (closed || !validMetadata(metadata)) return false;
      latest = { metadata: Object.freeze({ stationId: metadata.stationId, trackId: metadata.trackId, displayTitle: metadata.displayTitle }), sequence: ++sequence };
      active?.abort(); start(); return true;
    },
    async flush() { while (task) await task; },
    async close() { stop(); signal.removeEventListener("abort", stop); while (task) await task; return true; }
  });
}
