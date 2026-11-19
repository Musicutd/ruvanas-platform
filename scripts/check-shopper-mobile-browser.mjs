import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { "base-url": "http://127.0.0.1:8789/", output: path.join(repo, ".next", "shopper-mobile-browser-check") };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, "");
  if (!["base-url", "playwright-module", "output"].includes(key) || !args[i + 1]) throw new Error("Use --base-url, --playwright-module or --output.");
  options[key] = args[++i];
}
const base = new URL(options["base-url"]);
assert.equal(base.hostname, "127.0.0.1", "Only the loopback sample preview may be tested.");
assert.equal(base.protocol, "http:"); assert.equal(base.pathname, "/"); assert.equal(base.search, ""); assert.equal(base.hash, "");
assert.equal(base.username, ""); assert.equal(base.password, "");
const req = createRequire(options["playwright-module"] ? path.resolve(options["playwright-module"]) : path.join(repo, "package.json"));
const { chromium } = req("playwright");
const output = path.resolve(options.output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const tests = [], errors = [], outside = [], keyboardFocus = [];
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base.origin) { outside.push(url.origin); await route.abort(); }
  else await route.continue();
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message.replace(/[a-f0-9]{64}/g, "[demo-code]")));
const countClaims = () => page.evaluate(() => window.shopperPreview.fixture.requests.filter(row => row.method === "POST" && row.path === "/api/rewards/claims").length);
const remaining = () => page.evaluate(() => 10 - window.shopperPreview.fixture.snapshot().uses["urban-edit-ten"]);
const code = () => page.getByLabel("Checkout code", { exact: true });
const qr = () => page.getByRole("img", { name: "Private checkout QR code", exact: true });
const overflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Horizontal mobile overflow");
const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, mask: [code(), qr()] });
async function check(name, run) { await run(); tests.push(name); console.log(`PASS ${name}`); }
async function fresh() { await page.goto(base.href); await page.getByRole("heading", { name: "Where are you shopping?", exact: true }).waitFor(); }
async function chooseSliema() {
  await page.getByRole("radio", { name: /Sliema/ }).check();
  await page.getByRole("button", { name: "Find shops", exact: true }).click();
  await page.getByRole("heading", { name: "Choose a shop", exact: true }).waitFor();
  await page.getByRole("button", { name: "View vouchers from Urban Edit", exact: true }).waitFor();
}
async function chooseUrban() {
  await page.getByRole("button", { name: "View vouchers from Urban Edit", exact: true }).click();
  await page.getByRole("heading", { name: "Urban Edit", exact: true }).waitFor();
  await page.getByText("7 of 10 uses left", { exact: true }).waitFor();
}
async function headingHasFocus(name) {
  await page.waitForFunction(expected => document.activeElement?.tagName === "H1" &&
    document.activeElement.textContent.replace(/\s+/g, " ").trim() === expected, name);
}
async function keyboardControlsVisible(screen, width) {
  await page.getByRole("button", { name: "Ruvanas Rewards home", exact: true }).focus();
  for (let index = 0; index < 45; index++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body) return { end: true };
      if (focused.closest('[aria-label="Local preview controls"]')) return { end: true };
      const target = focused.matches('input[type="radio"]') ? focused.closest("label") : focused;
      const rect = target.getBoundingClientRect(), nav = document.querySelector('nav[aria-label="Shopper navigation"]');
      const navRect = nav.getBoundingClientRect(), inNav = nav.contains(focused);
      return { name: focused.getAttribute("aria-label") || target.textContent.trim().replace(/\s+/g, " ").slice(0, 100) || focused.id,
        tag: focused.tagName, inNav, top: Math.round(rect.top), bottom: Math.round(rect.bottom),
        navTop: Math.round(navRect.top), viewportHeight: innerHeight,
        visible: rect.width > 0 && rect.height > 0 && rect.top >= -1 && rect.bottom <= (inNav ? innerHeight : navRect.top) + 1 };
    });
    if (state.end) return;
    keyboardFocus.push({ screen, width, ...state });
    assert.equal(state.visible, true, `Keyboard focus obscured at ${width}px on ${screen}: ${JSON.stringify(state)}`);
    if (state.inNav && state.name === "Account") return;
  }
  assert.fail(`Keyboard traversal did not reach the shopper navigation on ${screen}.`);
}
let failure;
try {
  await check("Location selection renders at 390px with a persistent local-preview label", async () => {
    await fresh(); await overflow();
    assert.equal(await page.getByText("LOCAL PREVIEW", { exact: true }).isVisible(), true);
    await page.getByRole("radio", { name: /Sliema/ }).check();
    assert.equal(await page.getByRole("button", { name: "Find shops", exact: true }).evaluate(node => {
      const button = node.getBoundingClientRect(), nav = document.querySelector('nav[aria-label="Shopper navigation"]').getBoundingClientRect();
      return button.top >= 0 && button.bottom <= nav.top;
    }), true, "Find shops must be visible above the bottom navigation without scrolling");
    await screenshot("01-location-mobile");
    assert.equal(await countClaims(), 0);
    await chooseSliema();
    assert.equal(await page.getByRole("button", { name: "View vouchers from Urban Edit", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: /City Style/ }).count(), 0);
    await overflow(); await screenshot("02-shops-mobile");
  });
  await check("Credit-card vouchers show personal uses and do not issue claims on browse", async () => {
    await chooseUrban(); await overflow();
    assert.equal(await page.getByText("Reusable", { exact: true }).count() >= 1, true);
    assert.equal(await page.getByText("Single use", { exact: true }).count() >= 1, true);
    assert.equal(await countClaims(), 0); assert.equal(await remaining(), 7);
    await screenshot("03-vouchers-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 }); await overflow(); await screenshot("04-vouchers-desktop");
    await page.setViewportSize({ width: 320, height: 740 }); await overflow(); await screenshot("05-vouchers-small-mobile");
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check("Terms, explicit demo claim and checkout code preserve the count until cashier confirmation", async () => {
    await page.getByRole("button", { name: /^Use voucher/ }).first().click();
    await page.getByRole("button", { name: "Get coupon", exact: true }).waitFor();
    assert.equal(await countClaims(), 0); assert.equal(await remaining(), 7);
    await page.getByRole("button", { name: "Get coupon", exact: true }).click();
    await page.getByRole("region", { name: "Your issued coupon", exact: true }).waitFor();
    assert.equal(await countClaims(), 1); assert.equal(await remaining(), 7);
    assert.equal(await code().count(), 0);
    await page.getByRole("button", { name: "Show checkout code", exact: true }).click();
    await qr().waitFor({ state: "visible" });
    assert.equal(await code().evaluate(node => /^[a-f0-9]{64}$/.test(node.textContent)), true);
    assert.equal(await remaining(), 7); await overflow(); await screenshot("06-demo-checkout-masked");
    await page.getByRole("button", { name: "Hide code", exact: true }).click();
    assert.equal(await code().count(), 0);
    assert.equal(await page.evaluate(() => window.shopperPreview.redeemLatest()), true);
    assert.equal(await remaining(), 6);
    await page.getByRole("button", { name: "Vouchers", exact: true }).click();
    await page.getByText("6 of 10 uses left", { exact: true }).waitFor();
    await screenshot("08-vouchers-after-demo-redemption");
  });
  await check("My vouchers shows the confirmed demo receipt and navigation clears checkout codes", async () => {
    await page.getByRole("button", { name: "My vouchers", exact: true }).click();
    await page.getByRole("button", { name: /^View receipt for / }).first().waitFor();
    assert.equal(await code().count(), 0);
    await page.getByRole("button", { name: /^View receipt for / }).first().click();
    await page.getByRole("region", { name: "Coupon receipt", exact: true }).waitFor();
    assert.equal(await code().count(), 0); await overflow(); await screenshot("07-demo-wallet-receipt");
    await page.evaluate(() => window.shopperPreview.reset());
    await page.getByRole("heading", { name: "Where are you shopping?", exact: true }).waitFor();
  });
  await check("Location search, empty results and request failures offer recovery", async () => {
    const search = page.getByRole("searchbox", { name: /Search location/i });
    await search.fill("No such town"); await search.press("Enter");
    await page.getByText(/No locations|No towns|No matching locations/i).first().waitFor();
    await search.fill("Mosta"); await search.press("Enter");
    await page.getByRole("radio", { name: /Mosta/ }).waitFor();
    assert.equal(await page.getByRole("radio", { name: /^Sliema/ }).count(), 0);
    await page.evaluate(() => { window.shopperPreview.fixture.state.failNext = true; });
    await search.fill("Sliema"); await search.press("Enter");
    await page.getByRole("alert").first().waitFor();
    await page.evaluate(() => window.shopperPreview.reset());
    await chooseSliema();
    const shops = page.getByRole("searchbox", { name: "Search shops", exact: true });
    await shops.fill("Home"); await shops.press("Enter");
    await page.getByRole("button", { name: "View vouchers from Home Corner", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "View vouchers from Urban Edit", exact: true }).count(), 0);
  });
  await check("Location pages deduplicate towns and missing usage never invents a remaining count", async () => {
    await fresh();
    await page.getByRole("button", { name: "More locations", exact: true }).click();
    await page.getByRole("radio", { name: /Mosta/ }).waitFor();
    assert.equal(await page.getByRole("radio", { name: /Sliema/ }).count(), 1);
    await chooseSliema(); await chooseUrban();
    await page.evaluate(() => { window.shopperPreview.fixture.state.missingUsage = true; });
    await page.getByRole("button", { name: "Refresh uses", exact: true }).click();
    await page.getByText("Up to 10 uses per shopper", { exact: true }).waitFor();
    assert.equal(await page.getByText("7 of 10 uses left", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("heading", { name: "Your account", exact: true }).waitFor();
    await page.getByRole("button", { name: "My vouchers", exact: true }).first().click();
    await page.getByRole("heading", { name: "My vouchers", exact: true }).waitFor();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("heading", { name: "Your account", exact: true }).waitFor();
  });
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }]) {
    await check(`Keyboard focus remains visible and navigation focuses headings at ${viewport.width}px`, async () => {
      await page.setViewportSize(viewport); await fresh();
      await page.getByRole("radio", { name: /Sliema/ }).check();
      await keyboardControlsVisible("locations", viewport.width);
      await chooseSliema(); await headingHasFocus("Choose a shop");
      await keyboardControlsVisible("shops", viewport.width);
      await chooseUrban(); await headingHasFocus("Urban Edit");
      await keyboardControlsVisible("vouchers", viewport.width);
      await page.getByRole("button", { name: /^Use voucher/ }).first().click();
      await page.getByRole("button", { name: "Get coupon", exact: true }).waitFor();
      await headingHasFocus("Urban Edit");
      await keyboardControlsVisible("voucher terms", viewport.width);
      await page.getByRole("button", { name: "Get coupon", exact: true }).click();
      await page.getByRole("button", { name: "Show checkout code", exact: true }).waitFor();
      await keyboardControlsVisible("issued voucher", viewport.width);
      await page.getByRole("button", { name: "Show checkout code", exact: true }).click();
      await qr().waitFor({ state: "visible" });
      await keyboardControlsVisible("checkout code", viewport.width);
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await headingHasFocus("Your account");
      await keyboardControlsVisible("account", viewport.width);
      await page.getByRole("button", { name: "My vouchers", exact: true }).first().click();
      await page.getByRole("heading", { name: "My vouchers", exact: true }).waitFor();
      await keyboardControlsVisible("wallet", viewport.width);
      await page.getByRole("button", { name: /^Open coupon / }).first().click();
      await page.getByRole("button", { name: "Show checkout code", exact: true }).waitFor();
      await keyboardControlsVisible("wallet issued voucher", viewport.width);
      await page.getByRole("button", { name: "Show checkout code", exact: true }).click();
      await qr().waitFor({ state: "visible" });
      await keyboardControlsVisible("wallet checkout code", viewport.width);
    });
  }
  await check("No real network, accounts, storage, cookies or browser errors are used", async () => {
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal((await context.cookies()).length, 0);
    assert.equal(await page.evaluate(() => window.shopperPreview.fixture.requests.every(row => Object.keys(row).sort().join() === "method,path")), true);
  });
} catch (error) {
  failure = error;
  await screenshot("failure-masked").catch(() => {});
} finally {
  await writeFile(path.join(output, "browser-results.json"), JSON.stringify({ passed: tests.length, tests,
    failure: failure ? String(failure.message).replace(/[a-f0-9]{64}/g, "[demo-code]") : null,
    browser: "isolated headless Chrome", base: base.href, mobileViewport: "390x844 and 320x740", desktopViewport: "1440x1000",
    browserErrors: errors, externalRequestsBlocked: outside.length, realAccounts: false, realRedemptions: false,
    databaseAccess: false, productionFlagsChanged: false, encodersTouched: false, keyboardFocus }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
await unlink(path.join(output, "failure-masked.png")).catch(error => { if (error.code !== "ENOENT") throw error; });
console.log(JSON.stringify({ passed: tests.length, output }));
