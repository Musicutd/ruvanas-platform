import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { catalogueTestFfmpegArguments, catalogueTestMediaIdentity, downloadCatalogueTestMedia, shoutcastTestResponseAccepted, validateCatalogueTestTarget, watchCatalogueTestChild } from "../lib/catalogue-test-transport.mjs";

const asset = bytes => ({ libraryType: "RUVANAS_CATALOGUE", organisationId: null, storageKey: `catalogue/music/${createHash("sha256").update(bytes).digest("hex")}.mp3`, sizeBytes: BigInt(bytes.length) });
const target = () => ({ providerKey: "CENTOVA_CAST", serverHost: "pollux.shoutca.st", sourcePort: 8282, bitrateKbps: 128, sourceUsername: "", centovaUsername: "ruvanastestradio", outboundAutoDjEnabled: false, sourcePasswordEncrypted: "not-a-real-secret" });

test("renamed test account remains fixed to port 8282 and password-only source authentication", () => {
  assert.equal(validateCatalogueTestTarget(target()), true);
  assert.equal(validateCatalogueTestTarget({ ...target(), sourceUsername: null }), true);
  for (const change of [{ providerKey: "GENERIC_HTTP" }, { serverHost: "127.0.0.1" }, { serverHost: "other.shoutca.st" },
    { sourcePort: 8198 }, { sourcePort: 8393 }, { centovaUsername: "ruvanas_test_radio" }, { centovaUsername: "radio105" },
    { sourceUsername: "ruvanastestradio" }, { sourceUsername: "root" }, { bitrateKbps: 320 },
    { outboundAutoDjEnabled: true }, { sourcePasswordEncrypted: null }, { lastError: "CATALOGUE_TEST_STOP_UNCONFIRMED" }]) {
    assert.throws(() => validateCatalogueTestTarget({ ...target(), ...change }), { code: "TEST_SOURCE_NOT_READY" });
  }
});
test("only exact Shoutcast auth success is accepted", () => {
  assert.equal(shoutcastTestResponseAccepted("OK2\n"), true);
  assert.equal(shoutcastTestResponseAccepted("OK2\r\nicy-caps:11\r\n"), true);
  for (const response of ["invalid password OK2\n", "OK20\n", "HTTP/1.0 200 OK\r\n", "OK2", "error"]) assert.equal(shoutcastTestResponseAccepted(response), false);
});
test("private catalogue audio uses exact checksum identity with strict size bounds", () => {
  const bytes = Buffer.from("synthetic");
  assert.equal(catalogueTestMediaIdentity(asset(bytes)).extension, "mp3");
  for (const change of [{ storageKey: "https://secret.example/audio.mp3" }, { storageKey: "../audio.mp3" }, { organisationId: "other" }, { libraryType: "ORGANISATION_MUSIC" }, { sizeBytes: 0 }, { sizeBytes: 50 * 1024 * 1024 + 1 }]) assert.throws(() => catalogueTestMediaIdentity({ ...asset(bytes), ...change }));
});
test("download verifies actual bytes and refuses mismatch without overwriting", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "ruvanas-catalogue-test-"));
  const bytes = Buffer.from("synthetic test bytes, not real music");
  const signal = new AbortController().signal;
  try {
    const file = path.join(folder, "track.mp3");
    assert.equal(await downloadCatalogueTestMedia(Readable.from([bytes]), file, asset(bytes), { signal }), bytes.length);
    assert.deepEqual(await readFile(file), bytes);
    await assert.rejects(downloadCatalogueTestMedia(Readable.from([bytes]), file, asset(bytes), { signal }), { code: "EEXIST" });
    await assert.rejects(downloadCatalogueTestMedia(Readable.from([Buffer.from("X".repeat(bytes.length))]), path.join(folder, "bad.mp3"), asset(bytes), { signal }), { code: "TEST_MEDIA_CHECKSUM_MISMATCH" });
    await assert.rejects(downloadCatalogueTestMedia(Readable.from([Buffer.concat([bytes, bytes])]), path.join(folder, "big.mp3"), asset(bytes), { signal }), { code: "TEST_MEDIA_SIZE_MISMATCH" });
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("encoder arguments expose no network destination and never loop the source", () => {
  const args = catalogueTestFfmpegArguments("/tmp/verified.mp3", 30);
  assert.ok(args.includes("file,pipe")); assert.ok(args.includes("-re"));
  assert.equal(args.at(-1), "pipe:1"); assert.ok(!args.includes("-stream_loop"));
  assert.throws(() => catalogueTestFfmpegArguments("x", 301));
});
test("a failed kill is not proof of child exit and cannot release its files or lease", async () => {
  const child = new EventEmitter();
  let kills = 0, resource, confirmed = false;
  child.pid = 12345;
  child.kill = () => { kills++; child.emit("error", Object.assign(new Error("synthetic kill failure"), { code: "EPERM" })); return false; };
  const guard = watchCatalogueTestChild(child, value => { resource = value; });
  const close = resource.close().then(() => { confirmed = true; });
  await Promise.resolve();
  assert.equal(confirmed, false);
  resource.forceClose();
  assert.equal(kills, 2);
  child.emit("close", 1);
  assert.equal(await guard.exit, -1);
  await close;
  assert.equal(confirmed, true);
});
