import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// These are release gates, not a network advisory scan. A deliberate future
// Next upgrade should update this pin and keep the coordinated packages aligned.
const NEXT_PATCH = "15.5.28";
const SHARP_MINIMUM = "0.35.5";
const SWC_PACKAGES = [
  "@next/swc-darwin-arm64", "@next/swc-darwin-x64",
  "@next/swc-linux-arm64-gnu", "@next/swc-linux-arm64-musl",
  "@next/swc-linux-x64-gnu", "@next/swc-linux-x64-musl",
  "@next/swc-win32-arm64-msvc", "@next/swc-win32-x64-msvc",
];
const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const manifest = await json("package.json");
const lock = await json("package-lock.json");

function stableVersion(version) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "Security baseline versions must be exact stable releases, not ranges or prereleases.");
  return version.split(".").map(Number);
}
function atLeast(version, minimum) {
  const actual = stableVersion(version), baseline = stableVersion(minimum);
  const changed = actual.findIndex((part, index) => part !== baseline[index]);
  return changed === -1 || actual[changed] > baseline[changed];
}
function lockedPackage(name) {
  const record = lock.packages?.[`node_modules/${name}`];
  assert.ok(record, `${name} must be present in the committed portable lockfile.`);
  const filename = name.split("/").at(-1);
  assert.equal(record.resolved, `https://registry.npmjs.org/${name}/-/${filename}-${record.version}.tgz`);
  assert.match(record.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, `${name} must retain its locked package integrity.`);
  return record;
}

test("manifest and resolved lockfile pin the corrected Next security release", () => {
  assert.equal(manifest.dependencies.next, NEXT_PATCH);
  assert.equal(lock.packages[""].dependencies.next, NEXT_PATCH);
  assert.equal(lockedPackage("next").version, NEXT_PATCH);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (/(?:^|\/)node_modules\/next$/.test(path)) assert.equal(entry.version, NEXT_PATCH, `${path} must not retain an older nested Next release.`);
  }
});

test("installed Next and its environment helper match the locked patched release", async () => {
  const installed = await json("node_modules/next/package.json");
  assert.equal(installed.version, NEXT_PATCH);
  assert.equal(installed.version, lockedPackage("next").version);
  assert.equal(installed.dependencies["@next/env"], NEXT_PATCH);
  assert.equal(lockedPackage("@next/env").version, NEXT_PATCH);
  assert.equal((await json("node_modules/@next/env/package.json")).version, NEXT_PATCH);
});

test("all portable Next SWC packages remain coordinated, without requiring foreign-platform binaries", async () => {
  const next = await json("node_modules/next/package.json");
  assert.deepEqual(Object.keys(next.optionalDependencies).filter(name => name.startsWith("@next/swc-")).sort(), [...SWC_PACKAGES].sort());
  let compatibleInstalled = 0;
  let compatibleLocked = 0;
  for (const name of SWC_PACKAGES) {
    const entry = lockedPackage(name);
    assert.equal(entry.version, NEXT_PATCH, `${name} must match Next.`);
    assert.equal(next.optionalDependencies[name], NEXT_PATCH);
    assert.equal(entry.optional, true);
    const compatible = entry.os?.includes(process.platform) && entry.cpu?.includes(process.arch);
    if (compatible) compatibleLocked += 1;
    let installed;
    try { installed = await json(`node_modules/${name}/package.json`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (installed) {
      assert.equal(installed.version, NEXT_PATCH, `${name}'s installed metadata must match its lock entry.`);
      if (compatible) compatibleInstalled += 1;
    }
  }
  if (compatibleLocked) assert.ok(compatibleInstalled > 0, "At least one matching local SWC package must be installed; other platforms remain lockfile-only.");
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (/(?:^|\/)node_modules\/@next\/(?:env|swc-[^/]+)$/.test(path)) assert.equal(entry.version, NEXT_PATCH, `${path} must not retain a mismatched helper/compiler.`);
  }
});

test("sharp override, every locked resolution and installed version retain the safe minimum", async () => {
  assert.ok(atLeast(manifest.overrides.sharp, SHARP_MINIMUM), "The sharp override must remain at least 0.35.5.");
  const sharp = lockedPackage("sharp");
  assert.ok(atLeast(sharp.version, SHARP_MINIMUM));
  assert.equal((await json("node_modules/sharp/package.json")).version, sharp.version);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (/(?:^|\/)node_modules\/sharp$/.test(path)) assert.ok(atLeast(entry.version, SHARP_MINIMUM), `${path} must not resolve to vulnerable sharp.`);
  }
});
