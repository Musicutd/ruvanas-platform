import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { "base-url": "http://127.0.0.1:8789/", output: path.join(repo, ".next", "shopper-savings-browser-check") };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, "");
  if (!["base-url", "playwright-module", "output"].includes(key) || !args[i + 1]) throw new Error("Use --base-url, --playwright-module or --output.");
  options[key] = args[++i];
}
const base = new URL(options["base-url"]);
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.protocol, "http:");
assert.equal(base.pathname, "/"); assert.equal(base.search + base.hash + base.username + base.password, "");
const req = createRequire(options["playwright-module"] ? path.resolve(options["playwright-module"]) : path.join(repo, "package.json"));
const { chromium } = req("playwright"), output = path.resolve(options.output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const tests = [], errors = [], outside = [], keyboard = [];
await context.route("**/*", async route => {
  if (new URL(route.request().url()).origin !== base.origin) { outside.push(route.request().url()); await route.abort(); }
  else await route.continue();
});
const page = await context.newPage(); page.setDefaultTimeout(10_000); page.on("pageerror", error => errors.push(error.message));
const bodyText = () => page.locator("main").innerText();
const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
const overflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
async function check(name, run) { await run(); tests.push(name); console.log(`PASS ${name}`); }
async function scenario(mode) {
  await page.evaluate(mode => window.shopperPreview.savingsScenario(mode), mode);
  await page.getByRole("heading", { name: "My savings", exact: true }).waitFor();
}
let failure;
try {
  await page.goto(base.href); await page.getByRole("heading", { name: "Where are you shopping?", exact: true }).waitFor();
  await check("Savings tab opens the local example through shopper navigation", async () => {
    await page.getByRole("button", { name: "My savings", exact: true }).click();
    await page.getByRole("heading", { name: "My savings", exact: true }).waitFor();
    const text = await bodyText(); assert.match(text, /€15\.00/); assert.match(text, /€25\.00/); assert.match(text, /extra €10\.00 in your pocket/);
    assert.match(text, /LOCAL PREVIEW/); assert.match(text, /No payments or live accounts/);
    assert.equal(await page.locator('[aria-current="page"]').innerText(), "My savings");
    await overflow(); await screenshot("01-savings-example-mobile");
  });
  for (const size of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await check(`Savings remains readable and keyboard controls visible at ${size.width}px`, async () => {
      await page.setViewportSize(size); await scenario("positive"); await overflow();
      await page.getByRole("button", { name: "Ruvanas Rewards home", exact: true }).focus();
      let reached = false;
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        const state = await page.evaluate(() => {
          const el = document.activeElement, r = el.getBoundingClientRect(), nav = document.querySelector('nav[aria-label="Shopper navigation"]'), inNav = nav.contains(el), nr = nav.getBoundingClientRect();
          return { name: el.getAttribute("aria-label") || el.textContent.trim().replace(/\s+/g, " "),
            visible: r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= (inNav ? innerHeight : nr.top) + 1 };
        });
        keyboard.push({ width: size.width, ...state }); assert.equal(state.visible, true, JSON.stringify(state));
        if (state.name === "Account") { reached = true; break; }
      }
      assert.equal(reached, true); await screenshot(`02-savings-${size.width}px`);
    });
  }
  await check("Unknown payment evidence shows actual savings without invented fees or net benefit", async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await scenario("unavailable");
    const text = await bodyText(); assert.match(text, /€25\.00/); assert.match(text, /Not available yet/);
    assert.doesNotMatch(text, /€15\.00|extra .*in your pocket/); await screenshot("03-payments-unavailable");
  });
  await check("Zero and negative results never claim extra money in the pocket", async () => {
    await scenario("negative"); let text = await bodyText(); assert.match(text, /€10\.00 away from covering/); assert.doesNotMatch(text, /extra .*in your pocket/);
    await scenario("zero"); text = await bodyText(); assert.match(text, /have covered your subscription/); assert.doesNotMatch(text, /extra .*in your pocket/);
  });
  await check("Unknown monetary discounts and separate currencies have clear presentation", async () => {
    await scenario("unknown"); let text = await bodyText(); assert.match(text, /1 redeemed offer has no recorded money value/); assert.doesNotMatch(text, /extra .*in your pocket/);
    await scenario("multiple"); await page.getByRole("region", { name: "EUR savings" }).waitFor(); await page.getByRole("region", { name: "USD savings" }).waitFor();
    await overflow(); await screenshot("04-separate-currencies");
    await scenario("empty"); text = await bodyText(); assert.match(text, /No coupon savings have been recorded/); assert.doesNotMatch(text, /€0|extra .*in your pocket/);
  });
  await check("Refresh failure clears old totals and a retry recovers using only in-memory reads", async () => {
    await scenario("positive"); await page.evaluate(() => window.shopperPreview.failSavingsRefresh());
    await page.getByRole("button", { name: "Refresh savings", exact: true }).click();
    await page.getByRole("alert").waitFor(); assert.doesNotMatch(await bodyText(), /€25\.00|€15\.00|extra .*in your pocket/);
    await page.getByRole("button", { name: "Refresh savings", exact: true }).click();
    await page.getByText(/extra €10\.00 in your pocket/).waitFor();
    assert.equal(await page.evaluate(() => window.shopperPreview.fixture.requests.every(row => row.method === "GET")), true);
  });
  await check("Savings, wallet, account and exploration navigation stay inside the local preview", async () => {
    await page.getByRole("button", { name: "My vouchers", exact: true }).click(); await page.getByRole("heading", { name: "My vouchers", exact: true }).waitFor();
    await page.getByRole("button", { name: "My savings", exact: true }).click(); await page.getByRole("heading", { name: "My savings", exact: true }).waitFor();
    await page.getByRole("button", { name: "Account", exact: true }).click(); await page.getByRole("heading", { name: "Your account", exact: true }).waitFor();
    await page.getByRole("button", { name: "My savings", exact: true }).click(); await page.getByRole("heading", { name: "My savings", exact: true }).waitFor();
    await page.getByRole("button", { name: "Explore", exact: true }).click(); await page.getByRole("heading", { name: "Where are you shopping?", exact: true }).waitFor();
    assert.equal(new URL(page.url()).origin, base.origin); assert.deepEqual(errors, []); assert.deepEqual(outside, []);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0); assert.equal((await context.cookies()).length, 0);
  });
} catch (error) { failure = error; await screenshot("failure").catch(() => {}); }
finally {
  await writeFile(path.join(output, "browser-results.json"), JSON.stringify({ passed: tests.length, tests, failure: failure ? String(failure.message) : null,
    browser: "isolated headless Chrome", base: base.href, keyboard, browserErrors: errors, externalRequestsBlocked: outside.length,
    syntheticSavingsOnly: true, realAccounts: false, realPayments: false, databaseAccess: false, flagsChanged: false, encodersTouched: false }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: tests.length, output }));
