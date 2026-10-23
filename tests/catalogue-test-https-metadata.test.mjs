import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createCatalogueTestHttpsMetadataUpdater, TEST_RADIO_METADATA_HOST, TEST_RADIO_METADATA_STREAM_URL } from "../lib/catalogue-test-https-metadata.mjs";

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
    enabled: true, stationId: "cmvcnbwi20008hr23sd76psi8",
    source: { providerKey: "CENTOVA_CAST", serverHost: "pollux.shoutca.st", sourcePort: 8282, bitrateKbps: 128,
      centovaUsername: "ruvanastestradio", sourceUsername: null, outboundAutoDjEnabled: false,
      sourcePasswordEncrypted: "synthetic-encrypted", streamUrl: TEST_RADIO_METADATA_STREAM_URL },
    password: "synthetic source &+=?!'() secret",
    connection: { authenticated: true, hasError: () => disconnected }, clock,
    registerResource(resource) { resources.add(resource); return () => resources.delete(resource); },
    lookupImpl: async () => [{ address: "203.0.113.25", family: 4 }],
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
  const metadata = { stationId: options.stationId, displayTitle: "Artist — Song" };
  return { options, requests, resources, controller, clock, metadata, make: () => createCatalogueTestHttpsMetadataUpdater(options),
    run: updater => updater({ metadata, signal: controller.signal }), disconnect: () => { disconnected = true; }, lookupCount: () => successfulLookups };
}

test("disabled adapter never uses a credential, creates a request or resolves DNS", async () => {
  const f = fixture(); f.options.enabled = false; f.options.password = null;
  assert.equal(await f.run(f.make()), false); assert.equal(f.requests.length, 0);
});

test("updater accepts only Test Radio's exact HTTPS origin and existing source identity", () => {
  for (const change of [{ stationId: "other" }, { password: "" }, { password: "secret\nheader" }, { password: "x".repeat(513) },
    { connection: { authenticated: false } }, { registerResource: null }, { timeoutMs: 2001 }, { lookupImpl: null }]) {
    const f = fixture(); Object.assign(f.options, change);
    assert.throws(() => f.make()); assert.equal(f.requests.length, 0);
  }
  for (const change of [{ sourcePort: 8393 }, { centovaUsername: "radio105" }, { outboundAutoDjEnabled: true },
    { streamUrl: "http://pollux.shoutca.st:8282/stream" }, { streamUrl: "https://other.radioca.st/stream" },
    { streamUrl: `${TEST_RADIO_METADATA_STREAM_URL}?next=other` }, { serverHost: "127.0.0.1" }]) {
    const f = fixture(); Object.assign(f.options.source, change);
    assert.throws(() => f.make()); assert.equal(f.requests.length, 0);
  }
});

test("existing source password is URL-encoded only on fixed HTTPS update; exact current-song readback confirms success", async () => {
  const f = fixture(), update = f.make();
  assert.equal(await f.run(update), true); assert.equal(f.requests.length, 2);
  const first = f.requests[0].options, second = f.requests[1].options;
  for (const options of [first, second]) {
    assert.equal(options.protocol, "https:"); assert.equal(options.hostname, TEST_RADIO_METADATA_HOST);
    assert.equal(options.servername, TEST_RADIO_METADATA_HOST); assert.equal(options.port, 443);
    assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false);
    assert.equal(options.method, "GET"); assert.equal(options.headers.Authorization, undefined);
  }
  const url = new URL(first.path, `https://${TEST_RADIO_METADATA_HOST}`);
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
    [{ address: "203.0.113.25", family: 4 }, { address: "192.168.1.1", family: 4 }], [{ address: "::1", family: 6 }]]) {
    const f = fixture(); f.options.lookupImpl = async () => addresses;
    assert.equal(await f.run(f.make()), false); assert.equal(f.lookupCount(), 0);
    assert.equal(f.requests.length, 1); assert.equal(f.resources.size, 0);
  }
});

test("wrong-station, control characters, oversized titles or disconnected audio never request metadata", async () => {
  for (const metadata of [{ stationId: "other", displayTitle: "Song" }, { stationId: "cmvcnbwi20008hr23sd76psi8", displayTitle: "A\nB" },
    { stationId: "cmvcnbwi20008hr23sd76psi8", displayTitle: "😀".repeat(129) }, { stationId: "cmvcnbwi20008hr23sd76psi8", displayTitle: " " }]) {
    const f = fixture(), update = f.make();
    assert.equal(await update({ metadata, signal: f.controller.signal }), false); assert.equal(f.requests.length, 0);
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
  assert.equal(await pending, false); finishDns([{ address: "203.0.113.25", family: 4 }]); await flush();
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
