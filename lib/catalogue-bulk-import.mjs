import path from "node:path";
import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { z } from "zod";
import { MAX_CATALOGUE_FILE_SIZE_BYTES, parseCatalogueMetadata } from "./catalogue-upload.mjs";

export const MAX_CATALOGUE_ARCHIVE_SIZE_BYTES = 150 * 1024 * 1024;
export const MAX_CATALOGUE_MANIFEST_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_CATALOGUE_BATCH_TRACKS = 100;
export const MAX_CATALOGUE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

export class CatalogueBulkImportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CatalogueBulkImportError";
    this.status = status;
  }
}

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a"]);
const HEADER_ALIASES = Object.freeze({
  number: ["#", "no", "number", "track no", "track number"],
  file: ["file", "filename", "file name", "audio", "audio file", "music file"],
  artist: ["artist", "performer"],
  title: ["title", "track title", "song", "song title"],
  mixName: ["mix", "mix name", "version", "edit"],
  duration: ["time", "duration", "length"],
  bpm: ["bpm", "tempo"],
  genre: ["genre", "genres"],
  explicit: ["content warning", "explicit", "explicit content", "warning"],
  album: ["album", "release"],
  releaseYear: ["year", "release year"]
});

const checkbox = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean()
);

const batchSettingsSchema = z.object({
  rightsHolder: z.string().trim().min(1).max(200),
  rightsReference: z.string().trim().min(1).max(500),
  permittedTerritories: z.string().trim().min(1).max(500),
  licenceExpiresAt: z.string().trim().regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Enter a valid licence expiry date."),
  rightsConfirmed: checkbox.refine(Boolean, "Confirm that Ruvanas is authorised to store and use this batch."),
  publishNow: checkbox,
  licensedCatalogue: checkbox,
  permittedUses: z.array(z.enum(["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO", "HEALTH_RADIO", "FAITH_RADIO", "ORGANISATIONS_RADIO"])).min(1, "Choose at least one Ruvanas service permitted by the licence.")
});

export function decodeSpreadsheetText(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

const lookupKey = (value) => decodeSpreadsheetText(value).toLowerCase().replace(/\band\b/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
const compactKey = (value) => lookupKey(value).replace(/\s+/g, "");
const stripExtension = (value) => value.replace(/\.[^.]+$/, "");

export function parseCatalogueBatchSettings(input) {
  const parsed = batchSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Enter valid batch rights information." };
  const date = parsed.data.licenceExpiresAt;
  if (date) {
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      return { ok: false, error: "Enter a real licence expiry date." };
    }
  }
  return { ok: true, data: { ...parsed.data, permittedUses: [...new Set(parsed.data.permittedUses)] } };
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new CatalogueBulkImportError("The CSV has an unclosed quoted value.");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function excelCellValue(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return value.result ?? "";
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
    if ("text" in value) return value.text || "";
  }
  return value;
}

function validateXlsxEnvelope(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) { reject(new CatalogueBulkImportError("The XLSX spreadsheet could not be read.")); return; }
      let entries = 0;
      let uncompressedBytes = 0;
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch {}
        reject(new CatalogueBulkImportError(message));
      };
      zip.on("error", () => fail("The XLSX spreadsheet is damaged or incomplete."));
      zip.on("entry", (entry) => {
        entries += 1;
        uncompressedBytes += entry.uncompressedSize;
        if (entries > 250 || uncompressedBytes > 50 * 1024 * 1024) { fail("The XLSX spreadsheet is too large after extraction."); return; }
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) { fail("Password-protected XLSX spreadsheets are not supported."); return; }
        zip.readEntry();
      });
      zip.on("end", () => { if (!settled) { settled = true; resolve(); } });
      zip.readEntry();
    });
  });
}

async function spreadsheetRows(buffer, fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".csv") return csvRows(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  if (extension !== ".xlsx") throw new CatalogueBulkImportError("Use a CSV or XLSX spreadsheet for the catalogue manifest.");
  await validateXlsxEnvelope(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new CatalogueBulkImportError("The XLSX spreadsheet could not be read. Save it again as XLSX or CSV and retry.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new CatalogueBulkImportError("The spreadsheet does not contain a worksheet.");
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let column = 1; column <= row.cellCount; column += 1) values.push(excelCellValue(row.getCell(column)));
    rows.push(values);
  });
  return rows;
}

function headerIdentity(value) {
  return decodeSpreadsheetText(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function mapHeaders(row) {
  const headers = row.map(headerIdentity);
  const result = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = headers.findIndex((header) => aliases.includes(header));
    if (index >= 0) result[field] = index;
  }
  return result;
}

function parseDuration(value) {
  if (value instanceof Date) return value.getUTCHours() * 3600 + value.getUTCMinutes() * 60 + value.getUTCSeconds();
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0 && value < 1) return Math.round(value * 86400);
    if (Number.isInteger(value) && value >= 1) return value;
  }
  const text = decodeSpreadsheetText(value);
  if (!text) return null;
  if (/^\d+(?::\d{1,2}){1,2}$/.test(text)) {
    const parts = text.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part)) || parts.slice(1).some((part) => part > 59)) return Number.NaN;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  const numeric = Number(text);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : Number.NaN;
}

function parseOptionalInteger(value) {
  const text = decodeSpreadsheetText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isInteger(number) ? number : Number.NaN;
}

function explicitValue(value) {
  const text = lookupKey(value);
  if (!text || ["clean", "no", "none", "false", "0"].includes(text)) return false;
  return true;
}

function createGenreIndex(genres) {
  const exact = new Map();
  for (const genre of genres) {
    for (const value of [genre.name, genre.slug]) {
      const key = lookupKey(value);
      if (key) exact.set(key, genre);
      const compact = compactKey(value);
      if (compact) exact.set(compact, genre);
    }
    if (/^r\s*&?\s*b$/i.test(genre.name) || compactKey(genre.name) === "rb") {
      for (const alias of ["r&b", "r and b", "rnb", "rhythm and blues"]) exact.set(compactKey(alias), genre);
    }
  }
  return { exact, genres };
}

function resolveGenres(value, index, { allowNewGenres = false } = {}) {
  const source = decodeSpreadsheetText(value);
  if (!source) return { genreIds: [], genreNames: [], newGenreNames: [], notes: [] };
  const selected = new Map();
  const newGenreNames = new Map();
  const notes = [];
  for (const part of source.split(/[;,|]+/).map((item) => item.trim()).filter(Boolean)) {
    const exact = index.exact.get(lookupKey(part)) || index.exact.get(compactKey(part));
    if (exact) { selected.set(exact.id, exact); continue; }
    if (allowNewGenres) {
      if (part.length > 120 || !lookupKey(part)) return { error: `Genre “${part}” is not a valid genre name.` };
      newGenreNames.set(lookupKey(part), part);
      continue;
    }
    const phrase = ` ${lookupKey(part)} `;
    const partial = index.genres.filter((genre) => {
      const key = lookupKey(genre.name || genre.slug);
      return key && phrase.includes(` ${key} `);
    });
    if (!partial.length) return { error: `Genre “${part}” does not match an active catalogue genre.` };
    for (const genre of partial) selected.set(genre.id, genre);
    notes.push(`Mapped “${part}” to ${partial.map((genre) => genre.name).join(" + ")}.`);
  }
  if (selected.size + newGenreNames.size > 10) return { error: "Select no more than 10 genres per track." };
  return { genreIds: [...selected.keys()], genreNames: [...selected.values()].map((genre) => genre.name), newGenreNames: [...newGenreNames.values()], notes };
}

export async function parseCatalogueManifest({ buffer, fileName, genres, allowNewGenres = false }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new CatalogueBulkImportError("Choose a catalogue spreadsheet.");
  if (buffer.length > MAX_CATALOGUE_MANIFEST_SIZE_BYTES) throw new CatalogueBulkImportError("The spreadsheet exceeds the 10 MB limit.", 413);
  const rawRows = await spreadsheetRows(buffer, fileName);
  const headerRowIndex = rawRows.findIndex((row, index) => index < 10 && row.some((cell) => ["artist", "title", "song title"].includes(headerIdentity(cell))));
  if (headerRowIndex < 0) throw new CatalogueBulkImportError("The spreadsheet needs Artist and Title column headings.");
  const headers = mapHeaders(rawRows[headerRowIndex]);
  if (headers.artist == null || headers.title == null) throw new CatalogueBulkImportError("The spreadsheet needs Artist and Title columns.");
  const genreIndex = createGenreIndex(genres);
  const rows = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rawRows.length; rowIndex += 1) {
    const source = rawRows[rowIndex];
    if (!source.some((value) => decodeSpreadsheetText(value))) continue;
    const artist = decodeSpreadsheetText(source[headers.artist]);
    const title = decodeSpreadsheetText(source[headers.title]);
    const row = {
      sheetRow: rowIndex + 1,
      number: headers.number == null ? null : parseOptionalInteger(source[headers.number]),
      requestedFile: headers.file == null ? "" : decodeSpreadsheetText(source[headers.file]),
      artist,
      title,
      mixName: headers.mixName == null ? null : decodeSpreadsheetText(source[headers.mixName]) || null,
      durationSeconds: headers.duration == null ? null : parseDuration(source[headers.duration]),
      bpm: headers.bpm == null ? null : parseOptionalInteger(source[headers.bpm]),
      genreSource: headers.genre == null ? "" : decodeSpreadsheetText(source[headers.genre]),
      isExplicit: headers.explicit == null ? false : explicitValue(source[headers.explicit]),
      album: headers.album == null ? null : decodeSpreadsheetText(source[headers.album]) || null,
      releaseYear: headers.releaseYear == null ? null : parseOptionalInteger(source[headers.releaseYear])
    };
    row.errors = [];
    if (!artist) row.errors.push("Artist is required.");
    if (!title) row.errors.push("Title is required.");
    if (Number.isNaN(row.number)) row.errors.push("Track number must be a whole number.");
    if (Number.isNaN(row.durationSeconds) || (row.durationSeconds != null && (row.durationSeconds < 1 || row.durationSeconds > 86400))) row.errors.push("Time must be seconds, m:ss or h:mm:ss.");
    if (Number.isNaN(row.bpm) || (row.bpm != null && (row.bpm < 20 || row.bpm > 300))) row.errors.push("BPM must be a whole number from 20 to 300.");
    if (Number.isNaN(row.releaseYear) || (row.releaseYear != null && (row.releaseYear < 1877 || row.releaseYear > 2200))) row.errors.push("Release year must be between 1877 and 2200.");
    const resolvedGenres = resolveGenres(row.genreSource, genreIndex, { allowNewGenres });
    if (resolvedGenres.error) row.errors.push(resolvedGenres.error);
    row.genreIds = resolvedGenres.genreIds || [];
    row.genreNames = resolvedGenres.genreNames || [];
    row.newGenreNames = resolvedGenres.newGenreNames || [];
    row.notes = resolvedGenres.notes || [];
    rows.push(row);
  }
  if (!rows.length) throw new CatalogueBulkImportError("The spreadsheet does not contain any track rows.");
  if (rows.length > MAX_CATALOGUE_BATCH_TRACKS) throw new CatalogueBulkImportError(`Import no more than ${MAX_CATALOGUE_BATCH_TRACKS} tracks in one batch.`);
  return rows;
}

function readZipEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) { reject(error); return; }
      const chunks = [];
      let size = 0;
      stream.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_CATALOGUE_FILE_SIZE_BYTES) stream.destroy(new CatalogueBulkImportError(`${entry.fileName} exceeds the 50 MB per-track limit.`, 413));
        else chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

export function extractCatalogueArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return Promise.reject(new CatalogueBulkImportError("Choose a ZIP file containing the music."));
  if (buffer.length > MAX_CATALOGUE_ARCHIVE_SIZE_BYTES) return Promise.reject(new CatalogueBulkImportError("The ZIP file exceeds the 150 MB batch limit.", 413));
  if (buffer.subarray(0, 2).toString("binary") !== "PK") return Promise.reject(new CatalogueBulkImportError("The music archive is not a valid ZIP file."));
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (openError, zip) => {
      if (openError) { reject(new CatalogueBulkImportError("The music archive could not be read as a ZIP file.")); return; }
      const files = [];
      let totalUncompressed = 0;
      let entriesSeen = 0;
      let settled = false;
      const fail = (error) => { if (!settled) { settled = true; try { zip.close(); } catch {} reject(error); } };
      zip.on("error", () => fail(new CatalogueBulkImportError("The music archive is damaged or incomplete.")));
      zip.on("entry", async (entry) => {
        try {
          entriesSeen += 1;
          if (entriesSeen > 500) throw new CatalogueBulkImportError("The ZIP contains too many entries.");
          if (/\/$/.test(entry.fileName) || /(^|\/)__MACOSX\//.test(entry.fileName) || /(^|\/)\.[^/]+/.test(entry.fileName)) { zip.readEntry(); return; }
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new CatalogueBulkImportError("Password-protected ZIP entries are not supported.");
          const extension = path.extname(entry.fileName).slice(1).toLowerCase();
          if (!AUDIO_EXTENSIONS.has(extension)) { zip.readEntry(); return; }
          if (entry.uncompressedSize > MAX_CATALOGUE_FILE_SIZE_BYTES) throw new CatalogueBulkImportError(`${entry.fileName} exceeds the 50 MB per-track limit.`, 413);
          totalUncompressed += entry.uncompressedSize;
          if (totalUncompressed > MAX_CATALOGUE_UNCOMPRESSED_BYTES) throw new CatalogueBulkImportError("The uncompressed music exceeds the 200 MB batch safety limit.", 413);
          if (files.length >= MAX_CATALOGUE_BATCH_TRACKS) throw new CatalogueBulkImportError(`Import no more than ${MAX_CATALOGUE_BATCH_TRACKS} tracks in one batch.`);
          const data = await readZipEntry(zip, entry);
          files.push({ fileName: entry.fileName, baseName: path.posix.basename(entry.fileName), buffer: data });
          zip.readEntry();
        } catch (error) {
          fail(error instanceof CatalogueBulkImportError ? error : new CatalogueBulkImportError(`The ZIP entry ${entry.fileName} could not be read.`));
        }
      });
      zip.on("end", () => {
        if (settled) return;
        settled = true;
        if (!files.length) reject(new CatalogueBulkImportError("The ZIP does not contain MP3, WAV, OGG or M4A files."));
        else resolve(files);
      });
      zip.readEntry();
    });
  });
}

function matchCandidates(row, files) {
  if (row.requestedFile) {
    const requested = lookupKey(row.requestedFile);
    const requestedBase = lookupKey(path.posix.basename(row.requestedFile));
    return files.filter((file) => lookupKey(file.fileName) === requested || lookupKey(file.baseName) === requestedBase || lookupKey(stripExtension(file.baseName)) === lookupKey(stripExtension(row.requestedFile)));
  }
  if (Number.isInteger(row.number) && row.number >= 0) {
    const numberPattern = new RegExp(`^0*${row.number}(?:[^0-9]|$)`);
    const numbered = files.filter((file) => numberPattern.test(stripExtension(file.baseName)));
    if (numbered.length) return numbered;
  }
  const artist = lookupKey(row.artist);
  const title = lookupKey(row.title);
  const both = files.filter((file) => {
    const name = lookupKey(stripExtension(file.baseName));
    return artist && title && name.includes(artist) && name.includes(title);
  });
  if (both.length) return both;
  return files.filter((file) => lookupKey(stripExtension(file.baseName)) === title);
}

export function matchManifestRowsToAudio(rows, files) {
  const used = new Set();
  return rows.map((row) => {
    const candidates = matchCandidates(row, files).filter((file) => !used.has(file.fileName));
    const errors = [...row.errors];
    let file = null;
    if (candidates.length === 1) { file = candidates[0]; used.add(file.fileName); }
    else if (candidates.length === 0) errors.push("No matching audio file was found in the ZIP. Add a File column or rename the audio to include the row number or artist and title.");
    else errors.push(`More than one audio file matches this row: ${candidates.map((item) => item.baseName).join(", ")}. Add a File column.`);
    return { ...row, file, errors };
  });
}

export function metadataForBulkRow(row, settings) {
  return parseCatalogueMetadata({
    title: row.title,
    artist: row.artist,
    album: row.album,
    mixName: row.mixName,
    bpm: row.bpm,
    releaseYear: row.releaseYear,
    durationSeconds: row.durationSeconds,
    isExplicit: row.isExplicit,
    rightsHolder: settings.rightsHolder,
    rightsReference: settings.rightsReference,
    permittedTerritories: settings.permittedTerritories,
    licenceExpiresAt: settings.licenceExpiresAt,
    rightsConfirmed: settings.rightsConfirmed,
    publishNow: settings.publishNow,
    licensedCatalogue: settings.licensedCatalogue,
    permittedUses: settings.permittedUses,
    genreIds: row.genreIds
  });
}
