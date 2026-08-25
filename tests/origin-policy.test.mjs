import assert from "node:assert/strict";
import test from "node:test";
import { publicRequestOrigin } from "../lib/origin-policy.mjs";

test("public request origin honours reverse-proxy host and protocol", () => {
  assert.equal(
    publicRequestOrigin({
      nextOrigin: "http://internal-render-host:10000",
      host: "internal-render-host:10000",
      forwardedHost: "ruvanas-platform-staging.onrender.com",
      forwardedProto: "https"
    }),
    "https://ruvanas-platform-staging.onrender.com"
  );
});

test("public request origin falls back to the direct request origin", () => {
  assert.equal(
    publicRequestOrigin({
      nextOrigin: "http://127.0.0.1:3100",
      host: "127.0.0.1:3100"
    }),
    "http://127.0.0.1:3100"
  );
});

