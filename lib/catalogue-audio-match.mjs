import { decodeSpreadsheetText } from "./catalogue-genre-identity.mjs";

// Audio identity must retain letters from every writing system. The genre key
// deliberately has different compatibility rules and must not identify files.
export function catalogueAudioLookupKey(value) {
  return decodeSpreadsheetText(value).normalize("NFKD").toLowerCase()
    .replace(/\p{M}/gu, "").replace(/\band\b/g, "&")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function catalogueAudioPath(value) {
  return decodeSpreadsheetText(value).normalize("NFC").replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "").toLowerCase();
}

export const catalogueAudioBaseName = (value) => catalogueAudioPath(value).split("/").at(-1) || "";
export const catalogueAudioStem = (value) => String(value || "").replace(/\.[^./\\]+$/, "");
const compatibilityPath = (value) => catalogueAudioPath(value).split("/").map(catalogueAudioLookupKey).join("/");

// Return the first nonempty specificity level, even if ambiguous. Never let a
// looser fallback silently select an arbitrary file from an ambiguous match.
export function catalogueAudioFileCandidates(requestedFile, files) {
  const requested = catalogueAudioPath(requestedFile);
  if (!requested) return [];
  const base = catalogueAudioBaseName(requested);
  const fullLevels = [
    [requested, (file) => catalogueAudioPath(file.fileName)],
    [compatibilityPath(requested), (file) => compatibilityPath(file.fileName)],
    [catalogueAudioStem(requested), (file) => catalogueAudioStem(catalogueAudioPath(file.fileName))],
    [compatibilityPath(catalogueAudioStem(requested)), (file) => compatibilityPath(catalogueAudioStem(file.fileName))]
  ];
  const baseLevels = [
    [base, (file) => catalogueAudioBaseName(file.baseName || file.fileName)],
    [catalogueAudioLookupKey(base), (file) => catalogueAudioLookupKey(file.baseName || catalogueAudioBaseName(file.fileName))],
    [catalogueAudioStem(base), (file) => catalogueAudioStem(catalogueAudioBaseName(file.baseName || file.fileName))],
    [catalogueAudioLookupKey(catalogueAudioStem(base)), (file) => catalogueAudioLookupKey(catalogueAudioStem(file.baseName || catalogueAudioBaseName(file.fileName)))]
  ];
  // A supplied folder remains authoritative across punctuation/accent
  // compatibility. Do not jump to another folder's exact basename first.
  // Without a folder, retain extension-specific matches before stem fallbacks.
  const levels = requested.includes("/") ? [...fullLevels, ...baseLevels] :
    fullLevels.flatMap((level, index) => [level, baseLevels[index]]);
  for (const [wanted, identity] of levels) {
    if (!wanted) continue;
    const matches = files.filter((file) => identity(file) === wanted);
    if (matches.length) return matches;
  }
  return [];
}
