import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("subscriber overview gives Online Radio an immediate listening action and three daily tasks", async () => {
  const page = await readFile(new URL("../app/dashboard/page.js", import.meta.url), "utf8");
  assert.match(page, /onlineOnly && entitlements\.serviceEnabled \? firstListenableOnlineStation\(organisation\.stations\)/);
  assert.match(page, /href: onlineRadioListenHref\(listenStation\.id\)/);
  assert.match(page, /title: "Listen to your station"/);
  assert.match(page, /target=\{nextAction\.newTab \? "_blank" : undefined\}/);
  assert.match(page, /EVERYDAY ACTIONS/);
  assert.match(page, /Manage your station/);
  assert.match(page, /Choose music/);
  assert.match(page, /Open Studio/);
  assert.match(page, /products\.length === 1 \? products\[0\]\.label : "Your Ruvanas home"/);
  assert.match(page, /<details className=\{styles\.pulseDetails\}>/);
});

test("subscriber navigation exposes daily links while retaining every entitled tool", async () => {
  const [shell, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/SubscriberPortalShell.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/subscriber-portal-shell.module.css", import.meta.url), "utf8")
  ]);
  assert.match(shell, /const featuredItems = \[/);
  assert.match(shell, /item\.id === "simplePlaylists"/);
  assert.match(shell, /item\.id === "studio"/);
  assert.match(shell, /aria-label="Quick access"/);
  assert.match(shell, /aria-expanded=\{showAllTools\}/);
  assert.match(shell, /id="subscriber-all-tools" hidden=\{!showAllTools\}/);
  assert.match(shell, /navigation\.map\(\(section\) =>/);
  assert.match(styles, /\.featuredNav \{/);
  assert.match(styles, /\.allToolsButton:focus-visible/);
});
