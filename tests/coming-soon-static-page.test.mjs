import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { registrationProducts } from "../lib/registration-experience.mjs";

const home = await readFile(new URL("../coming-soon/index.html", import.meta.url), "utf8");
const guide = await readFile(new URL("../coming-soon/how-it-works/index.html", import.meta.url), "utf8");
const login = "https://ruvanas-private-preview-20261011.onrender.com/login";
const guideUrl = "/how-it-works/";
const homeUrl = "/";
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

test("public home retains seven families and every one of the 35 tier cards", () => {
  const products = registrationProducts();
  assert.equal(products.length, 7);
  assert.equal(products.flatMap((product) => product.plans).length, 35);
  assert.equal((home.match(/<article class="priceCard\b/g) || []).length, 35);
  assert.equal((home.match(/<section class="pricingFamily"/g) || []).length, 7);
  for (const tier of products.flatMap((product) => product.plans)) {
    assert.ok(home.includes(`<h4>${escapeHtml(tier.name)}</h4>`), `Missing tier ${tier.name}`);
  }
  for (const name of ["In-house &amp; Retail Radio", "School Radio", "Complete Online Radio", "Ruvanas Health", "Ruvanas Faith", "Ruvanas Organisations", "Ruvanas Inside"]) {
    assert.ok(home.includes(`<h3>${name}</h3>`), `Missing platform ${name}`);
  }
});

test("all prices are masked visually and have accessible unpublished-price text", () => {
  assert.equal((home.match(/class="maskedPrice" aria-hidden="true"/g) || []).length, 35);
  assert.equal((home.match(/class="visuallyHidden">Pricing not yet published/g) || []).length, 35);
  assert.match(home, /\.maskedPrice\{[^}]*filter:blur\(5px\)/);
  assert.doesNotMatch(home, /€\s*\d|£\s*\d|\$\s*\d|EUR\s*\d/i);
  for (const price of new Set(registrationProducts().flatMap((product) => product.plans.map((tier) => tier.priceLabel)))) {
    if (price) assert.ok(!home.includes(escapeHtml(price)), `Published catalogue price: ${price}`);
  }
});

test("the published package is static, self-contained, private-preview only and noindex", () => {
  for (const page of [home, guide]) {
    assert.match(page, /<meta name="robots" content="noindex,nofollow,noarchive">/);
    assert.match(page, /<style>[\s\S]+<\/style>/);
    assert.doesNotMatch(page, /<script\b|<form\b|<input\b|<link\b|<img\b|\/api\/|\/dashboard\//i);
    assert.doesNotMatch(page, /href="[^"]*(?:register|registration|sign-?up)/i);
    assert.doesNotMatch(page, /RUVANAS_INTEREST_RECIPIENT|NOTIFICATION_EMAIL_TOKEN|DATABASE_URL|NEXTAUTH_SECRET/i);
  }
  assert.match(home, /administrator-issued code only/);
  assert.match(home, /capabilities shown here are illustrative/);
  assert.match(guide, /workflows illustrate planned platform capabilities/);
  assert.match(home, /<svg\b/);
});

test("home links lead only to working anchors, the public guide, or issued-code login", () => {
  const ids = new Set([...home.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const links = [...home.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(links.filter((href) => href === login).length >= 4);
  assert.ok(links.includes(guideUrl));
  for (const href of links) {
    if (href.startsWith("#")) assert.ok(ids.has(href.slice(1)), `Broken home anchor ${href}`);
    else assert.ok([login, guideUrl].includes(href), `Unexpected public link ${href}`);
  }
});

test("the public guide preserves the existing six product explanations without private links", () => {
  for (const name of ["Retail", "School", "Radio", "Health", "Faith", "Organisations"]) {
    assert.match(guide, new RegExp(`>${name}</a>`));
  }
  assert.ok((guide.match(/<details class="chapter">/g) || []).length > 20);
  const ids = new Set([...guide.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const href of [...guide.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1])) {
    if (href.startsWith("#")) assert.ok(ids.has(href.slice(1)), `Broken guide anchor ${href}`);
    else assert.ok([homeUrl, login].includes(href), `Unexpected guide link ${href}`);
  }
});
