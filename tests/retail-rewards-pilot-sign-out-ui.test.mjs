import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const file = "app/rewards/PilotSignOutButton.js";
const source = babel.transformSync(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
  filename: file, babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")]
}).code;
const module = { exports: {} };
const forbidden = () => { throw new Error("UNEXPECTED_TEST_SIDE_EFFECT"); };
vm.runInNewContext(source, {
  module, exports: module.exports, process: { env: { NODE_ENV: "test" } },
  fetch: forbidden, window: new Proxy({}, { get: forbidden }), console,
  require(name) {
    if (name === "react" || name === "react/jsx-runtime" || name === "react/jsx-dev-runtime") return require(name);
    if (name === "./pilot-business-shell.module.css") return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${name}`);
    throw new Error(`UNEXPECTED_UI_DEPENDENCY:${name}`);
  }
});
const { default: Button, requestPilotSignOut } = module.exports;

test("pilot sign-out is hydration-disabled and cannot submit a native form", () => {
  const html = renderToStaticMarkup(React.createElement(Button));
  assert.match(html, /<button type="button" disabled="">Sign out<\/button>/);
  assert.doesNotMatch(html, /<form|action=|href=|Signed out|role="alert"/);
});

test("pilot sign-out posts only to the existing same-origin endpoint without following redirects", async () => {
  const controller = new AbortController(); let requests = 0;
  await requestPilotSignOut(controller.signal, async (path, options) => {
    requests++;
    assert.equal(path, "/api/auth/logout");
    assert.equal(options.method, "POST"); assert.equal(options.mode, "same-origin");
    assert.equal(options.credentials, "same-origin"); assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "manual"); assert.equal(options.signal, controller.signal);
    assert.equal(options.body, "{}");
    assert.deepEqual(Object.entries(options.headers), [["Content-Type", "application/json"]]);
    // Browser-owned Origin and cookies must not be fabricated by the client.
    assert.equal(Object.hasOwn(options.headers, "Origin"), false);
    assert.equal(Object.hasOwn(options.headers, "Cookie"), false);
    return { type: "opaqueredirect", status: 0 };
  });
  assert.equal(requests, 1);
});

test("only an opaque manual redirect confirms the existing logout response", async () => {
  for (const response of [null, {}, { type: "basic", status: 200 }, { type: "basic", status: 303 },
    { type: "basic", status: 401 }, { type: "basic", status: 403 }, { type: "basic", status: 500 },
    { type: "opaque", status: 0 }, { type: "opaqueredirect", status: 303 }]) {
    await assert.rejects(requestPilotSignOut(new AbortController().signal, async () => response), /PILOT_SIGN_OUT_UNCONFIRMED/);
  }
});

test("logout does not read or follow a response body or destination", async () => {
  const response = { type: "opaqueredirect", status: 0,
    get url() { return forbidden(); }, get headers() { return forbidden(); }, json: forbidden, text: forbidden };
  await requestPilotSignOut(new AbortController().signal, async () => response);
});

test("already cancelled and late aborted responses cannot confirm sign-out", async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(requestPilotSignOut(before.signal, forbidden), /PILOT_SIGN_OUT_UNCONFIRMED/);
  const during = new AbortController();
  await assert.rejects(requestPilotSignOut(during.signal, async () => {
    during.abort(); return { type: "opaqueredirect", status: 0 };
  }), /PILOT_SIGN_OUT_UNCONFIRMED/);
});

test("network and timeout failures reject rather than confirming sign-out", async () => {
  for (const problem of [new Error("Synthetic network failure"), new DOMException("Synthetic timeout", "AbortError")]) {
    await assert.rejects(requestPilotSignOut(new AbortController().signal, async () => { throw problem; }), error => error === problem);
  }
});
