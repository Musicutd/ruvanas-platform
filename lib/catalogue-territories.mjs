// This is a product preset, not a statement about any supplier's licence.
// The precise countries in a signed agreement must be reviewed before approval.
export const EUROPE_PRESET_COUNTRIES = Object.freeze([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH"
]);

export const CATALOGUE_TERRITORY_PRESETS = Object.freeze([
  { code: "EUROPE", label: "Europe (EU/EEA, UK and Switzerland)" },
  { code: "US", label: "United States of America" },
  { code: "CA", label: "Canada" }
]);

const EUROPE_SET = new Set(EUROPE_PRESET_COUNTRIES);
const WORLDWIDE = new Set(["WORLDWIDE", "GLOBAL", "ALL", "*"]);

export function normalizeCatalogueTerritory(value) {
  const input = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (["USA", "U.S.A.", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(input)) return "US";
  if (input === "CANADA") return "CA";
  if (input === "EUROPE") return "EUROPE";
  if (WORLDWIDE.has(input)) return "WORLDWIDE";
  if (/^[A-Z]{2}$/.test(input)) return input;
  return null;
}

export function parseCatalogueTerritories(values, { allowWorldwide = true } = {}) {
  const entries = Array.isArray(values) ? values : String(values || "").split(/[,;\n]/);
  const codes = [];
  for (const entry of entries) {
    const code = normalizeCatalogueTerritory(entry);
    if (!code || (!allowWorldwide && code === "WORLDWIDE")) {
      return { ok: false, error: `Use Europe, United States, Canada, a two-letter country code${allowWorldwide ? " or WORLDWIDE only if licensed" : ""}.` };
    }
    if (!codes.includes(code)) codes.push(code);
  }
  if (!codes.length) return { ok: false, error: "Choose at least one contract-approved territory." };
  if (codes.includes("WORLDWIDE") && codes.length > 1) return { ok: false, error: "WORLDWIDE cannot be combined with restricted territories." };
  return { ok: true, codes };
}

export function catalogueTerritoriesFromForm(formData) {
  const selected = formData.getAll("territoryRegions").map(String);
  const extra = String(formData.get("permittedTerritories") || "").split(/[,;\n]/).map((entry) => entry.trim()).filter(Boolean);
  return parseCatalogueTerritories([...selected, ...extra]);
}

export function catalogueTerritoryAllows(permitted, countryCode) {
  const entries = Array.isArray(permitted) ? permitted : String(permitted || "").split(/[,;\n]/);
  const codes = entries.map(normalizeCatalogueTerritory).filter(Boolean);
  if (codes.includes("WORLDWIDE")) return true;
  const country = normalizeCatalogueTerritory(countryCode);
  if (!country || country === "WORLDWIDE" || country === "EUROPE") return false;
  return codes.includes(country) || (codes.includes("EUROPE") && EUROPE_SET.has(country));
}

// Provider metadata can narrow an approved connection scope, never enlarge it.
// An empty Super Admin scope is intentionally not an implicit worldwide grant.
export function limitCatalogueTerritories(provider, approved) {
  const providerCodes = (Array.isArray(provider) ? provider : []).map(normalizeCatalogueTerritory).filter(Boolean);
  const approvedCodes = (Array.isArray(approved) ? approved : []).map(normalizeCatalogueTerritory).filter(Boolean);
  if (!approvedCodes.length) return [];
  if (!providerCodes.length || providerCodes.includes("WORLDWIDE")) return [...new Set(approvedCodes)];
  if (approvedCodes.includes("WORLDWIDE")) return [...new Set(providerCodes)];
  const candidates = [...new Set([...providerCodes, ...approvedCodes, ...EUROPE_PRESET_COUNTRIES])].filter((code) => code !== "EUROPE");
  const intersection = candidates.filter((code) => catalogueTerritoryAllows(providerCodes, code) && catalogueTerritoryAllows(approvedCodes, code));
  if (EUROPE_PRESET_COUNTRIES.every((code) => intersection.includes(code))) {
    return ["EUROPE", ...intersection.filter((code) => !EUROPE_SET.has(code))];
  }
  return intersection;
}

export function catalogueTerritoriesWithinApprovedScope(requested, approved) {
  const requestedCodes = parseCatalogueTerritories(requested);
  if (!requestedCodes.ok) return false;
  const approvedCodes = parseCatalogueTerritories(approved);
  if (!approvedCodes.ok) return false;
  return requestedCodes.codes.every((code) => {
    if (code === "WORLDWIDE") return approvedCodes.codes.includes("WORLDWIDE");
    if (code === "EUROPE") return EUROPE_PRESET_COUNTRIES.every((country) => catalogueTerritoryAllows(approvedCodes.codes, country));
    return catalogueTerritoryAllows(approvedCodes.codes, code);
  });
}
