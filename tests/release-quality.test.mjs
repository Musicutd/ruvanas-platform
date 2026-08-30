import assert from "node:assert/strict";
import test from "node:test";
import { acceptableRedirect, inspectRepositoryText, validateMediaToolVersion } from "../lib/release-quality.mjs";

test("static integrity detects unresolved merge markers and formatting residue", () => {
  const marker = "<".repeat(7) + " HEAD";
  const separator = "=".repeat(7);
  const text = ["const ready = true;", marker, separator, "value" + " ", ""].join("\n");
  assert.deepEqual(inspectRepositoryText("fixture.js", text), [
    { path: "fixture.js", line: 2, code: "MERGE_CONFLICT_MARKER" },
    { path: "fixture.js", line: 3, code: "MERGE_CONFLICT_MARKER" },
    { path: "fixture.js", line: 4, code: "TRAILING_WHITESPACE" }
  ]);
});

test("static integrity requires a final newline", () => {
  assert.deepEqual(inspectRepositoryText("fixture.md", "complete"), [
    { path: "fixture.md", line: 1, code: "MISSING_FINAL_NEWLINE" }
  ]);
});

test("media version output must identify the expected executable", () => {
  assert.equal(validateMediaToolVersion("ffmpeg", "ffmpeg version 7.0-static\nconfiguration"), "ffmpeg version 7.0-static");
  assert.throws(() => validateMediaToolVersion("ffprobe", "unexpected output"), /recognised version string/);
});

test("protected pages accept only an explicit login redirect", () => {
  assert.equal(acceptableRedirect(307, "/login"), true);
  assert.equal(acceptableRedirect(302, "/login?next=%2Fdashboard"), true);
  assert.equal(acceptableRedirect(200, "/login"), false);
  assert.equal(acceptableRedirect(307, "https://attacker.example/login"), false);
});
