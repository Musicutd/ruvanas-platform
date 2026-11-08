import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { PUBLIC_MARKETING_DOCUMENTS, PUBLIC_MARKETING_SOURCE_COMMIT, publicMarketingDocument } from "../lib/private-preview-public-site.mjs";
import { publicMarketingResponse } from "../lib/private-preview-public-site-response.mjs";
import { publicPlansForProduct } from "../lib/product-plan-catalogue.mjs";
import { ruvanasProductGuides } from "../lib/how-ruvanas-works.mjs";

const policy = { enabled: true, valid: true, publicSite: true };
const root = resolve("assets/private-preview-public-site");
const origin = "https://www.ruvanas.com";
const request = (pathname, method = "GET") => new Request(origin + pathname, { method });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const retailPricing = /<section class="pricingFamily" id="pricing-retail">[\s\S]*?(?=<section class="pricingFamily" id="pricing-school">)/;
const retailStory = /<article><span>Retail<\/span><p><strong>Ruvanas Retail<\/strong>[\s\S]*?<\/p><\/article>/;
const retailGuide = /<section class="product" id="retail">[\s\S]*?(?=<section class="product" id="school">)/;
const escapeHtml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

function unchangedOutsideRetail(html, file) {
  const originalLinks = html.replaceAll('href="/login"', 'href="https://ruvanas-platform.onrender.com/login"');
  return file === "index.html"
    ? originalLinks.replace(retailPricing, "[RETAIL_PRICING]").replace(retailStory, "[RETAIL_STORY]")
    : originalLinks.replace(retailGuide, "[RETAIL_GUIDE]");
}

test("public manifest contains only the two frozen internal HTML documents, not a public directory", async () => {
  assert.equal(PUBLIC_MARKETING_SOURCE_COMMIT, "1829fc908025ad13126721525b8395db0db8ff3b");
  assert.equal(PUBLIC_MARKETING_DOCUMENTS["/public-marketing/index.html"].sourceSha256LF, "a53d2519cc6f22b64cf13bf90c79348706f05b8da3f401b7e24d54a4d57ed528");
  assert.equal(PUBLIC_MARKETING_DOCUMENTS["/public-marketing/how-it-works/index.html"].sourceSha256LF, "cb09287c146fe6baa722fe87960043da5e2e1c3c688917fb13563e59d9768a23");
  assert.deepEqual(Object.keys(PUBLIC_MARKETING_DOCUMENTS), ["/public-marketing/index.html", "/public-marketing/how-it-works/index.html"]);
  assert.deepEqual((await readdir(root)).sort(), ["how-it-works", "index.html"]);
  assert.deepEqual(await readdir(join(root, "how-it-works")), ["index.html"]);
  for (const pathname of ["/", "/how-it-works/", "/public-marketing", "/public-marketing/", "/public-marketing/.env",
    "/public-marketing/../prisma/schema.prisma", "/public-marketing/%2e%2e/.env", "/public-marketing/index.html/extra",
    "/public-marketing/how-it-works/index.html/", "__proto__", null, undefined]) assert.equal(publicMarketingDocument(pathname), null);
});

test("reviewed Retail revisions preserve original provenance, other product content and the frozen page safety controls", async () => {
  let maskedPrices = 0;
  let loginLinks = 0;
  for (const document of Object.values(PUBLIC_MARKETING_DOCUMENTS)) {
    const bytes = await readFile(join(root, document.file));
    const html = bytes.toString("utf8");
    assert.equal(bytes.length, document.bytes);
    assert.equal(hash(bytes), document.sha256);
    assert.doesNotMatch(html, /\r/, "manifest checks exact LF-normalized bytes");
    assert.equal(document.reviewedRevision, "RETAIL_FOCUSED_AUDIO_ONLY_V1");
    assert.equal(hash(Buffer.from(unchangedOutsideRetail(html, document.file))), document.unchangedOutsideRetailSha256LF,
      "only the Retail pricing/story or Retail guide may differ from the reviewed source");
    const masks = (html.match(/class="maskedPrice" aria-hidden="true"/g) || []).length;
    const links = (html.match(/href="\/login"/g) || []).length;
    assert.equal(masks, document.maskedPrices);
    assert.equal(links, document.loginLinks);
    maskedPrices += masks;
    loginLinks += links;
    assert.doesNotMatch(html, /<form\b|<input\b|<script\b|<(?:link|img|iframe|audio|video)\b|\bsrc(?:set)?=|url\(/i);
    assert.doesNotMatch(html, /href="(?:https?:|\/api\/|[^"#]*(?:register|sign-?up|checkout))/i);
    assert.doesNotMatch(html, /[€£$]\s*\d/);
  }
  assert.equal(maskedPrices, 35);
  assert.equal(loginLinks, 7);
});

test("frozen Retail cards match the five canonical audio plans with Focused catalogue included and no display offering", async () => {
  const html = await readFile(join(root, "index.html"), "utf8");
  const section = html.match(retailPricing)?.[0];
  assert.ok(section, "Retail pricing is present");
  const cards = [...section.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match => match[0]);
  assert.equal(cards.length, 5);
  for (const [index, plan] of publicPlansForProduct("RETAIL").entries()) {
    const card = cards[index];
    assert.ok(card.includes(`<h4>${escapeHtml(plan.name)}</h4>`));
    assert.ok(card.includes(`<p class="tierDescription">${escapeHtml(plan.description)}</p>`));
    assert.ok(card.includes('<li><span aria-hidden="true">✓</span>Focused Licensed Music Catalogue, subject to product-use and territory rights.</li>'));
    assert.equal((card.match(/Licensed Music Catalogue, subject to product-use/g) || []).length, 1);
    assert.doesNotMatch(card, /unavailableFeature|digital display|signage|cross-media|Premium Licensed|Professional Licensed/i);
    assert.ok(card.includes(plan.stationLimit === 1 ? ">1 site</li>" : `>Up to ${plan.stationLimit} sites</li>`));
    assert.ok(card.includes(`>${plan.storageLimitGb} GB media storage</li>`));
    assert.ok(card.includes(`>High-quality audio up to ${plan.maxBitrateKbps} kbps</li>`));
    assert.ok(card.includes(`>Ruvanas Studio ${plan.tierNumber >= 3 ? "Pro" : "Basic"}</li>`));
    assert.equal((card.match(/class="maskedPrice"/g) || []).length, 1);
    assert.match(card, /aria-disabled="true">Private access only/);
  }
  assert.doesNotMatch(html.match(retailStory)?.[0] || "", /digital display|signage/i);
});

test("frozen Retail workflow guidance matches the current guide without a display workflow", async () => {
  const html = await readFile(join(root, "how-it-works/index.html"), "utf8");
  const section = html.match(retailGuide)?.[0];
  assert.ok(section, "Retail guide is present");
  for (const chapter of ruvanasProductGuides.find(product => product.id === "retail").chapters) {
    for (const text of [chapter.title, chapter.summary, chapter.detail, ...chapter.steps]) assert.ok(section.includes(escapeHtml(text)), text);
  }
  assert.doesNotMatch(section, /digital signage|visual playlists|digital display/i);
});

test("GET and HEAD serve exact frozen bytes for public aliases and internal rewrites, ignoring forged routing headers", async () => {
  const paths = [...Object.entries(PUBLIC_MARKETING_DOCUMENTS),
    ["/", PUBLIC_MARKETING_DOCUMENTS["/public-marketing/index.html"]],
    ["/how-it-works", PUBLIC_MARKETING_DOCUMENTS["/public-marketing/how-it-works/index.html"]],
    ["/how-it-works/", PUBLIC_MARKETING_DOCUMENTS["/public-marketing/how-it-works/index.html"]]];
  for (const [pathname, document] of paths) {
    for (const method of ["GET", "HEAD"]) {
      for (const headers of [undefined, {
        "x-forwarded-host": "unapproved.invalid", "x-forwarded-proto": "http",
        "x-original-url": "/.env", "x-original-uri": "/api/admin/private-preview/password",
        "x-rewrite-url": "/public-marketing/unreviewed.html", "x-forwarded-uri": "/public-marketing/index.html",
        "x-middleware-rewrite": "https://unapproved.invalid/public-marketing/how-it-works/index.html"
      }]) {
      const reads = [];
      const response = await publicMarketingResponse(new Request(origin + pathname, { method, headers }), { policy,
        read: async (file) => { reads.push(file); return readFile(file); } });
      assert.equal(response.status, 200);
      assert.deepEqual(reads, [join(root, document.file)]);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(response.headers.get("content-length"), String(document.bytes));
      assert.equal(response.headers.get("etag"), `"${document.sha256}"`);
      assert.match(response.headers.get("cache-control"), /^public, max-age=300/);
      assert.match(response.headers.get("content-security-policy"), /script-src 'none'/);
      assert.match(response.headers.get("content-security-policy"), /form-action 'none'/);
      assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'; base-uri 'none'/);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, method === "HEAD" ? 0 : document.bytes);
      if (method === "GET") assert.equal(hash(bytes), document.sha256);
      }
    }
  }
});

test("disabled, malformed and unapproved public modes never read a marketing document", async () => {
  for (const deniedPolicy of [undefined, {}, { ...policy, enabled: false }, { ...policy, valid: false },
    { ...policy, publicSite: false }, { ...policy, publicSite: "true" }]) {
    for (const pathname of ["/", "/how-it-works", "/how-it-works/", "/public-marketing/index.html"]) {
    let read = false;
    const response = await publicMarketingResponse(request(pathname), { policy: deniedPolicy,
      read: () => { read = true; throw new Error("Must not read"); } });
    assert.equal(response.status, 404);
    assert.equal(read, false);
    assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
});

test("unknown and traversing routes cannot select files, and non-read methods are not accepted", async () => {
  for (const pathname of ["/public-marketing", "/public-marketing/unknown.html", "/public-marketing/how-it-works",
    "/public-marketing/../../.env", "/public-marketing/%2Findex.html", "/public-marketing/index.html/extra",
    "/public-marketing/how-it-works/index.html/", "/public-marketing/public/index.html", "/how-it-works/extra",
    "/how-it-works/index.html", "/index.html", "/login", "/api/admin/private-preview/password"]) {
    let read = false;
    const forgedRequest = new Request(origin + pathname, { headers: {
      "x-original-url": "/", "x-forwarded-uri": "/how-it-works/",
      "x-middleware-rewrite": origin + "/public-marketing/index.html"
    } });
    const response = await publicMarketingResponse(forgedRequest, { policy,
      read: () => { read = true; throw new Error("Must not read"); } });
    assert.equal(response.status, 404, pathname);
    assert.equal(read, false, pathname);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    let read = false;
    const response = await publicMarketingResponse(request("/public-marketing/index.html", method), { policy,
      read: () => { read = true; throw new Error("Must not read"); } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.equal(read, false);
  }
});

test("missing or altered frozen assets fail safely without revealing paths or raw errors", async () => {
  const document = PUBLIC_MARKETING_DOCUMENTS["/public-marketing/index.html"];
  const good = await readFile(join(root, document.file));
  for (const read of [async () => { throw new Error("private-filesystem-path-or-secret"); },
    async () => Buffer.from("unreviewed replacement"), async () => {
      const altered = Buffer.from(good); altered[0] ^= 1; return altered;
    }]) {
    const response = await publicMarketingResponse(request("/public-marketing/index.html"), { policy, read });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Website temporarily unavailable.");
  }
});

test("the raw route is read-only and its asset bundle is explicitly included in deployment tracing", async () => {
  const route = await readFile(new URL("../app/public-marketing/[[...path]]/route.js", import.meta.url), "utf8");
  const config = (await import("../next.config.mjs")).default;
  assert.deepEqual(config.outputFileTracingIncludes["/public-marketing/[[...path]]"], ["./assets/private-preview-public-site/**/*"]);
  assert.match(route, /export function GET\(request\)/);
  assert.match(route, /export function HEAD\(request\)/);
  assert.match(route, /policy: readPrivatePreviewPolicy\(\)/);
  assert.doesNotMatch(route, /export (?:async )?function (?:POST|PUT|PATCH|DELETE)|prisma|session|cookies/);
});
