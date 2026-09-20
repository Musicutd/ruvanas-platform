import assert from "node:assert/strict";
import test from "node:test";
import { validateStudioIsolatedTestTarget } from "../lib/studio-isolated-test-target.mjs";

const input = {
  acknowledgement: "ISOLATED_TEST_STREAM",
  testListenerUrl: "https://sandbox-radio.example.net/stream",
  testSourceHost: "sandbox-source.example.net", testSourcePort: 18493,
  productionListenerUrl: "https://plus-radio105network.radioca.st/stream",
  productionSourceHost: "pollux.shoutca.st", productionSourcePort: 8393
};

test("an explicitly separate public target is only configuration-checked, not audio-verified", () => {
  assert.deepEqual(validateStudioIsolatedTestTarget(input), {
    isolated: true, listener: "https://sandbox-radio.example.net/stream",
    source: "sandbox-source.example.net:18493", audioVerified: false
  });
});

test("the known live station and current production endpoints are rejected independently", () => {
  for (const change of [
    { testListenerUrl: input.productionListenerUrl },
    { testSourceHost: input.productionSourceHost, testSourcePort: input.productionSourcePort },
    { testListenerUrl: "https://plus-radio105network.radioca.st/stream", productionListenerUrl: "https://new-production.example.net/stream" },
    { testSourceHost: "pollux.shoutca.st", testSourcePort: 8393, productionSourceHost: "new-production.example.net", productionSourcePort: 9393 }
  ]) assert.throws(() => validateStudioIsolatedTestTarget({ ...input, ...change }), /matches a production/);
});

test("missing comparison, acknowledgement, private addresses and credential-bearing URLs fail closed", () => {
  for (const change of [
    { acknowledgement: undefined },
    { productionListenerUrl: undefined },
    { productionSourcePort: undefined },
    { testListenerUrl: "http://sandbox-radio.example.net/stream" },
    { testListenerUrl: "https://user:password@sandbox-radio.example.net/stream" },
    { testListenerUrl: "https://localhost/stream" },
    { testSourceHost: "127.0.0.1" },
    { testSourcePort: 0 }
  ]) assert.throws(() => validateStudioIsolatedTestTarget({ ...input, ...change }));
});
