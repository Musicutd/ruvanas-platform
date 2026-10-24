import test from "node:test";
import assert from "node:assert/strict";
import { inspectRetailSource, retailPublicAddress } from "../lib/retail-stream-connection-check.mjs";

const source = { providerKey: "CENTOVA_CAST", outputCodec: "MP3", sourcePort: 8330,
  serverHost: "source.example.org", streamUrl: "https://listener.example.org/stream", centovaUsername: "retailfixture" };
const lookupImpl = async () => [{ address: "88.198.70.25", family: 4 }];

test("DNS preflight makes no claim of authenticated source or working audio", async () => {
  const report = await inspectRetailSource(source, { lookupImpl });
  assert.equal(report.ready, true);
  assert.equal(report.sourceCredential, "NOT_TESTED"); assert.equal(report.audioTested, false);
  assert.deepEqual(report.blockers, []);
});
test("unavailable saved source is actionable independently of listener DNS", async () => {
  const report = await inspectRetailSource(source, { lookupImpl: async host => {
    if (host.startsWith("source.")) throw new Error("private failure detail"); return lookupImpl();
  } });
  assert.equal(report.sourceDns, "UNAVAILABLE"); assert.equal(report.listenerDns, "PUBLIC");
  assert.deepEqual(report.blockers, ["RETAIL_SOURCE_DNS_UNAVAILABLE"]);
  assert.equal(JSON.stringify(report).includes("private failure detail"), false);
});
test("mixed public/private DNS and mapped addresses are rejected", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fc00::1", "2001:db8::1", "2002:7f00:1::1"]) {
    assert.equal(retailPublicAddress(address), false, address);
    assert.equal((await inspectRetailSource(source, { lookupImpl: async () => [...await lookupImpl(), { address }] })).ready, false, address);
  }
});
test("reserved Test Radio and malformed endpoints are never resolved", async () => {
  let calls = 0;
  for (const values of [{ sourcePort: 8282 }, { centovaUsername: "ruvanastestradio" }, { sourcePort: 0 }]) {
    const report = await inspectRetailSource({ ...source, ...values }, { lookupImpl: async () => { calls++; return lookupImpl(); } });
    assert.equal(report.ready, false);
  }
  assert.equal(calls, 0);
  for (const streamUrl of ["http://listener.example.org/stream", "https://name:secret@listener.example.org/stream", "https://listener.example.org/stream?secret=value", "https://ruvanastestradio-radio105network.radioca.st/stream"]) {
    const report = await inspectRetailSource({ ...source, streamUrl }, { lookupImpl });
    assert.equal(report.listenerDns, "REJECTED");
  }
});
test("DNS failure cannot hold a setup request indefinitely", async () => {
  const report = await inspectRetailSource(source, { lookupImpl: () => new Promise(() => {}), timeoutMs: 10 });
  assert.equal(report.sourceDns, "UNAVAILABLE"); assert.equal(report.listenerDns, "UNAVAILABLE");
});
