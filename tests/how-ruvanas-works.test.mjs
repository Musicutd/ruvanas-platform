import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ruvanasProductGuides } from "../lib/how-ruvanas-works.mjs";
import { buildSubscriberNavigation } from "../lib/user-experience-navigation.mjs";

test("one How it works page is linked prominently from subscriber navigation", () => {
  const navigation = buildSubscriberNavigation({ entitlements: {}, firstStationId: null });
  const item = navigation.flatMap((section) => section.items).find((entry) => entry.id === "howItWorks");
  assert.equal(item.href, "/dashboard/how-it-works");
  assert.equal(item.label, "How it works");
  assert.equal(item.topLevel, true);
});

test("the How it works link is rendered without opening a menu section", async () => {
  const shell = await readFile(new URL("../app/dashboard/SubscriberPortalShell.js", import.meta.url), "utf8");
  assert.match(shell, /const topLevelItems =/);
  assert.match(shell, /topLevelItems\.map/);
  assert.match(shell, /section\.items\.filter\(\(item\) => !item\.topLevel\)/);
});

test("the public homepage links to a no-login How it works guide", async () => {
  const [home, publicPage, client] = await Promise.all([
    readFile(new URL("../app/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/how-it-works/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/how-it-works/HowItWorksClient.js", import.meta.url), "utf8")
  ]);
  assert.match(home, /href="\/how-it-works">How it works/);
  assert.match(home, /href="\/how-it-works">See how it works/);
  assert.match(publicPage, /<HowItWorksClient publicView \/>/);
  assert.doesNotMatch(publicPage, /getActiveOrganisationContext|redirect\(/);
  assert.match(client, /publicView \? "\/register" : product\.startHref/);
});

test("the guide separates all six products into dedicated tabs", () => {
  assert.deepEqual(ruvanasProductGuides.map((product) => product.tabLabel), ["Retail", "School", "Radio", "Health", "Faith", "Organisations"]);
  assert.deepEqual(ruvanasProductGuides.map((product) => product.id), ["retail", "school", "radio", "health", "faith", "organisations"]);
  for (const product of ruvanasProductGuides) {
    assert.ok(product.chapters.length >= 4);
    assert.match(product.startHref, /^\/dashboard\//);
  }
});

test("the guide uses accessible tabs and click-to-open information boxes", async () => {
  const source = await readFile(new URL("../app/dashboard/how-it-works/HowItWorksClient.js", import.meta.url), "utf8");
  assert.match(source, /<WorkspaceTabs/);
  assert.match(source, /defaultTab="retail"/);
  assert.match(source, /<details/);
  assert.match(source, /<summary>/);
  assert.match(source, /Open each box below/);
  assert.match(source, /id="main-content"/);
});

test("every product guide contains elaborated task guidance and safe internal links", () => {
  for (const product of ruvanasProductGuides) {
    for (const chapter of product.chapters) {
      assert.ok(chapter.title.length > 8);
      assert.ok(chapter.summary.length > 20);
      assert.ok(chapter.detail.length > 120);
      assert.ok(chapter.steps.length >= 3 && chapter.steps.length <= 5);
      assert.ok(chapter.links.length >= 1);
      for (const link of chapter.links) assert.match(link.href, /^\/dashboard\//);
    }
  }
  const fullText = JSON.stringify(ruvanasProductGuides);
  assert.match(fullText, /Programming & AutoDJ/);
  assert.match(fullText, /safeguarding/i);
  assert.match(fullText, /Public player/);
});

test("the guide is responsive and respects subscriber light and dark themes", async () => {
  const styles = await readFile(new URL("../app/dashboard/how-it-works/how-it-works.module.css", import.meta.url), "utf8");
  assert.match(styles, /var\(--rv-surface\)/);
  assert.match(styles, /var\(--rv-text\)/);
  assert.match(styles, /var\(--rv-text-muted\)/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 620px\)/);
});
