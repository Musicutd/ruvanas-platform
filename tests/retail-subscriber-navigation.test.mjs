import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";
import * as shortcuts from "../lib/retail-subscriber-navigation.mjs";
import * as pillars from "../lib/pillar-audio.mjs";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const retailNavigation = () => buildSubscriberNavigation({ entitlements: { serviceEnabled: true, retailRadioEnabled: true } });

test("daily Retail shortcuts require an explicitly resolved workspace and never widen filtered navigation", () => {
  const navigation = retailNavigation();
  const before = JSON.stringify(navigation);
  assert.equal(shortcuts.retailSubscriberShortcuts({ navigation }), null);
  assert.equal(shortcuts.retailSubscriberShortcuts({ navigation, enabled: false }), null);
  const result = shortcuts.retailSubscriberShortcuts({ navigation, enabled: true });
  assert.deepEqual(result.everyday.map(item => item.href), [
    "/dashboard/programming#workspace-autodj",
    "/dashboard/programming#workspace-planner",
    "/dashboard/programming#workspace-commercials"
  ]);
  assert.deepEqual(result.setup.map(item => item.href), ["/dashboard/locations", "/dashboard/players"]);
  assert.equal(result.home.href, "/dashboard/retail");
  assert.equal(JSON.stringify(navigation), before);

  const withoutProgrammingOrPlayers = navigation.map(section => ({ ...section, items: section.items.filter(item => !["programming", "players"].includes(item.id)) }));
  const limited = shortcuts.retailSubscriberShortcuts({ navigation: withoutProgrammingOrPlayers, enabled: true });
  assert.deepEqual(limited.everyday, []);
  assert.deepEqual(limited.setup.map(item => item.id), ["locations"]);
  const disabled = navigation.map(section => ({ ...section, items: section.items.map(item => ({ ...item, available: false })) }));
  assert.equal(shortcuts.retailSubscriberShortcuts({ navigation: disabled, enabled: true }), null);
});

test("Online Radio and other Retail accounts retain their existing navigation", () => {
  const online = buildSubscriberNavigation({ entitlements: { serviceEnabled: true, onlineRadioEnabled: true } });
  assert.equal(shortcuts.retailSubscriberShortcuts({ navigation: online, enabled: true }), null);
  assert.equal(shortcuts.retailSubscriberShortcuts({ navigation: retailNavigation(), enabled: false }), null);
});

const source = readFileSync(new URL("../app/dashboard/SubscriberPortalShell.js", import.meta.url), "utf8");
const compiled = babel.transformSync(source, { filename: "SubscriberPortalShell.js", babelrc: false, configFile: false, envName: "test", presets: [require.resolve("next/babel")] }).code;
function renderShell(retailWorkspace) {
  const module = { exports: {} };
  const mocked = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": { usePathname: () => "/dashboard/players" },
    "./SubscriberThemeContext": { SubscriberThemeContext: React.createContext("dark") },
    "@/lib/pillar-audio.mjs": pillars,
    "@/lib/retail-subscriber-navigation.mjs": shortcuts,
    "./subscriber-portal-shell.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: id => {
    if (Object.hasOwn(mocked, id)) return mocked[id];
    if (id.startsWith("@babel/runtime/")) return require(`next/dist/compiled/${id}`);
    throw new Error(`Unexpected import: ${id}`);
  } });
  return renderToStaticMarkup(React.createElement(module.exports.default, {
    navigation: retailNavigation(), organisationName: "Synthetic Retail", userName: "Synthetic owner", membershipRole: "OWNER",
    listenHrefs: { RETAIL: "/dashboard/listen/retail" }, retailWorkspace
  }, "Synthetic workspace"));
}

test("Retail sidebar leads to listening and daily tasks while shop setup stays collapsed", () => {
  const html = renderShell(true);
  assert.match(html, /href="\/dashboard\/listen\/retail"/);
  assert.match(html, /Music &amp; AutoDJ/);
  assert.match(html, /Weekly planner/);
  assert.match(html, /workspace-commercials/);
  assert.match(html, /<details class="shopSetup"><summary>Shop setup<\/summary>/);
  assert.match(html, /Shop devices/);
  assert.match(html, /id="subscriber-all-tools" hidden=""/);
  assert.match(html, /More tools &amp; account/);
  assert.doesNotMatch(html, /Digital Signage/);
  const generic = renderShell(false);
  assert.doesNotMatch(generic, /<details class="shopSetup"/);
  assert.doesNotMatch(generic, /workspace-commercials/);
  assert.match(generic, />All tools /);
});
