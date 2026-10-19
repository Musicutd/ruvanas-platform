import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSpreadsheetText } from "../lib/catalogue-genre-identity.mjs";

test("out-of-range numeric spreadsheet entities do not crash metadata parsing", () => {
  for (const entity of ["&#1114112;", "&#x110000;", "&#999999999999999999999999999999999999999999;"] ) {
    assert.equal(decodeSpreadsheetText(`Artist ${entity}`), "Artist \uFFFD");
  }
});

test("numeric spreadsheet entities reject null and surrogate code points", () => {
  for (const entity of ["&#0;", "&#x0;", "&#55296;", "&#xDFFF;"]) {
    assert.equal(decodeSpreadsheetText(`Title ${entity}`), "Title \uFFFD");
  }
});

test("valid scalar entities and ordinary spreadsheet escaping remain supported", () => {
  assert.equal(decodeSpreadsheetText(" R&amp;B &#38; Pop "), "R&B & Pop");
  assert.equal(decodeSpreadsheetText("Music &#x1F3B5; &#127925;"), "Music \u{1F3B5} \u{1F3B5}");
  assert.equal(decodeSpreadsheetText("&#65;&#x42;&#67; &quot;mix&quot;"), 'ABC "mix"');
  assert.equal(decodeSpreadsheetText(null), "");
});
