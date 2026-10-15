import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { PUBLIC_MARKETING_DOCUMENTS, PUBLIC_MARKETING_SOURCE_COMMIT, publicMarketingDocument } from "../lib/private-preview-public-site.mjs";
import { publicMarketingResponse } from "../lib/private-preview-public-site-response.mjs";

const policy = { enabled: true, valid: true, publicSite: true };
const root = resolve("assets/private-preview-public-site");
const origin = "https://www.ruvanas.com";
const request = (pathname, method = "GET") => new Request(origin + pathname, { method });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("public manifest contains only the two frozen internal HTML documents, not a public directory", async () => {
  assert.equal(PUBLIC_MARKETING_SOURCE_COMMIT, "1829fc908025ad13126721525b8395db0db8ff3b");
  assert.deepEqual(Object.keys(PUBLIC_MARKETING_DOCUMENTS), ["/public-marketing/index.html", "/public-marketing/how-it-works/index.html"]);
  assert.deepEqual((await readdir(root)).sort(), ["how-it-works", "index.html"]);
  assert.deepEqual(await readdir(join(root, "how-it-works")), ["index.html"]);
  for (const pathname of ["/", "/how-it-works/", "/public-marketing", "/public-marketing/", "/public-marketing/.env",
    "/public-marketing/../prisma/schema.prisma", "/public-marketing/%2e%2e/.env", "/public-marketing/index.html/extra",
    "/public-marketing/how-it-works/index.html/", "__proto__", null, undefined]) assert.equal(publicMarketingDocument(pathname), null);
});

test("frozen content changes only the login URL and retains masked prices, no registration and no external dependencies", async () => {
  let maskedPrices = 0;
  let loginLinks = 0;
  for (const document of Object.values(PUBLIC_MARKETING_DOCUMENTS)) {
    const bytes = await readFile(join(root, document.file));
    const html = bytes.toString("utf8");
    assert.equal(bytes.length, document.bytes);
    assert.equal(hash(bytes), document.sha256);
    const original = html.replaceAll('href="/login"', 'href="https://ruvanas-platform.onrender.com/login"');
    assert.equal(hash(Buffer.from(original)), document.sourceSha256LF);
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
