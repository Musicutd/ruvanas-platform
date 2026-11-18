import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseCatalogueManifest } from "../lib/catalogue-bulk-import.mjs";
import { selectSingleCatalogueRow } from "../lib/catalogue-single-metadata.mjs";

async function csvRow(header, value) {
  const [row] = await parseCatalogueManifest({
    buffer: Buffer.from(`Artist,Title,${header}\nSynthetic,Example,${value}\n`),
    fileName: "synthetic.csv", genres: []
  });
  return row;
}

test("explicit seconds headers are recognized rather than silently dropped", async () => {
  for (const header of ["DurationSeconds", "duration_seconds", "Duration (seconds)", "DURATION SECONDS", "duration-seconds"]) {
    const row = await csvRow(header, "167");
    assert.equal(row.durationSeconds, 167, header);
    assert.deepEqual(row.errors, [], header);
    assert.equal(selectSingleCatalogueRow([row], "Synthetic - Example.mp3").row.durationSeconds, 167);
  }
});

test("explicit seconds preserve correct numeric values without clock or fractional-day guessing", async () => {
  for (const seconds of [1, 138, 146, 167, 179, 182, 192, 3723, 86400]) {
    const row = await csvRow("DurationSeconds", String(seconds));
    assert.equal(row.durationSeconds, seconds);
    assert.deepEqual(row.errors, []);
  }
  const blank = await csvRow("DurationSeconds", "");
  assert.equal(blank.durationSeconds, null);
  assert.deepEqual(blank.errors, []);
  for (const value of ["2:47", "2:47:00", "0:02:47", "0.5", "167.5", "-1", "0", "86401", "Infinity", "unknown"]) {
    const row = await csvRow("duration_seconds", value);
    assert.match(row.errors.join(" "), /Duration \(seconds\) must be a whole number from 1 to 86400\./, value);
    assert.equal(selectSingleCatalogueRow([row], "Synthetic - Example.mp3").ok, false, value);
  }
});

test("explicit seconds take precedence over generic clocks in either column order without fallback", async () => {
  for (const [headers, values] of [
    ["Time,DurationSeconds", "2:47:00,167"], ["Duration (seconds),Time", "167,2:47:00"],
    ["Duration,DurationSeconds", "invalid,167"]
  ]) {
    const row = await csvRow(headers, values);
    assert.equal(row.durationSeconds, 167);
    assert.deepEqual(row.errors, []);
  }
  const invalid = await csvRow("Time,DurationSeconds", "2:47,invalid");
  assert.ok(Number.isNaN(invalid.durationSeconds));
  assert.match(invalid.errors.join(" "), /Duration \(seconds\)/);
  const blank = await csvRow("Time,DurationSeconds", "2:47,");
  assert.equal(blank.durationSeconds, null, "an explicitly blank seconds column does not acquire a clock interpretation");
});

test("multiple explicit seconds columns fail closed instead of discarding a competing value", async () => {
  await assert.rejects(() => csvRow("DurationSeconds,duration_seconds", "167,10020"),
    /Use only one explicit duration-in-seconds column/);
});

test("generic duration formats retain legitimate h:mm:ss and do not reinterpret coercion-shaped clocks", async () => {
  for (const [value, expected] of [["167", 167], ["2:47", 167], ["0:02:47", 167], ["1:02:03", 3723],
    ["2:47:00", 10020], ["2:18:00", 8280], ["2:59:00", 10740], ["2:26:00", 8760]]) {
    for (const header of ["Time", "Duration", "Length"]) {
      const row = await csvRow(header, value);
      assert.equal(row.durationSeconds, expected, `${header}: ${value}`);
      assert.deepEqual(row.errors, []);
    }
  }
  for (const value of ["2:60", "1:02:60", "0:00", "24:00:01"]) {
    assert.match((await csvRow("Time", value)).errors.join(" "), /Time must be seconds, m:ss or h:mm:ss/);
  }
});

async function xlsxRows(header, values) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Synthetic catalogue");
  sheet.addRow(["Artist", "Title", header]);
  for (const [index, value] of values.entries()) sheet.addRow(["Synthetic", `Example ${index}`, value]);
  return parseCatalogueManifest({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), fileName: "synthetic.xlsx", genres: [] });
}

test("XLSX seconds and formula results are unit-aware; generic serial/date clocks stay unchanged", async () => {
  const seconds = await xlsxRows("Duration (seconds)", [167, { formula: "160+7", result: 167 }, 167 / 86400,
    new Date("1899-12-30T00:02:47.000Z")]);
  assert.deepEqual(seconds.slice(0, 2).map(row => row.durationSeconds), [167, 167]);
  assert.ok(seconds.slice(0, 2).every(row => row.errors.length === 0));
  assert.ok(seconds.slice(2).every(row => row.errors.some(error => error.includes("Duration (seconds)"))));
  const clocks = await xlsxRows("Time", [167 / 86400, new Date("1899-12-30T00:02:47.000Z"),
    { formula: "167/86400", result: 167 / 86400 }, new Date("1899-12-30T02:47:00.000Z")]);
  assert.deepEqual(clocks.map(row => row.durationSeconds), [167, 167, 167, 10020]);
  assert.ok(clocks.every(row => row.errors.length === 0));
});
