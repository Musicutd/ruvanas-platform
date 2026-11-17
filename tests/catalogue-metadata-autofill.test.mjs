import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyCatalogueMetadataAutofill, clearCatalogueMetadataAutofill } from "../lib/catalogue-metadata-autofill.mjs";
import { parseCatalogueManifest } from "../lib/catalogue-bulk-import.mjs";
import { selectSingleCatalogueRow } from "../lib/catalogue-single-metadata.mjs";

const source = await readFile(new URL("../app/admin/catalogue/CatalogueUploadForm.js", import.meta.url), "utf8");
const functions = source.slice(source.indexOf("  async function matchMetadata() {"), source.indexOf("\n  return ("));
assert.match(functions, /async function matchMetadata/);
assert.match(functions, /async function submit/);

// User-provided CSV shape reproduced inline, not read from a local Downloads
// folder. Only filenames and this synthetic sheet are passed to fetch stubs.
const csv = "#,Artist,Title,Mix,Time,End,BPM,Genre,Content Warning\n1,Zara Larsson,Blue Moon,,3:02,Cold,151,Pop,\n";
const audio = () => new File(["synthetic preview fixture; not audio"], "Zara Larsson - Blue Moon.mp3", { type: "audio/mpeg" });
const spreadsheet = () => new File([csv], "sample.csv", { type: "text/csv" });
const genres = [{ id: "pop", name: "Pop", slug: "pop" }];
const rows = await parseCatalogueManifest({ buffer: Buffer.from(csv), fileName: "sample.csv", genres, allowNewGenres: true });
const row = selectSingleCatalogueRow(rows, audio().name).row;
const metadata = {
  sheetRow: row.sheetRow, title: row.title, artist: row.artist, album: row.album || "", mixName: row.mixName || "",
  bpm: row.bpm ?? "", releaseYear: row.releaseYear ?? "", durationSeconds: row.durationSeconds ?? "",
  isExplicit: row.isExplicit, genreIds: row.genreIds, genreNames: row.genreNames, newGenreNames: row.newGenreNames
};
const ok = (value = metadata) => ({ ok: true, json: async () => ({ ok: true, metadata: value }) });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function control(initial = "") {
  let value = String(initial);
  return { get value() { return value; }, set value(next) { value = String(next); } };
}

function harness(fetchImpl = async () => ok()) {
  const fields = Object.fromEntries(["title", "artist", "album", "mixName", "bpm", "releaseYear", "durationSeconds", "newGenres"].map((name) => [name, control()]));
  fields.file = { files: [] };
  fields.metadataSpreadsheet = { files: [] };
  fields.isExplicit = { checked: false };
  for (const [name, value] of Object.entries({ rightsHolder: "Manual rights holder", rightsReference: "Manual licence reference",
    permittedTerritories: "MT", licenceExpiresAt: "2027-01-01", minimumCatalogueLevel: "FOCUSED" })) fields[name] = control(value);
  for (const [name, checked] of Object.entries({ rightsConfirmed: true, publishNow: false, licensedCatalogue: true })) fields[name] = { checked };
  const boxes = [{ value: "pop", checked: false }, { value: "soul", checked: false }];
  const form = {
    elements: { namedItem: (name) => fields[name] || null },
    querySelectorAll: (selector) => { assert.equal(selector, 'input[name="genreIds"]'); return boxes; },
    reset: () => { for (const item of Object.values(fields)) {
      if ("files" in item) item.files = [];
      else if ("checked" in item) item.checked = false;
      else item.value = "";
    } boxes.forEach((box) => { box.checked = false; }); }
  };
  class SyntheticFormData extends FormData {
    constructor(target) {
      super();
      if (!target) return;
      assert.equal(target, form);
      for (const [name, item] of Object.entries(fields)) {
        if ("files" in item) { if (item.files[0]) this.set(name, item.files[0]); }
        else if ("checked" in item) { if (item.checked) this.set(name, "on"); }
        else this.set(name, item.value);
      }
      for (const box of boxes) if (box.checked) this.append("genreIds", box.value);
    }
  }
  const state = { metadataPreview: null, previewing: false, metadataFilesReady: false, metadataError: "", uploading: false, error: "", success: "", refreshes: 0 };
  const setters = Object.fromEntries(["Previewing", "MetadataFilesReady", "MetadataError", "Uploading", "Error", "Success"].map((name) => {
    const key = name[0].toLowerCase() + name.slice(1);
    return [`set${name}`, (value) => { state[key] = value; }];
  }));
  const calls = [];
  const pair = { current: { audio: null, spreadsheet: null, matched: false, autofill: null } };
  const requestNumber = { current: 0 };
  const factory = new Function("formRef", "previewRequest", "metadataPair", "state", "fetch", "FormData", "router",
    "applyCatalogueMetadataAutofill", "clearCatalogueMetadataAutofill", ...Object.keys(setters),
    `let metadataPreview = null;
     function setMetadataPreview(value) { metadataPreview = value; state.metadataPreview = value; }
     ${functions}
     return { matchMetadata, submit };`);
  const methods = factory({ current: form }, requestNumber, pair, state,
    async (...args) => { calls.push(args); return fetchImpl(...args); }, SyntheticFormData,
    { refresh: () => { state.refreshes++; } }, applyCatalogueMetadataAutofill, clearCatalogueMetadataAutofill, ...Object.values(setters));
  const rights = () => Object.fromEntries(["rightsHolder", "rightsReference", "permittedTerritories", "licenceExpiresAt",
    "minimumCatalogueLevel", "rightsConfirmed", "publishNow", "licensedCatalogue"].map((name) => [name,
    "checked" in fields[name] ? fields[name].checked : fields[name].value]));
  return { ...methods, fields, boxes, form, state, calls, pair, requestNumber, rights,
    selectBoth() { fields.file.files = [audio()]; fields.metadataSpreadsheet.files = [spreadsheet()]; },
    submitEvent: () => ({ preventDefault() {}, currentTarget: form }) };
}

for (const first of ["file", "metadataSpreadsheet"]) {
  test(`actual form matches the sample and fills all details with ${first} selected first`, async () => {
    const h = harness(async (url, options) => {
      assert.equal(url, "/api/admin/catalogue/metadata-preview");
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("audioFileName"), "Zara Larsson - Blue Moon.mp3");
      assert.equal(await options.body.get("spreadsheet").text(), csv);
      return ok();
    });
    const before = h.rights();
    const second = first === "file" ? "metadataSpreadsheet" : "file";
    h.fields[first].files = [first === "file" ? audio() : spreadsheet()];
    await h.matchMetadata();
    assert.equal(h.calls.length, 0);
    assert.equal(h.state.previewing, false);
    assert.equal(h.state.metadataFilesReady, false);
    h.fields[second].files = [second === "file" ? audio() : spreadsheet()];
    await h.matchMetadata();
    assert.deepEqual(Object.fromEntries(["title", "artist", "album", "mixName", "bpm", "releaseYear", "durationSeconds"].map((name) => [name, h.fields[name].value])),
      { title: "Blue Moon", artist: "Zara Larsson", album: "", mixName: "", bpm: "151", releaseYear: "", durationSeconds: "182" });
    assert.equal(h.fields.isExplicit.checked, false);
    assert.equal(h.boxes[0].checked, true);
    assert.equal(h.boxes[1].checked, false);
    assert.equal(h.state.metadataPreview.sheetRow, 2);
    assert.equal(h.state.metadataFilesReady, true);
    assert.equal(h.state.previewing, false);
    assert.equal(h.pair.current.matched, true);
    assert.deepEqual(h.rights(), before);
  });
}

test("out-of-order responses cannot overwrite the newest selected file pair", async () => {
  const a = deferred(), b = deferred();
  let calls = 0;
  const h = harness(() => ++calls === 1 ? a.promise : b.promise);
  h.selectBoth();
  const before = h.rights();
  const first = h.matchMetadata();
  h.fields.file.files = [new File(["second synthetic fixture"], "second.mp3")];
  const second = h.matchMetadata();
  b.resolve(ok({ ...metadata, title: "Newest song", artist: "Newest performer", album: "Album", mixName: "Radio edit", releaseYear: 2026, isExplicit: true }));
  await second;
  a.resolve(ok());
  await first;
  assert.equal(h.fields.title.value, "Newest song");
  assert.equal(h.fields.artist.value, "Newest performer");
  assert.equal(h.fields.album.value, "Album");
  assert.equal(h.fields.mixName.value, "Radio edit");
  assert.equal(h.fields.releaseYear.value, "2026");
  assert.equal(h.fields.isExplicit.checked, true);
  assert.equal(h.state.metadataPreview.title, "Newest song");
  assert.equal(h.pair.current.audio, h.fields.file.files[0]);
  assert.equal(h.pair.current.matched, true);
  assert.equal(h.state.previewing, false);
  assert.deepEqual(h.rights(), before);
});

test("clearing either picker or selecting an oversized sheet ends pending state before the old request completes", async () => {
  for (const change of ["file", "metadataSpreadsheet", "oversized"]) {
    const pending = deferred();
    const h = harness(() => pending.promise);
    h.selectBoth();
    const before = h.rights();
    const old = h.matchMetadata();
    assert.equal(h.state.previewing, true);
    if (change === "oversized") h.fields.metadataSpreadsheet.files = [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.csv")];
    else h.fields[change].files = [];
    await h.matchMetadata();
    assert.equal(h.state.previewing, false, change);
    assert.equal(h.state.metadataPreview, null, change);
    assert.equal(h.pair.current.matched, false, change);
    assert.equal(h.calls.length, 1, change);
    if (change === "oversized") assert.match(h.state.metadataError, /10 MB/);
    else assert.equal(h.state.metadataFilesReady, false);
    pending.resolve(ok());
    await old;
    assert.equal(h.state.previewing, false, change);
    assert.equal(h.fields.title.value, "", change);
    assert.equal(h.state.metadataPreview, null, change);
    assert.deepEqual(h.rights(), before);
  }
});

test("pair changes remove unchanged autofill, preserve manual edits and never modify manual rights", async () => {
  let count = 0;
  const h = harness(async () => ++count === 1 ? ok({ ...metadata, isExplicit: true })
    : { ok: false, json: async () => ({ error: "No spreadsheet row matches this audio file." }) });
  h.selectBoth();
  await h.matchMetadata();
  h.fields.artist.value = "Manually edited performer";
  h.boxes[1].checked = true;
  const before = h.rights();
  h.fields.file.files = [new File(["another synthetic fixture"], "another.mp3")];
  await h.matchMetadata();
  assert.equal(h.fields.title.value, "");
  assert.equal(h.fields.bpm.value, "");
  assert.equal(h.fields.durationSeconds.value, "");
  assert.equal(h.fields.artist.value, "Manually edited performer");
  assert.equal(h.fields.isExplicit.checked, false);
  assert.equal(h.boxes[0].checked, false);
  assert.equal(h.boxes[1].checked, true);
  assert.equal(h.state.metadataPreview, null);
  assert.equal(h.state.previewing, false);
  assert.match(h.state.metadataError, /No spreadsheet row/);
  assert.deepEqual(h.rights(), before);
});

test("actual submit rejects a stale successful preview if the currently selected files differ", async () => {
  const h = harness();
  h.selectBoth();
  await h.matchMetadata();
  h.fields.file.files = [new File(["new synthetic fixture without change event"], "new.mp3")];
  await h.submit(h.submitEvent());
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.uploading, false);
  assert.match(h.state.error, /Match the metadata spreadsheet/);
});

test("failed, malformed and interrupted preview responses finish idle without a matching grant", async () => {
  for (const response of [async () => ({ ok: false, json: async () => ({ error: "The spreadsheet needs Artist and Title columns." }) }),
    async () => ({ ok: true, json: async () => ({ metadata: {} }) }),
    async () => { throw new Error("A connection error occurred."); }]) {
    const h = harness(response);
    h.selectBoth();
    const before = h.rights();
    await h.matchMetadata();
    assert.equal(h.state.previewing, false);
    assert.equal(h.state.metadataPreview, null);
    assert.equal(h.pair.current.matched, false);
    assert.ok(h.state.metadataError);
    assert.equal(h.fields.title.value, "");
    assert.deepEqual(h.rights(), before);
  }
});

test("successful upload sends reviewed fields without the spreadsheet and resets file-pair matching", async () => {
  const h = harness(async (url, options) => {
    if (url.endsWith("/metadata-preview")) return ok();
    assert.equal(url, "/api/admin/catalogue/upload");
    assert.equal(options.body.has("metadataSpreadsheet"), false);
    assert.equal(options.body.get("title"), "Blue Moon");
    assert.equal(options.body.get("rightsHolder"), "Manual rights holder");
    assert.equal(options.body.get("rightsConfirmed"), "on");
    assert.equal(options.body.get("permittedTerritories"), "MT");
    return { ok: true, json: async () => ({ track: { artist: "Zara Larsson", title: "Blue Moon", status: "DRAFT" } }) };
  });
  h.selectBoth();
  await h.matchMetadata();
  await h.submit(h.submitEvent());
  assert.equal(h.calls.length, 2);
  assert.equal(h.state.refreshes, 1);
  assert.equal(h.state.metadataPreview, null);
  assert.equal(h.state.metadataFilesReady, false);
  assert.equal(h.state.previewing, false);
  assert.equal(h.state.uploading, false);
  assert.equal(h.pair.current.matched, false);
  assert.match(h.state.success, /Blue Moon was uploaded as draft/);
});

test("matching button and feedback are beside the file pickers, not below manual rights fields", () => {
  const button = source.indexOf('type="button" onClick={matchMetadata}');
  const title = source.indexOf('name="title" required');
  const rights = source.indexOf('name="rightsHolder" required');
  assert.ok(button > source.indexOf('name="metadataSpreadsheet"') && button < title && button < rights);
  assert.match(source, /disabled=\{uploading \|\| previewing \|\| !metadataFilesReady\}/);
  assert.match(source, /Fill details from CSV/);
  assert.equal((source.match(/Matched spreadsheet row /g) || []).length, 1);
  assert.ok(source.indexOf("{metadataError ?") < title);
  assert.equal((source.match(/onChange=\{matchMetadata\}/g) || []).length, 2);
});
