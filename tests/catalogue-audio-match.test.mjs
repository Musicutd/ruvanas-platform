import assert from "node:assert/strict";
import test from "node:test";
import { catalogueAudioFileCandidates } from "../lib/catalogue-audio-match.mjs";
import { matchManifestRowsToAudio } from "../lib/catalogue-bulk-import.mjs";
import { selectSingleCatalogueRow } from "../lib/catalogue-single-metadata.mjs";

const file = (fileName) => ({ fileName, baseName: fileName.replace(/\\/g, "/").split("/").at(-1) });
const row = (requestedFile, extra = {}) => ({ requestedFile, sheetRow: 2, artist: "Artist", title: "Song", errors: [], ...extra });

test("bulk explicit filenames never collapse different non-Latin names", () => {
  const [matched] = matchManifestRowsToAudio([row("你好.mp3")], [file("再見.mp3")]);
  assert.equal(matched.file, null);
  assert.match(matched.errors.join(" "), /No matching audio/);
});

test("single metadata matches an exact non-Latin filename", () => {
  const expected = row("你好.mp3", { artist: "歌手", title: "你好" });
  assert.equal(selectSingleCatalogueRow([expected], "你好.mp3").row, expected);
});

test("explicit full path disambiguates duplicate basenames", () => {
  const files = [file("disc1/song.mp3"), file("disc2/song.mp3")];
  assert.deepEqual(catalogueAudioFileCandidates("disc1/song.mp3", files), [files[0]]);
  assert.deepEqual(catalogueAudioFileCandidates("disc2\\song.mp3", files), [files[1]]);
  assert.equal(matchManifestRowsToAudio([row("disc1/song.mp3")], files)[0].file, files[0]);
});

test("basename fallbacks remain ambiguous instead of choosing a folder", () => {
  const files = [file("disc1/song.mp3"), file("disc2/song.mp3")];
  const [matched] = matchManifestRowsToAudio([row("song.mp3")], files);
  assert.equal(matched.file, null);
  assert.match(matched.errors.join(" "), /More than one/);
  assert.match(selectSingleCatalogueRow([row("disc1/song.mp3"), row("disc2/song.mp3")], "song.mp3").error, /More than one/);
});

test("exact extension wins before extensionless compatibility", () => {
  const files = [file("song.wav"), file("song.mp3")];
  assert.deepEqual(catalogueAudioFileCandidates("song.mp3", files), [files[1]]);
  assert.equal(selectSingleCatalogueRow([row("song.wav"), row("song.mp3")], "song.mp3").row.requestedFile, "song.mp3");
});

test("Unicode normalisation and existing punctuation/extension fallbacks work", () => {
  const exact = file("Beyoncé - Song.mp3");
  assert.deepEqual(catalogueAudioFileCandidates("Beyonce\u0301 - Song.mp3", [exact]), [exact]);
  assert.deepEqual(catalogueAudioFileCandidates("Beyonce — Song", [exact]), [exact]);
  const nested = file("music/01 R&B - Song.mp3");
  assert.deepEqual(catalogueAudioFileCandidates("01 R and B - Song.mp3", [nested]), [nested]);
});

test("Unicode artist/title and numbered metadata matching remain supported", () => {
  const expected = row("", { artist: "歌手", title: "你好" });
  const audio = file("歌手 - 你好.mp3");
  assert.equal(matchManifestRowsToAudio([expected], [audio])[0].file, audio);
  assert.equal(selectSingleCatalogueRow([expected], audio.baseName).row, expected);
  assert.equal(matchManifestRowsToAudio([row("", { number: 1 })], [file("01 Artist - Song.mp3")])[0].errors.length, 0);
});

test("compatibility cannot hide an ambiguous match", () => {
  const files = [file("Artist - Song.mp3"), file("Artist — Song.mp3")];
  const [matched] = matchManifestRowsToAudio([row("Artist : Song.mp3")], files);
  assert.equal(matched.file, null);
  assert.match(matched.errors.join(" "), /More than one/);
});

test("a previous row cannot silently resolve an ambiguous later match", () => {
  const files = [file("disc1/song.mp3"), file("disc2/song.mp3")];
  const matched = matchManifestRowsToAudio([row("disc1/song.mp3"), row("song.mp3", { sheetRow: 3 })], files);
  assert.equal(matched[0].file, files[0]);
  assert.equal(matched[1].file, null);
  assert.match(matched[1].errors.join(" "), /More than one/);
  const duplicate = matchManifestRowsToAudio([row("disc1/song.mp3"), row("disc1/song.mp3", { sheetRow: 3 })], files);
  assert.equal(duplicate[1].file, null);
  assert.match(duplicate[1].errors.join(" "), /No matching audio/);
});

for (const [requestedDash, matchingDash] of [["—", "-"], ["-", "—"]]) {
  test(`bulk supplied folder outranks another folder's exact basename (${requestedDash} to ${matchingDash})`, () => {
    const requested = `disc1/Artist ${requestedDash} Song.mp3`;
    const files = [file(`disc1/Artist ${matchingDash} Song.mp3`), file(`disc2/Artist ${requestedDash} Song.mp3`)];
    const [matched] = matchManifestRowsToAudio([row(requested)], files);
    assert.equal(matched.file, files[0]);
    assert.deepEqual(matched.errors, []);
  });

  test(`single matching retains folder specificity in reverse lookup (${requestedDash} to ${matchingDash})`, () => {
    const requested = `disc1/Artist ${requestedDash} Song.mp3`;
    const rows = [row(`disc1/Artist ${matchingDash} Song.mp3`), row(`disc2/Artist ${requestedDash} Song.mp3`, { sheetRow: 3 })];
    assert.equal(selectSingleCatalogueRow(rows, requested).row, rows[0]);
  });
}

test("folder-specific punctuation matching retains the requested extension", () => {
  const files = [file("disc1/Artist - Song.wav"), file("disc1/Artist - Song.mp3"), file("disc2/Artist — Song.mp3")];
  assert.deepEqual(catalogueAudioFileCandidates("disc1/Artist — Song.mp3", files), [files[1]]);
});

test("path compatibility preserves directory segment boundaries", () => {
  const files = [file("disc1-Artist/Song.mp3")];
  assert.deepEqual(catalogueAudioFileCandidates("disc1/Artist-Song.mp3", files), []);
});
