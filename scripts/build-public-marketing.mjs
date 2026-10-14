/**
 * Offline snapshot of the reviewed Ruvanas home. Only coming-soon/ is published.
 * The source hashes deliberately stop a silent copy of changed pricing or CTAs.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registrationProducts } from "../lib/registration-experience.mjs";
import { ruvanasProductGuides } from "../lib/how-ruvanas-works.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publish = path.join(root, "coming-soon");
const moduleRoot = path.resolve(root, "../ruvanas-private-app-preview-20261011");
const privateRequire = createRequire(path.join(moduleRoot, "package.json"));
const swc = privateRequire("next/dist/build/swc");
const { renderToStaticMarkup } = privateRequire("react-dom/server");
const LOGIN = "https://ruvanas-platform.onrender.com/login";
const PUBLIC_GUIDE = "/how-it-works/";
const PUBLIC_HOME = "/";

const PINNED = Object.freeze({
  "app/page.js": "7f005318dcc776eeb178830fda8392f9ca6649b77a934cebe2c3d331d88dd723",
  "app/home.module.css": "16f9c331be3c4c2854997a9f5e585d997b70161339f3d39f496224fc8615a0d6",
  "lib/registration-experience.mjs": "148359b8127990f08427a402fe21a42219c0882903b57d8f913a626f94ba574d",
  "lib/how-ruvanas-works.mjs": "d8329cd7825c1c3113128f2304a6ce1451ee3476274be0fa5660244eed689658",
});

async function pinnedSource(name) {
  const source = await readFile(path.join(root, name), "utf8");
  const actual = createHash("sha256").update(source).digest("hex");
  assert.equal(actual, PINNED[name], `Review changed ${name} before rebuilding the public page`);
  return source;
}

function replaceOnce(source, before, after, label) {
  const at = source.indexOf(before);
  assert.ok(at !== -1, `Missing reviewed ${label}`);
  assert.equal(source.indexOf(before, at + before.length), -1, `Ambiguous reviewed ${label}`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function document(title, description, css, body) {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex,nofollow,noarchive">\n<meta name="description" content="${escapeHtml(description)}">\n<title>${escapeHtml(title)}</title>\n<style>${css}</style>\n</head>\n<body>${body}</body>\n</html>\n`;
}

function createHomeSource(source) {
  source = source.replaceAll("\r\n", "\n");
  source = source.replace(/^import .*;\r?\n/gm, "");
  assert.doesNotMatch(source, /^import /m);
  const begin = source.indexOf("  let approvedProductPlans = registrationProducts();");
  const end = source.indexOf("  const pricingFamilies =", begin);
  assert.ok(begin > 0 && end > begin);
  source = source.slice(0, begin) + "  const approvedProductPlans = registrationProducts();\n" + source.slice(end);
  source = replaceOnce(source,
    "<div className={`${styles.price} ${styles.priceLabel}`}><strong>{tier.priceLabel}</strong></div>",
    '<div className={`${styles.price} ${styles.priceLabel}`}><strong className="maskedPrice" aria-hidden="true">€ ••• / month</strong><span className="visuallyHidden">Pricing not yet published</span></div>',
    "masked pricing");
  source = replaceOnce(source,
    '{SELF_SERVICE_REGISTRATION_ENABLED ? (\n                      <a className={tier.tierNumber === 3 ? styles.priceCtaFeatured : styles.priceCta} href={`/register?platform=${family.id}&tier=${tier.publicSlug}`}>\n                        {tier.enterpriseContactRequired ? "Discuss " : "Choose "}{tier.name} <ArrowIcon />\n                      </a>\n                    ) : <span className={styles.priceCtaDisabled} aria-disabled="true">Registration paused</span>}',
    '<span className={styles.priceCtaDisabled} aria-disabled="true">Private access only</span>',
    "tier registration CTA");
  source = replaceOnce(source,
    '{SELF_SERVICE_REGISTRATION_ENABLED\n            ? <a href="/register?platform=enterprise">Talk to Ruvanas <ArrowIcon /></a>\n            : <span className={styles.enterpriseRegistrationPaused} aria-disabled="true">Registration paused</span>}',
    '<span className={styles.enterpriseRegistrationPaused} aria-disabled="true">Private access only</span>',
    "enterprise registration CTA");
  source = replaceOnce(source,
    "Prices are shown in euro and exclude applicable tax. Music licensing, production, media, unusually high delivery volumes and bespoke services may be agreed separately. Final eligibility and service configuration are confirmed during onboarding.",
    "Pricing is not yet published. Service availability, eligibility and configuration will be confirmed during private onboarding.",
    "pricing note");
  source = replaceOnce(source,
    '<div className={styles.heroActions}>',
    '<p className="publicNotice">Platform capabilities shown here are illustrative. The service is in private preview; customer access is by an administrator-issued code only.</p>\n            <div className={styles.heroActions}>',
    "private-preview notice");
  source = replaceOnce(source,
    '            <a className={styles.loginLink} href="/login">Log in</a>\n',
    '',
    "duplicate header login");
  source = source.replaceAll('href="/how-it-works"', `href="${PUBLIC_GUIDE}"`);
  source = source.replaceAll('href="/login"', `href="${LOGIN}"`);
  source = source.replaceAll('href="/register/free-access"', `href="${LOGIN}"`);
  source = source.replaceAll("Use access code", "Log in");
  source = source.replaceAll("Create account with code", "Log in with issued code");
  source = source.replaceAll("Use your free-access code", "Log in with issued code");
  source = source.replaceAll("Already a member? Log in", "Log in");
  source = source.replaceAll("Six platforms. One standard.", "Seven platforms. One standard.");
  source = source.replaceAll("Six specialised product families", "Seven specialised product families");
  source = source.replaceAll("Illustration of the Ruvanas live audio network", "Illustrative Ruvanas audio network concept");
  source = source.replaceAll("Live network", "Network concept");
  source = source.replaceAll("12 locations online", "Multi-location concept");
  source = source.replaceAll("Listeners connected", "Listener experience concept");
  source = source.replaceAll("<span>Live</span><i />", "<span>Concept</span><i />");
  source = source.replaceAll("{new Date().getFullYear()}", "2026");
  assert.doesNotMatch(source, /SELF_SERVICE_REGISTRATION_ENABLED|prisma\.|href=["']\/register|tier\.priceLabel/);
  return `const styles = new Proxy({}, { get: (_, key) => key });\nconst registrationProducts = require("__catalogue").registrationProducts;\n${source}`;
}

async function buildHome() {
  const source = createHomeSource(await pinnedSource("app/page.js"));
  const css = await pinnedSource("app/home.module.css");
  await pinnedSource("lib/registration-experience.mjs");
  const transformed = swc.transformSync(source, {
    jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020", transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" }
  });
  const module = { exports: {} };
  const requireSafe = (name) => name === "__catalogue" ? { registrationProducts } : privateRequire(name);
  new Function("require", "module", "exports", transformed.code)(requireSafe, module, module.exports);
  const markup = renderToStaticMarkup(await module.exports.default());
  const publicCss = `html{scroll-behavior:smooth}body{margin:0}\n${css}\n.publicNotice{max-width:610px;margin:18px 0;color:#f4d69b;font-size:13px;line-height:1.65}\n.maskedPrice{display:inline-block;filter:blur(5px);user-select:none;pointer-events:none}\n.visuallyHidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}\n`;
  const html = document("Ruvanas | Professional Media Platforms", "Explore Ruvanas professional media platforms. Private preview access is by administrator-issued code.", publicCss, markup);
  assert.equal((html.match(/class="priceCard/g) || []).length, 35, "Expected all 35 tier cards");
  assert.equal((html.match(/Pricing not yet published/g) || []).length, 35, "Expected 35 accessible price masks");
  assert.doesNotMatch(html, /<script\b|<form\b|<input\b|\/api\/|href="[^"]*(?:register|sign-?up)/i);
  await writeFile(path.join(publish, "index.html"), html);
  return html.length;
}

function buildGuideCss() {
  return `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#0b1628;color:#f7f8fb;font:16px/1.6 Arial,sans-serif}a{color:#f4b942}a:focus-visible,summary:focus-visible{outline:3px solid #f4b942;outline-offset:4px}.top{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px max(24px,calc((100vw - 1180px)/2));border-bottom:1px solid #33445c}.brand{color:#f4b942;font-weight:900;letter-spacing:.2em;text-decoration:none}.top nav{display:flex;gap:20px}.top nav a{text-decoration:none;font-size:14px;font-weight:800}.wrap{width:min(1180px,calc(100% - 40px));margin:auto;padding:60px 0 90px}.eyebrow{color:#f4b942;font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}h1,h2,h3{line-height:1.1}h1{font-size:clamp(38px,6vw,66px);margin:8px 0 24px}h2{font-size:clamp(28px,4vw,42px);margin:0 0 18px}p{color:#aeb9c8}.notice{max-width:850px;padding:18px 22px;border:1px solid #805d20;border-radius:12px;background:#302611;color:#f7dfaa}.guideNav{display:flex;flex-wrap:wrap;gap:10px;margin:30px 0 60px}.guideNav a{padding:8px 12px;border:1px solid #33445c;border-radius:99px;text-decoration:none}.product{margin:55px 0;padding:30px;border:1px solid #33445c;border-radius:18px;background:#142136}.product header{display:grid;grid-template-columns:1fr minmax(200px,300px);gap:28px}.product .outcome{padding:20px;border-radius:12px;background:#302611;color:#f7dfaa}.product .outcome strong{display:block;margin-top:6px}.chapter{margin-top:14px;border:1px solid #33445c;border-radius:12px;background:#182841}.chapter summary{cursor:pointer;padding:16px 20px;font-weight:800}.chapter summary span{display:block;margin-top:5px;color:#aeb9c8;font-size:13px;font-weight:400}.chapterBody{padding:4px 20px 20px}.chapterBody li{margin:6px 0;color:#c8ddf4}.bottom{padding:35px 20px;text-align:center;border-top:1px solid #33445c}@media(max-width:680px){.top{padding:16px}.product{padding:20px}.product header{grid-template-columns:1fr}.wrap{width:calc(100% - 28px);padding-top:35px}}`;
}

async function buildGuide() {
  await pinnedSource("lib/how-ruvanas-works.mjs");
  const nav = ruvanasProductGuides.map((product) => `<a href="#${escapeHtml(product.id)}">${escapeHtml(product.tabLabel)}</a>`).join("");
  const sections = ruvanasProductGuides.map((product) => `<section class="product" id="${escapeHtml(product.id)}"><header><div><p class="eyebrow">${escapeHtml(product.eyebrow)}</p><h2>${escapeHtml(product.title)}</h2><p>${escapeHtml(product.introduction)}</p></div><aside class="outcome"><small>THE RESULT</small><strong>${escapeHtml(product.outcome)}</strong></aside></header>${product.chapters.map((chapter) => `<details class="chapter"><summary>${escapeHtml(chapter.title)}<span>${escapeHtml(chapter.summary)}</span></summary><div class="chapterBody"><p>${escapeHtml(chapter.detail)}</p><h3>What the workflow involves</h3><ol>${chapter.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></div></details>`).join("")}</section>`).join("");
  const body = `<header class="top"><a class="brand" href="${PUBLIC_HOME}">RUVANAS</a><nav aria-label="Public navigation"><a href="${PUBLIC_HOME}">Home</a><a href="${LOGIN}">Log in</a></nav></header><main class="wrap"><p class="eyebrow">A guided overview</p><h1>How Ruvanas works</h1><p class="notice">These workflows illustrate planned platform capabilities. Ruvanas is in private preview; no public registration or customer service is offered from this page. Access is by administrator-issued code only.</p><nav class="guideNav" aria-label="Product guides">${nav}</nav>${sections}</main><footer class="bottom"><a href="${PUBLIC_HOME}">Back to Ruvanas</a> · <a href="${LOGIN}">Log in with issued code</a></footer>`;
  const html = document("How Ruvanas works", "An illustrative guide to Ruvanas platform workflows during private preview.", buildGuideCss(), body);
  assert.doesNotMatch(html, /<script\b|<form\b|<input\b|\/api\/|\/dashboard\/|href="[^"]*(?:register|sign-?up)/i);
  await mkdir(path.join(publish, "how-it-works"), { recursive: true });
  await writeFile(path.join(publish, "how-it-works", "index.html"), html);
  return html.length;
}

const [homeBytes, guideBytes] = await Promise.all([buildHome(), buildGuide()]);
console.log(`Built self-contained public marketing pages: home ${homeBytes} bytes, guide ${guideBytes} bytes.`);
