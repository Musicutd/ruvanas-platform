// SHOUTcast v1 song updates use the source password (not the account/admin
// password). Verified against the provider-recommended BUTT 1.47.0 source:
// https://danielnoethen.de/butt/release/1.47.0/butt-1.47.0.tar.gz
// src/shoutcast.cpp sc_update_song uses the same cfg.srv[].pwd as its source.
// Provider HTTPS portal: https://help.streamerr.co/article/how-to-access-stream-status-page/
// Metadata readback: https://sc-mirror.shoutca.st/docs/DNAS_Server.html §5.1.1
// Importing this file does not connect. Only the explicit updater invocation
// can request the single isolated Test Radio HTTPS origin. Never log requests.
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { TEST_RADIO_CATALOGUE_TEST } from "./online-radio-catalogue-test.mjs";
import { validateCatalogueTestTarget } from "./catalogue-test-transport.mjs";
import { isPrivateNetworkAddress } from "./stream-source-health.mjs";

export const TEST_RADIO_METADATA_HOST = "ruvanastestradio-radio105network.radioca.st";
export const TEST_RADIO_METADATA_STREAM_URL = `https://${TEST_RADIO_METADATA_HOST}/stream`;
const fail = () => Object.assign(new Error("TEST_METADATA_REQUEST_FAILED"), { code: "TEST_METADATA_REQUEST_FAILED" });
const validSignal = signal => signal && typeof signal.aborted === "boolean" &&
  typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function";

// RFC3986 encoding, matching the source client's song/password escaping.
function encode(value) { return encodeURIComponent(value).replace(/[!'()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`); }

export function createCatalogueTestHttpsMetadataUpdater({ enabled = false, stationId, source, password,
  connection, registerResource, requestImpl = httpsRequest, lookupImpl = dnsLookup,
  timeoutMs = 1500, clock = { setTimeout, clearTimeout } } = {}) {
  if (enabled !== true) return async () => false;
  validateCatalogueTestTarget(source);
  if (stationId !== TEST_RADIO_CATALOGUE_TEST.stationId || source.streamUrl !== TEST_RADIO_METADATA_STREAM_URL ||
      connection?.authenticated !== true || typeof connection.hasError !== "function" ||
      typeof password !== "string" || password.length < 1 || password.length > 512 || /[\r\n\0]/.test(password) ||
      typeof registerResource !== "function" || typeof requestImpl !== "function" || typeof lookupImpl !== "function" ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 ||
      typeof clock?.setTimeout !== "function" || typeof clock?.clearTimeout !== "function") throw fail();

  function request(path, signal, maximumBytes) {
    if (signal.aborted || connection.hasError()) return Promise.resolve(null);
    return new Promise(resolve => {
      let req = null, response = null, reqClosed = false, responseClosed = false;
      let result = null, failed = false, total = 0, chunks = [], timer = null, unregister = null, settled = false;
      let resolveClosed;
      const closed = new Promise(done => { resolveClosed = done; });
      const complete = () => {
        if (settled || !reqClosed || response && !responseClosed) return;
        settled = true; clock.clearTimeout(timer); signal.removeEventListener("abort", stop);
        try { unregister?.(); } catch { /* cleanup must not expose adapter errors */ }
        resolveClosed(); resolve(!failed && !signal.aborted && !connection.hasError() ? result : null);
      };
      const stop = () => {
        failed = true; result = null; chunks = [];
        response?.destroy(); req?.destroy();
      };
      signal.addEventListener("abort", stop, { once: true });
      timer = clock.setTimeout(stop, timeoutMs);
      timer?.unref?.();
      try {
        req = requestImpl({ protocol: "https:", hostname: TEST_RADIO_METADATA_HOST, port: 443,
          servername: TEST_RADIO_METADATA_HOST, rejectUnauthorized: true, agent: false,
          method: "GET", path, maxHeaderSize: 8192,
          headers: { "User-Agent": "ShoutcastDSP (Mozilla Compatible)", "Accept": "text/plain, text/html;q=0.9", "Connection": "close" },
          // Resolve once and hand the checked address directly to the socket.
          // No second DNS lookup or redirect can move the password elsewhere.
          lookup(hostname, options, callback) {
            if (hostname !== TEST_RADIO_METADATA_HOST || signal.aborted || failed) return callback(fail());
            Promise.resolve().then(() => lookupImpl(hostname, { all: true, family: 4, verbatim: true })).then(addresses => {
              if (signal.aborted || failed || !Array.isArray(addresses) || !addresses.length ||
                  addresses.some(entry => entry.family !== 4 || isPrivateNetworkAddress(entry.address))) return callback(fail());
              const selected = { address: addresses[0].address, family: 4 };
              if (options?.all) callback(null, [selected]); else callback(null, selected.address, selected.family);
            }, () => callback(fail()));
          }
        }, incoming => {
          response = incoming;
          response.once("close", () => { responseClosed = true; complete(); });
          response.once("error", stop);
          response.once("aborted", stop);
          response.on("data", chunk => {
            if (failed || signal.aborted) return stop();
            total += chunk.length;
            if (total > maximumBytes) return stop();
            chunks.push(Buffer.from(chunk));
          });
          response.once("end", () => {
            if (!failed && !signal.aborted && response.statusCode === 200) {
              result = { status: 200, body: Buffer.concat(chunks).toString("utf8") };
            }
            chunks = [];
          });
          // Redirects, auth failures and other responses are never retried.
          if (failed || signal.aborted || incoming.statusCode !== 200) stop();
        });
        req.once("close", () => { reqClosed = true; complete(); });
        req.once("error", stop);
        unregister = registerResource({ forceClose: stop, close: async () => { stop(); await closed; } });
        if (signal.aborted || failed || connection.hasError()) stop(); else req.end();
      } catch {
        failed = true;
        if (req) stop();
        else { reqClosed = true; complete(); }
      }
    });
  }

  return async ({ metadata, signal } = {}) => {
    try {
      if (!validSignal(signal) || signal.aborted || connection.hasError() ||
          metadata?.stationId !== stationId || typeof metadata.displayTitle !== "string" ||
          !metadata.displayTitle.trim() || Buffer.byteLength(metadata.displayTitle, "utf8") > 512 ||
          /[\p{Cc}\p{Cf}\p{Cs}]/u.test(metadata.displayTitle)) return false;
      const expected = metadata.displayTitle;
      const submitted = await request(`/admin.cgi?pass=${encode(password)}&mode=updinfo&song=${encode(expected)}`, signal, 4096);
      if (!submitted || signal.aborted || connection.hasError()) return false;
      // A 200 error/login page is not proof. Confirm the title via Shoutcast's
      // public UTF-8 current-song endpoint without sending the password again.
      const observed = await request("/currentsong?sid=1", signal, 1024);
      return Boolean(observed && !signal.aborted && !connection.hasError() && observed.body.trim() === expected);
    } catch { return false; }
  };
}
