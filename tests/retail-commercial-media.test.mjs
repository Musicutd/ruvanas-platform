import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "../lib/retail-subscriber-access.mjs";
import { retailCommercialMediaIdentity, downloadRetailCommercialMedia } from "../lib/retail-commercial-media.mjs";

const bytes = Buffer.from("only synthetic local commercial audio"), checksum = createHash("sha256").update(bytes).digest("hex");
const media = () => ({ organisationId: ORG, libraryType: "ORGANISATION_PROMO", status: "READY", mediaType: "COMMERCIAL", mimeType: "audio/mpeg",
  storageKey: `organisations/${ORG}/promos/commercial/${checksum}.mp3`, sizeBytes: BigInt(bytes.length), checksumSha256: checksum });
test("commercial identity never admits foreign organisation, catalogue, unverified or unsafe object paths", () => {
  assert.deepEqual(retailCommercialMediaIdentity(media()), { checksum, extension: "mp3", sizeBytes: bytes.length });
  assert.equal(retailCommercialMediaIdentity({ ...media(), storageKey: `organisations/${ORG}/studio/order-1/final_master/token-1.mp3` }).extension, "mp3");
  for (const delta of [{ organisationId: "foreign" }, { libraryType: "RUVANAS_CATALOGUE" }, { status: "PROCESSING" }, { mediaType: "MUSIC" },
    { checksumSha256: null }, { storageKey: `organisations/${ORG}/promos/commercial/other.mp3` }, { sizeBytes: 51 * 1024 * 1024 },
    { sizeBytes: 0 }, { mimeType: "image/png" }, { storageKey: `organisations/foreign/promos/commercial/${checksum}.mp3` },
    { storageKey: `organisations/${ORG}/studio/../../secrets.mp3` }, { storageKey: `organisations/${ORG}/studio/order/final_master/file.mp3?secret` }])
    assert.throws(() => retailCommercialMediaIdentity({ ...media(), ...delta }), /MEDIA_IDENTITY_INVALID/);
});
test("commercial downloads require exact approved size and checksum and never overwrite a local file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "retail-commercial-test-"));
  try {
    const file = path.join(directory, "good.mp3"), signal = new AbortController().signal;
    assert.equal(await downloadRetailCommercialMedia(Readable.from([bytes]), file, media(), { signal }), bytes.length);
    assert.deepEqual(await readFile(file), bytes);
    await assert.rejects(downloadRetailCommercialMedia(Readable.from([bytes]), file, media(), { signal }), { code: "EEXIST" });
    assert.deepEqual(await readFile(file), bytes);
    await assert.rejects(downloadRetailCommercialMedia(Readable.from([Buffer.alloc(bytes.length)]), path.join(directory, "wrong.mp3"), media(), { signal }), /CHECKSUM_MISMATCH/);
    await assert.rejects(downloadRetailCommercialMedia(Readable.from([Buffer.alloc(bytes.length + 1)]), path.join(directory, "long.mp3"), media(), { signal }), /SIZE_MISMATCH/);
    const stopped = new AbortController(); stopped.abort(new Error("test abort"));
    await assert.rejects(downloadRetailCommercialMedia(Readable.from([bytes]), path.join(directory, "stopped.mp3"), media(), { signal: stopped.signal }), /test abort/);
    const during = new AbortController();
    const source = Readable.from((async function* () {
      yield bytes.subarray(0, 3);
      during.abort();
      yield bytes.subarray(3);
    })());
    await assert.rejects(downloadRetailCommercialMedia(source, path.join(directory, "interrupted.mp3"), media(), { signal: during.signal }), { name: "AbortError" });
    assert.equal(source.destroyed, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
