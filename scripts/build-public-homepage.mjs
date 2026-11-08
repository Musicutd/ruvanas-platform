import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicHomepage, PUBLIC_HOMEPAGE_PRODUCT_FAMILIES } from "../lib/public-homepage-launch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = value => createHash("sha256").update(value).digest("hex");
const mode = process.argv.slice(2);
if (mode.length !== 1 || !["--check", "--write"].includes(mode[0])) throw new Error("Use --check or --write");
const source = await readFile(resolve(root, "assets/public-homepage-source/index.html"), "utf8");
if (hash(source) !== "a13287d77e4a9c8cc00dc230279256cf3dc891ea33720420f312fb1a83901c05") {
  throw new Error("The retained homepage source changed; review it before regeneration");
}
const html = buildPublicHomepage(source);
const target = resolve(root, "assets/private-preview-public-site/index.html");
if (mode[0] === "--check") {
  if (html !== await readFile(target, "utf8")) throw new Error("Frozen homepage is out of date");
} else {
  const manifestPath = resolve(root, "lib/private-preview-public-site.mjs");
  let manifest = await readFile(manifestPath, "utf8");
  if ((manifest.match(/"\/public-marketing\/index\.html": Object\.freeze\(\{/g) || []).length !== 1) {
    throw new Error("Homepage manifest structure changed");
  }
  const beforeManifest = manifest;
  manifest = manifest.replace(/("\/public-marketing\/index\.html": Object\.freeze\(\{)[\s\S]*?(?=\n  \}\),)/,
    `$1\n    file: "index.html", bytes: ${Buffer.byteLength(html)},\n    sha256: "${hash(html)}",\n    reviewedRevision: "RETAIL_ONLY_HOMEPAGE_V1",\n    retainedHomepageSourceSha256LF: "${hash(source)}",\n    sourceSha256LF: "a53d2519cc6f22b64cf13bf90c79348706f05b8da3f401b7e24d54a4d57ed528",\n    maskedPrices: ${(html.match(/class="maskedPrice" aria-hidden="true"/g) || []).length}, loginLinks: 5`);
  if (manifest === beforeManifest && !manifest.includes(`sha256: "${hash(html)}"`)) throw new Error("Homepage manifest update failed");
  await writeFile(target, html);
  await writeFile(manifestPath, manifest.replace(/\r\n/g, "\n"));
}
console.log(JSON.stringify({status: mode[0] === "--write" ? "WRITTEN" : "VERIFIED", families: PUBLIC_HOMEPAGE_PRODUCT_FAMILIES, bytes: Buffer.byteLength(html), sha256: hash(html)}));
