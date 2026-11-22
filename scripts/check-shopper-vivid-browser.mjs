import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Owned loopback preview only. No connected sessions or real accounts.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { "base-url": "http://127.0.0.1:8789/", output: path.join(repo, ".next", "shopper-vivid-browser-check") };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, "");
  if (!["base-url", "playwright-module", "output"].includes(key) || !args[i + 1]) throw new Error("Use --base-url, --playwright-module or --output.");
  options[key] = args[++i];
}
const base = new URL(options["base-url"]);
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.protocol, "http:");
assert.equal(base.pathname, "/"); assert.equal(base.search + base.hash + base.username + base.password, "");
const require = createRequire(options["playwright-module"] ? path.resolve(options["playwright-module"]) : path.join(repo, "package.json"));
const { chromium } = require("playwright"), output = path.resolve(options.output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
const passed = [], errors = [], outside = [], ratios = [], keyboard = [];
await context.route("**/*", async route => {
  if (new URL(route.request().url()).origin !== base.origin) { outside.push(route.request().url()); await route.abort(); }
  else await route.continue();
});
await context.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
  value: { writeText: async text => { window.__vividTestCopied = text; } } }));
const page = await context.newPage(); page.setDefaultTimeout(10_000);
page.on("pageerror", error => errors.push(error.message));
const button = name => page.getByRole("button", { name: name === "All categories" ? /^All categories/ : name, exact: true });
const heading = name => page.getByRole("heading", { name, exact: typeof name === "string" });
const cards = () => page.locator("article[data-voucher-id]");
const card = id => page.locator(`article[data-voucher-id=${JSON.stringify(id)}]`);
const shopButtons = () => page.getByRole("button", { name: /^Open (?!selected card)/ });
const screenshot = async name => { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false }); };
const totalSaved = () => page.getByTestId("total-saved").innerText();
const explore = () => button("Explore").click();
const wallet = () => page.getByRole("button", { name: /^My Wallet/ }).click();
const overflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No page overflow");
const nameOf = async target => (await target.locator('button[aria-label^="Flip "]').getAttribute("aria-label")).replace(/^Flip /, "").replace(/ voucher$/, "");
async function reset() { await page.evaluate(() => window.vividPreview.reset()); await heading("Where are you shopping?").waitFor(); }
async function choose(location = "Sliema", category = "Dining") {
  await button(`Choose ${location}`).click(); await heading("What are you looking for?").waitFor();
  await button(category === "All" ? "All categories" : `Choose ${category}`).click();
  await heading(new RegExp(`^Shops in ${location}`)).waitFor();
}
async function openFuego() { await button("Open Fuego Kitchen").click(); await heading("Fuego Kitchen").waitFor(); }
async function flip(target) {
  const front = target.getByRole("button", { name: /^Flip .+ voucher$/ });
  if (await front.count()) await front.click();
  await target.getByRole("button", { name: /^Back to .+ voucher$/ }).waitFor();
}
async function check(name, run) { await run(); passed.push(name); console.log(`PASS ${name}`); }
let failure;
try {
  await page.goto(base.href); await heading("Where are you shopping?").waitFor();
  await check("Explore starts with locations, without exposing voucher cards or shops", async () => {
    assert.equal(await cards().count(), 0); assert.equal(await shopButtons().count(), 0);
    for (const name of ["Sliema", "Valletta", "St Julian’s"]) await button(`Choose ${name}`).waitFor();
    assert.match(await page.locator("body").innerText(), /LOCAL PREVIEW/); assert.match(await totalSaved(), /€0\.00/);
    await screenshot("01-locations-dark-desktop");
  });
  await check("A location leads to categories before any shops or vouchers", async () => {
    await button("Choose Sliema").click(); await heading("What are you looking for?").waitFor();
    assert.equal(await cards().count(), 0); assert.equal(await shopButtons().count(), 0);
    for (const name of ["Dining", "Tech", "Fashion"]) await button(`Choose ${name}`).waitFor();
    await screenshot("02-categories-dark-desktop");
  });
  await check("Category results show matching shops with logos, not coupon cards", async () => {
    await button("Choose Dining").click(); await heading(/^Shops in Sliema/).waitFor();
    assert.equal(await cards().count(), 0); assert.equal(await shopButtons().count(), 1);
    await page.getByRole("img", { name: "Fuego Kitchen logo", exact: true }).waitFor();
    await button("Open Fuego Kitchen").waitFor(); assert.equal(await button("Open Volt Store").count(), 0);
    await screenshot("03-dining-shops-desktop");
  });
  await check("Opening one shop shows only its vouchers and keeps the selected journey", async () => {
    await openFuego(); assert.equal(await cards().count(), 1); assert.equal(await nameOf(cards().first()), "Fuego Kitchen");
    await page.getByRole("img", { name: "Fuego Kitchen logo", exact: true }).waitFor();
    assert.match(await cards().first().innerText(), /10 uses left/i);
    await button("Shops").click(); await heading(/^Shops in Sliema/).waitFor();
    assert.equal(await cards().count(), 0); assert.equal(await shopButtons().count(), 1);
    await button("Categories").click(); await heading("What are you looking for?").waitFor();
    assert.equal(await cards().count(), 0); await button("All categories").click();
  });
  await check("Shop search and logos cover all shops in the chosen location", async () => {
    await heading(/^Shops in Sliema/).waitFor(); assert.equal(await shopButtons().count(), 3);
    for (const name of ["Fuego Kitchen", "Volt Store", "Kova Apparel"]) await page.getByRole("img", { name: `${name} logo`, exact: true }).waitFor();
    assert.equal(await cards().count(), 0); await screenshot("04-shops-dark-desktop");
    const search = page.getByLabel("Search shops", { exact: true });
    await search.fill("Volt"); assert.equal(await shopButtons().count(), 1); await button("Open Volt Store").waitFor();
    await search.fill("no-such-shop"); assert.equal(await shopButtons().count(), 0); assert.equal(await cards().count(), 0);
    await search.fill(""); assert.equal(await shopButtons().count(), 3);
  });
  await check("Changing location clears the old category and shop without mixing results", async () => {
    await button("Locations").click(); await heading("Where are you shopping?").waitFor();
    await choose("Valletta", "All"); assert.equal(await cards().count(), 0); assert.equal(await shopButtons().count(), 2);
    await button("Open Roast & Co.").waitFor(); await button("Open Nova Cinema").waitFor();
    assert.equal(await button("Open Fuego Kitchen").count(), 0);
    await button("Open Roast & Co.").click(); await heading("Roast & Co.").waitFor();
    assert.equal(await cards().count(), 1); assert.equal(await nameOf(cards().first()), "Roast & Co.");
    await reset(); await choose("Sliema", "All");
  });
  for (const size of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 900, height: 1100 }, { width: 1440, height: 1100 }]) {
    await check(`Shop-first layout and unchanged credit-card proportion at ${size.width}px`, async () => {
      await page.setViewportSize(size); await overflow();
      assert.equal(await cards().count(), 0); assert.equal(await shopButtons().count(), 3);
      await screenshot(`05-shops-dark-${size.width}px`); await openFuego(); await overflow();
      const values = await page.getByTestId("voucher-ratio").evaluateAll(elements => elements.map(el => {
        const box = el.getBoundingClientRect(); return { width: box.width, height: box.height, ratio: box.width / box.height };
      }));
      assert.equal(values.length, 1);
      for (const value of values) { assert.ok(value.width > 100); assert.ok(Math.abs(value.ratio - 1.586) < 0.01, JSON.stringify(value)); }
      ratios.push({ viewport: size.width, values }); await screenshot(`06-shop-vouchers-${size.width}px`);
      await button("Shops").click(); await heading(/^Shops in Sliema/).waitFor();
    });
  }
  await check("Both themes retain logo shop results, selection and savings", async () => {
    const before = await totalSaved(); await button("Switch to light mode").click(); await button("Switch to dark mode").waitFor();
    assert.equal(await shopButtons().count(), 3); assert.equal(await totalSaved(), before);
    await screenshot("07-shops-light-desktop"); await openFuego(); await screenshot("08-shop-vouchers-light-desktop");
    await button("Switch to dark mode").click();
  });
  await check("Existing card flip, deterministic SVG and demo-only clipboard remain intact", async () => {
    const target = cards().first(), name = await nameOf(target), before = await totalSaved(); await flip(target);
    const svg = target.locator('svg[aria-label*="QR"]'); await svg.waitFor(); const first = await svg.evaluate(el => el.outerHTML);
    await target.getByRole("button", { name: `Copy ${name} code`, exact: true }).click(); await page.getByText(/Code copied/).first().waitFor();
    const copied = await page.evaluate(() => window.__vividTestCopied); assert.equal(typeof copied, "string"); assert.ok(copied.startsWith("DEMO-"));
    await target.getByRole("button", { name: `Back to ${name} voucher`, exact: true }).click(); await flip(target);
    assert.equal(await svg.evaluate(el => el.outerHTML), first); assert.equal(await totalSaved(), before); await screenshot("09-shop-card-back-desktop");
  });
  await check("Wallet save toggles preserve shop selection and never redeem", async () => {
    await wallet(); assert.equal(await cards().count(), 3);
    const activeNav = page.locator('nav[aria-label="Voucher navigation"] button[aria-current="page"]');
    await activeNav.hover();
    const contrast = await activeNav.evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = css => { const rgb = css.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; };
      const text = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
    });
    assert.ok(contrast >= 4.5, "Selected wallet navigation stays legible on hover");
    const target = card("demo-dining"), before = await totalSaved(); await flip(target);
    await target.getByRole("button", { name: "Remove Fuego Kitchen from wallet", exact: true }).click();
    assert.equal(await cards().count(), 2); await explore(); await heading("Fuego Kitchen").waitFor();
    assert.equal(await cards().count(), 1); await flip(card("demo-dining"));
    await button("Save Fuego Kitchen to wallet").click(); await wallet(); assert.equal(await cards().count(), 3);
    assert.equal(await totalSaved(), before); await screenshot("10-wallet-desktop");
  });
  await check("Stack selection and return to the chosen shop remain intact", async () => {
    await button("Stack").click(); const selection = page.getByTestId("stack-selection"), first = await selection.innerText();
    await button("Next card").click(); assert.notEqual(await selection.innerText(), first);
    await button("Previous card").click(); assert.equal(await selection.innerText(), first);
    await screenshot("11-stack-desktop"); await button("Open selected card").click();
    await page.getByRole("button", { name: /^Back to .+ voucher$/ }).first().waitFor();
    await explore(); await heading("Fuego Kitchen").waitFor(); assert.equal(await cards().count(), 1);
  });
  await check("Preparing and cancelling a shop checkout leave totals and uses unchanged", async () => {
    const target = cards().first(), before = await totalSaved(); await flip(target);
    await button("Redeem Fuego Kitchen voucher").click(); await heading("Redeem at Fuego Kitchen").waitFor();
    assert.equal(await totalSaved(), before); await button("Close checkout").click(); assert.equal(await totalSaved(), before);
  });
  await check("Confirmed demo shop redemption updates saved total and uses once", async () => {
    await button("Redeem Fuego Kitchen voucher").click(); await page.getByLabel("Qualifying purchase (€)", { exact: true }).fill("100.00");
    await button("Confirm demo redemption").click(); await heading("Demo redemption confirmed").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "checkout-title"); assert.match(await totalSaved(), /€30\.00/);
    assert.equal(await button("Confirm demo redemption").count(), 0); await screenshot("12-demo-receipt");
    await button("Close checkout").click(); await button("Back to Fuego Kitchen voucher").click(); assert.match(await cards().first().innerText(), /9 uses left/i);
  });
  await check("Mobile keyboard navigation never enters a hidden card face", async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await reset(); await choose(); await openFuego(); await overflow();
    await button("Switch to light mode").focus(); let seenNav = false;
    for (let count = 0; count < 45; count++) {
      await page.keyboard.press("Tab");
      const state = await page.evaluate(() => {
        const el = document.activeElement, box = el.getBoundingClientRect();
        return { label: el.getAttribute("aria-label") || el.textContent.trim().replace(/\s+/g, " "),
          hiddenFace: Boolean(el.closest('[aria-hidden="true"], [inert]')), width: box.width, height: box.height,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
      });
      keyboard.push(state); assert.equal(state.hiddenFace, false); assert.ok(state.width > 0 && state.height > 0); assert.equal(state.reducedMotion, true);
      if (state.label === "Stack") { seenNav = true; break; }
    }
    assert.equal(seenNav, true);
  });
  await check("Mobile rear controls and shop logos stay inside their panels", async () => {
    await page.setViewportSize({ width: 320, height: 740 }); const target = cards().first(); await flip(target); await target.scrollIntoViewIfNeeded(); await overflow();
    const bounds = await target.evaluate(el => {
      const frame = el.getBoundingClientRect();
      return [...el.querySelectorAll('[data-voucher-face="back"] button')].map(control => {
        const box = control.getBoundingClientRect(); return { name: control.getAttribute("aria-label"),
          inside: box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1 };
      });
    });
    assert.ok(bounds.length >= 4); for (const state of bounds) assert.equal(state.inside, true, state.name);
    await page.screenshot({ path: path.join(output, "13-card-back-320px.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 }); await button("Shops").click(); await button("Categories").click(); await button("All categories").click();
    await button("Switch to light mode").click(); await screenshot("14-shops-light-mobile"); await button("Switch to dark mode").click(); await screenshot("15-shops-dark-mobile");
    await button("Categories").click(); await screenshot("16-categories-mobile"); await button("Locations").click(); await screenshot("17-locations-mobile");
  });
  await check("Preview uses no external requests, persistent storage, cookies or real accounts", async () => {
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0); assert.equal((await context.cookies()).length, 0);
  });
} catch (error) { failure = error; await screenshot("failure").catch(() => {}); }
finally {
  const cardSourceHashes = {};
  for (const name of ["app/rewards/VividVoucherCard.js", "app/rewards/vivid-voucher-card.module.css"]) cardSourceHashes[name] = createHash("sha256").update(await readFile(path.join(repo, name))).digest("hex");
  await writeFile(path.join(output, "browser-results.json"), JSON.stringify({ passed: passed.length, tests: passed,
    failure: failure ? String(failure.message) : null, browser: "isolated headless Chrome", base: base.href,
    ratios, keyboard, cardSourceHashes, browserErrors: errors, externalRequestsBlocked: outside.length,
    syntheticDataOnly: true, clipboardStubbed: true, realAccounts: false, realPayments: false,
    hostedDatabaseAccess: false, productionFlagsChanged: false, encodersTouched: false }, null, 2) + "\n");
  await browser.close();
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: passed.length, output }));
