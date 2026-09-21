import path from "node:path";
import { decodeSpreadsheetText } from "./catalogue-bulk-import.mjs";

const key = (value) => decodeSpreadsheetText(value).toLowerCase().replace(/\band\b/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
const stem = (value) => path.basename(String(value || "").replace(/\\/g, "/")).replace(/\.[^.]+$/, "");

export function selectSingleCatalogueRow(rows, audioFileName) {
  const audioName = key(stem(audioFileName));
  if (!audioName) return { ok: false, error: "Choose the music file before matching the spreadsheet." };

  const explicit = rows.filter((row) => row.requestedFile && key(stem(row.requestedFile)) === audioName);
  let matched = explicit;
  if (!matched.length) {
    matched = rows.filter((row) => {
      if (row.requestedFile) return false;
      const artist = key(row.artist);
      const title = key(row.title);
      return artist && title && audioName.includes(artist) && audioName.includes(title);
    });
  }
  if (!matched.length) matched = rows.filter((row) => !row.requestedFile && key(row.title) && audioName === key(row.title));
  if (!matched.length) matched = rows.filter((row) => !row.requestedFile && Number.isInteger(row.number) && new RegExp(`^0*${row.number}(?: |$)`).test(audioName));
  if (!matched.length && rows.length === 1 && !rows[0].requestedFile) matched = rows;
  if (!matched.length) return { ok: false, error: "No spreadsheet row matches this audio file. Add a File column with its exact filename, or include artist and title in the filename." };
  if (matched.length > 1) return { ok: false, error: "More than one spreadsheet row matches this audio file. Add a File column to identify it exactly." };
  const row = matched[0];
  if (row.errors.length) return { ok: false, error: `Spreadsheet row ${row.sheetRow}: ${row.errors.join(" ")}` };
  return { ok: true, row };
}

export function parseNewCatalogueGenreNames(value, existingCount = 0) {
  let names;
  try { names = JSON.parse(String(value || "[]")); }
  catch { return { ok: false, error: "The new genres could not be read. Match the spreadsheet again." }; }
  if (!Array.isArray(names)) return { ok: false, error: "The new genres could not be read. Match the spreadsheet again." };
  const normalized = new Map();
  for (const name of names) {
    if (typeof name !== "string") return { ok: false, error: "A genre name is invalid." };
    const display = decodeSpreadsheetText(name).replace(/\s+/g, " ");
    if (!display || display.length > 120 || !key(display)) return { ok: false, error: "A genre name must be 1–120 readable characters." };
    normalized.set(key(display), display);
  }
  if (normalized.size !== names.length || normalized.size + existingCount > 10) {
    return { ok: false, error: "Select no more than 10 different genres per track." };
  }
  return { ok: true, names: [...normalized.values()] };
}
