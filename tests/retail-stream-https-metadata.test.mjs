import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRetailHttpsMetadataUpdater, RETAIL_METADATA_HOST, RETAIL_METADATA_STREAM_URL,
  RETAIL_METADATA_STATION_ID, retailTrackMetadata, createRetailMetadataQueue } from "../lib/retail-stream-https-metadata.mjs";

const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
function fakeClock() {
  let nextId = 0;
  const timers = new Map();
  return { setTimeout(fn) { const id = ++nextId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    expire() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } }, count: () => timers.size };
}
function fixture(responses = [{ status: 200, body: "OK" }, { status: 200, body: "Artist — Song" }]) {
  const requests = [], resources = new Set(), controller = new AbortController(), clock = fakeClock();
  let disconnected = false, successfulLookups = 0;
  const options = {
    enabled: true, stationId: "cmvmg7rp1000flf2kelb1kzax",
    source: { providerKey: "CENTOVA_CAST", serverHost: "pollux.shoutca.st", sourcePort: 8330, serverPort: 8330, outputCodec: "MP3", stationId: "cmvmg7rp1000flf2kelb1kzax", bitrateKbps: 128,
      centovaUsername: "ruvanastestretail", sourceUsername: null, outboundAutoDjEnabled: false,
      sourcePasswordEncrypted: "synthetic-encrypted", streamUrl: RETAIL_METADATA_STREAM_URL },
    password: "synthetic source &+=?!'() secret",
    connection: { authenticated: true, hasError: () => disconnected }, clock,
    registerResource(resource) { resources.add(resource); return () => resources.delete(resource); },
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    requestImpl(requestOptions, callback) {
      const req = new EventEmitter(), reply = responses[requests.length];
      const captured = { options: requestOptions, req, ended: false, destroyed: false, response: null };
      requests.push(captured);
      let reqClosed = false;
      const closeRequest = () => { if (!reqClosed) { reqClosed = true; req.emit("close"); } };
      req.destroy = () => {
        captured.destroyed = true;
        captured.response?.destroy();
        queueMicrotask(closeRequest); return req;
      };
      req.end = () => {
        captured.ended = true;
        requestOptions.lookup(requestOptions.hostname, { all: true }, error => {
          if (error) { req.emit("error", new Error("secret-bearing simulated DNS error")); return; }
          if (captured.destroyed) return;
          successfulLookups++;
          if (reply?.hang) return;
          const res = new EventEmitter();
          captured.response = res; res.statusCode = reply?.status ?? 200;
          res.headers = reply?.headers || {};
          let responseClosed = false;
          res.destroy = () => { if (!responseClosed) { responseClosed = true; res.emit("close"); } return res; };
          callback(res);
          if (!responseClosed) {
            if (reply?.error) res.emit("error", new Error("Provider secret error /?pass=private"));
            else { res.emit("data", Buffer.from(reply?.body || "", "utf8")); if (!responseClosed) res.emit("end"); }
          }
          res.destroy(); closeRequest();
        });
        return req;
      };
      return req;
    }
  };
  const metadata = { trackId: "track-1", stationId: options.stationId, displayTitle: "Artist — Song" };
  return { options, requests, resources, controller, clock, metadata, make: () => createRetailHttpsMetadataUpdater(options),
    run: updater => updater({ metadata, signal: controller.signal }), disconnect: () => { disconnected = true; }, lookupCount: () => successfulLookups };
}

test("disabled adapter never uses a credential, creates a request or resolves DNS", async () => {
  const f = fixture(); f.options.enabled = false; f.options.password = null;
  assert.equal(await f.run(f.make()), false); assert.equal(f.requests.length, 0);
});

test("updater accepts only Test Retail's exact HTTPS origin and existing source identity", () => {
  for (const change of [{ stationId: "other" }, { password: "" }, { password: "secret\nheader" }, { password: "x".repeat(513) },
    { connection: { authenticated: false } }, { registerResource: null }, { timeoutMs: 2001 }, { lookupImpl: null }]) {
    const f = fixture(); Object.assign(f.options, change);
    assert.throws(() => f.make()); assert.equal(f.requests.length, 0);
  }
  for (const change of [{ sourcePort: 8393 }, { sourcePort: 8282 }, { stationId: "cmvcnbwi20008hr23sd76psi8" },
    { serverPort: 8282 }, { centovaUsername: "ruvanastestradio" }, { centovaUsername: "radio105" }, { outboundAutoDjEnabled: true },
    { streamUrl: "http://pollux.shoutca.st:8282/stream" }, { streamUrl: "https://other.radioca.st/stream" },
    { streamUrl: `${RETAIL_METADATA_STREAM_URL}?next=other` }, { serverHost: "127.0.0.1" }, { serverHost: "different.shoutca.st" }]) {
    const f = fixture(); Object.assign(f.options.source, change);
    assert.throws(() => f.make()); assert.equal(f.requests.length, 0);
  }
  const alias = fixture(); alias.options.source.serverHost = "pollux.shoutcast.com";
  assert.equal(typeof alias.make(), "function");
});

test("existing source password is URL-encoded only on fixed HTTPS update; exact current-song readback confirms success", async () => {
  const f = fixture(), update = f.make();
  assert.equal(await f.run(update), true); assert.equal(f.requests.length, 2);
  const first = f.requests[0].options, second = f.requests[1].options;
  for (const options of [first, second]) {
    assert.equal(options.protocol, "https:"); assert.equal(options.hostname, RETAIL_METADATA_HOST);
    assert.equal(options.servername, RETAIL_METADATA_HOST); assert.equal(options.port, 443);
    assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false);
    assert.equal(options.method, "GET"); assert.equal(options.headers.Authorization, undefined);
  }
  const url = new URL(first.path, `https://${RETAIL_METADATA_HOST}`);
  assert.equal(url.pathname, "/admin.cgi"); assert.equal(url.searchParams.get("pass"), f.options.password);
  assert.equal(url.searchParams.get("mode"), "updinfo"); assert.equal(url.searchParams.get("song"), f.metadata.displayTitle);
  assert.ok(!first.path.includes(f.options.password)); assert.ok(first.path.includes("%26"));
  assert.equal(second.path, "/currentsong?sid=1"); assert.ok(!second.path.includes("pass"));
  assert.equal(f.resources.size, 0); assert.equal(f.clock.count(), 0);
});

test("HTTP 200 alone or a wrong title is never proof of successful metadata", async () => {
  for (const body of ["", "Wrong title", "<html>Login page</html>", "Artist — Song extra"]) {
    const f = fixture([{ status: 200, body: "OK" }, { status: 200, body }]);
    assert.equal(await f.run(f.make()), false); assert.equal(f.requests.length, 2); assert.equal(f.resources.size, 0);
  }
});

test("redirects, authentication failures and unavailable endpoints are not followed or retried", async () => {
  for (const status of [301, 302, 307, 401, 403, 404, 500, 502]) {
    const f = fixture([{ status, headers: { location: "https://another-channel.example/admin.cgi" }, body: "not returned" }]);
    assert.equal(await f.run(f.make()), false); assert.equal(f.requests.length, 1);
    assert.equal(f.resources.size, 0); assert.equal(f.clock.count(), 0);
  }
});

test("private and ambiguous DNS answers cannot receive the source credential", async () => {
  for (const addresses of [[], [{ address: "127.0.0.1", family: 4 }], [{ address: "10.0.0.1", family: 4 }],
    [{ address: "93.184.216.34", family: 4 }, { address: "192.168.1.1", family: 4 }], [{ address: "::1", family: 6 }]]) {
    const f = fixture(); f.options.lookupImpl = async () => addresses;
    assert.equal(await f.run(f.make()), false); assert.equal(f.lookupCount(), 0);
    assert.equal(f.requests.length, 1); assert.equal(f.resources.size, 0);
  }
});

test("wrong-station, control characters, oversized titles or disconnected audio never request metadata", async () => {
  for (const metadata of [{ stationId: "other", displayTitle: "Song" }, { stationId: "cmvmg7rp1000flf2kelb1kzax", displayTitle: "A\nB" },
    { stationId: "cmvmg7rp1000flf2kelb1kzax", displayTitle: "😀".repeat(129) }, { stationId: "cmvmg7rp1000flf2kelb1kzax", displayTitle: " " }]) {
    const f = fixture(), update = f.make();
    assert.equal(await update({ metadata: { trackId: "track-1", ...metadata }, signal: f.controller.signal }), false); assert.equal(f.requests.length, 0);
  }
  const f = fixture(), update = f.make(); f.disconnect();
  assert.equal(await f.run(update), false); assert.equal(f.requests.length, 0);
});

test("watchdog force-close and abort terminate pending requests without readback or retry", async () => {
  for (const stop of [f => f.controller.abort(), f => { for (const resource of f.resources) resource.forceClose(); }, f => f.clock.expire()]) {
    const f = fixture([{ hang: true }]), update = f.make(), pending = f.run(update);
    await flush(); assert.equal(f.resources.size, 1);
    stop(f); await flush(); assert.equal(await pending, false);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].destroyed, true);
    assert.equal(f.resources.size, 0); assert.equal(f.clock.count(), 0);
  }
});

test("watchdog close resolves only after pending request closure", async () => {
  const f = fixture([{ hang: true }]), pending = f.run(f.make()); await flush();
  const resource = [...f.resources][0]; let closeConfirmed = false;
  const closed = resource.close().then(() => { closeConfirmed = true; });
  assert.equal(closeConfirmed, false); await closed;
  assert.equal(closeConfirmed, true); assert.equal(await pending, false); assert.equal(f.resources.size, 0);
});

test("stalled DNS is time-bounded; a late answer cannot reconnect after cancellation", async () => {
  let finishDns;
  const f = fixture(); f.options.lookupImpl = () => new Promise(resolve => { finishDns = resolve; });
  const pending = f.run(f.make()); await flush(); f.clock.expire(); await flush();
  assert.equal(await pending, false); finishDns([{ address: "93.184.216.34", family: 4 }]); await flush();
  assert.equal(f.lookupCount(), 0); assert.equal(f.requests.length, 1); assert.equal(f.resources.size, 0);
});

test("oversized and secret-bearing error responses remain contained", async () => {
  for (const reply of [{ status: 200, body: "x".repeat(4097) }, { error: true }]) {
    const f = fixture([reply]);
    assert.equal(await f.run(f.make()), false); assert.equal(f.requests.length, 1); assert.equal(f.resources.size, 0);
  }
});

test("aborted input never initiates an update", async () => {
  const f = fixture(); f.controller.abort();
  assert.equal(await f.run(f.make()), false); assert.equal(f.requests.length, 0);
});

test("catalogue title formatting is bounded, Unicode-safe and contains no controls or private fields", () => {
  const metadata = retailTrackMetadata({ id: "track-1", title: "Song\nName\u202e", artist: "Cafe\u0301", storageKey: "secret" });
  assert.equal(metadata.displayTitle, "Café — Song Name"); assert.equal(metadata.stationId, RETAIL_METADATA_STATION_ID);
  assert.deepEqual(Object.keys(metadata), ["stationId", "trackId", "displayTitle"]);
  assert.equal(retailTrackMetadata({ id: "bad/id", title: "Song" }), null);
  assert.equal(retailTrackMetadata({ id: "valid", title: "\u0000\u202e" }), null);
  const large = retailTrackMetadata({ id: "valid", title: "😀".repeat(1000), artist: "é".repeat(1000) });
  assert.ok(Buffer.byteLength(large.displayTitle) <= 512); assert.doesNotMatch(large.displayTitle, /[\p{Cc}\p{Cf}\p{Cs}]/u);
});

test("serialized latest-only title updates abort stale requests without overlapping or reporting late success", async () => {
  const stop = new AbortController(), requests = [], results = []; let release;
  const queue = createRetailMetadataQueue({ signal: stop.signal, onResult: value => results.push(value), update: async ({ metadata, signal }) => {
    requests.push({ metadata, signal });
    if (requests.length === 1) return await new Promise(resolve => { release = resolve; });
    return true;
  } });
  const title = n => retailTrackMetadata({ id: "same-track", title: `Song ${n}` });
  queue.push(title(1)); await flush();
  queue.push(title(2)); queue.push(title(3)); await flush();
  assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, true);
  release(true); await queue.flush();
  assert.deepEqual(requests.map(row => row.metadata.displayTitle), ["Song 1", "Song 3"]);
  assert.deepEqual(results, ["RETAIL_METADATA_VERIFIED"]);
  // A later repeat of the same recording is a real new transition.
  queue.push(title(3)); await queue.flush(); assert.equal(requests.length, 3);
  await queue.close(); assert.equal(queue.push(title(4)), false);
});

test("metadata timeout does not unlock a still-running request and never promotes stale success", async () => {
  const stop = new AbortController(), results = []; let release, calls = 0, currentSignal;
  const queue = createRetailMetadataQueue({ signal: stop.signal, timeoutMs: 10, onResult: value => results.push(value),
    update: async ({ signal }) => { calls++; currentSignal = signal; if (calls === 1) return await new Promise(resolve => { release = resolve; }); return false; } });
  queue.push(retailTrackMetadata({ id: "first", title: "First" })); await flush();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(currentSignal.aborted, true);
  queue.push(retailTrackMetadata({ id: "second", title: "Second" })); await flush(); assert.equal(calls, 1);
  release(true); await queue.flush(); assert.equal(calls, 2); assert.deepEqual(results, ["RETAIL_METADATA_UNVERIFIED"]);
  await queue.close(); assert.equal(stop.signal.aborted, false);
});

test("metadata failures remain contained, later titles recover, and each source has independent state", async () => {
  const stop = new AbortController(), results = [], calls = []; let first = true;
  const queue = createRetailMetadataQueue({ signal: stop.signal, onResult: value => results.push(value), update: async () => {
    calls.push("a"); if (first) { first = false; throw new Error("pass=do-not-log-this"); } return true;
  } });
  const another = createRetailMetadataQueue({ signal: stop.signal, update: async () => { calls.push("b"); return true; } });
  const value = retailTrackMetadata({ id: "song", title: "Song" });
  queue.push(value); await queue.flush(); another.push(value); await another.flush(); queue.push(value); await queue.flush();
  assert.deepEqual(calls, ["a", "b", "a"]); assert.deepEqual(results, ["RETAIL_METADATA_UNVERIFIED", "RETAIL_METADATA_VERIFIED"]);
  assert.doesNotMatch(JSON.stringify(results), /pass|do-not-log-this/); assert.equal(stop.signal.aborted, false);
  await queue.close(); await another.close();
});

test("shutdown cancels active and queued metadata, waits for raw cleanup, and cannot restart requests", async () => {
  const stop = new AbortController(), results = []; let calls = 0, activeSignal, release;
  const queue = createRetailMetadataQueue({ signal: stop.signal, onResult: value => results.push(value), update: async ({ signal }) => {
    calls++; activeSignal = signal; return await new Promise(resolve => { release = resolve; });
  } });
  const value = retailTrackMetadata({ id: "song", title: "Song" });
  queue.push(value); await flush(); queue.push(value); stop.abort();
  let stopped = false; const cleanup = queue.close().then(() => { stopped = true; });
  await flush(); assert.equal(activeSignal.aborted, true); assert.equal(stopped, false);
  release(true); await cleanup; assert.equal(stopped, true); assert.equal(calls, 1); assert.deepEqual(results, []);
  assert.equal(queue.push(value), false);
});
