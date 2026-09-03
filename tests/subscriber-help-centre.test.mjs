import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  searchSubscriberHelp,
  subscriberHelpArticles,
  subscriberHelpHref,
  subscriberHelpOverview
} from "../lib/subscriber-help-centre.mjs";
import { buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";

test("subscriber help topics are unique, bounded and written as safe operating guidance", () => {
  assert.equal(subscriberHelpArticles.length, 10);
  assert.equal(new Set(subscriberHelpArticles.map((article) => article.id)).size, subscriberHelpArticles.length);
  for (const article of subscriberHelpArticles) {
    assert.match(article.id, /^[a-z0-9-]+$/);
    assert.ok(article.title.length <= 80);
    assert.ok(article.summary.length <= 180);
    assert.ok(article.steps.length >= 3 && article.steps.length <= 5);
    assert.doesNotMatch(`${article.title} ${article.summary}`, /stage\s+\d/i);
  }
});

test("help search normalises terms and requires every requested term", () => {
  const shopPlayerResults = searchSubscriberHelp("  SHOP   player  ").map((article) => article.id);
  assert.deepEqual(shopPlayerResults, searchSubscriberHelp("shop player").map((article) => article.id));
  assert.ok(shopPlayerResults.includes("shop-players"));
  assert.ok(searchSubscriberHelp("published schedule").some((article) => article.id === "managed-programme"));
  assert.deepEqual(searchSubscriberHelp("jingle quota"), []);
  assert.deepEqual(searchSubscriberHelp("not-a-real-topic"), []);
  assert.equal(searchSubscriberHelp("").length, subscriberHelpArticles.length);
});

test("owner and manager guidance remains distinct from view-only access", () => {
  for (const role of ["OWNER", "MANAGER"]) {
    const help = subscriberHelpOverview(role);
    assert.equal(help.canManage, true);
    assert.match(help.guidance, /setup actions/i);
  }

  const viewer = subscriberHelpOverview("VIEWER");
  assert.equal(viewer.canManage, false);
  assert.match(viewer.guidance, /view-only/i);
  assert.match(viewer.guidance, /owner or manager/i);
});

test("context help links can target only known internal articles", () => {
  assert.equal(subscriberHelpHref("shop-players"), "/dashboard/help#shop-players");
  assert.equal(subscriberHelpHref("unknown"), "/dashboard/help");
  for (const article of subscriberHelpArticles) {
    assert.equal(subscriberHelpHref(article.id), `/dashboard/help#${article.id}`);
  }
});

test("the help centre is available in subscriber task navigation", () => {
  const navigation = buildSubscriberNavigation({ entitlements: {}, firstStationId: null });
  const help = navigation.flatMap((section) => section.items).find((item) => item.id === "help");
  assert.equal(help.href, "/dashboard/help");
});

test("help and priority journeys expose native keyboard and skip-link semantics", async () => {
  const files = await Promise.all([
    readFile(new URL("../app/dashboard/help/HelpCentreClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/help/help-centre.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SkipLink.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ContextHelp.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/interface-patterns.module.css", import.meta.url), "utf8")
  ]);
  const [client, helpStyles, skipLink, contextHelp, sharedStyles] = files;
  assert.match(client, /type="search"/);
  assert.match(client, /aria-live="polite"/);
  assert.match(client, /<details/);
  assert.match(client, /<summary>/);
  assert.match(client, /id="main-content"/);
  assert.match(helpStyles, /@media \(max-width: 720px\)/);
  assert.match(helpStyles, /:focus-visible/);
  assert.match(skipLink, /Skip to main content/);
  assert.match(contextHelp, /articleHref/);
  assert.match(sharedStyles, /skipLink:focus/);
});

test("every guided subscriber route points to its relevant help topic and skip target", async () => {
  const routes = [
    ["../app/dashboard/page.js", "getting-started"],
    ["../app/dashboard/players/page.js", "shop-players"],
    ["../app/dashboard/media/page.js", "audio-uploads"],
    ["../app/stations/new/page.js", "station-setup"],
    ["../app/stations/[stationId]/setup/page.js", "station-setup"],
    ["../app/stations/[stationId]/page.js", "station-setup"]
  ];
  for (const [path, topic] of routes) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, new RegExp(`/dashboard/help#${topic}`));
    assert.match(source, /<SkipLink/);
    assert.match(source, /id="main-content"/);
  }
});
