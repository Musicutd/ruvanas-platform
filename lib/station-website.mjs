import crypto from "node:crypto";

export const STATION_WEBSITE_THEMES = Object.freeze(["MIDNIGHT", "LIGHT", "VIBRANT"]);
export const STATION_DOMAIN_CHALLENGE_PREFIX = "ruvanas-verification=";

function cleanText(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function optionalHttpsUrl(value, label) {
  const cleaned = cleanText(value, 2_048);
  if (!cleaned) return null;
  let parsed;
  try { parsed = new URL(cleaned); }
  catch { throw new Error(`${label} must be a valid web address.`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`${label} must use a public HTTPS address without embedded credentials.`);
  return parsed.toString();
}

export function normalizeStationWebsiteSettings(input = {}) {
  const headline = cleanText(input.headline, 160);
  const about = cleanText(input.about, 3_000);
  const contactEmail = cleanText(input.contactEmail, 254).toLowerCase();
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) throw new Error("Enter a valid public contact email address.");
  const theme = String(input.theme || "MIDNIGHT").trim().toUpperCase();
  if (!STATION_WEBSITE_THEMES.includes(theme)) throw new Error("Choose a supported station website theme.");
  const links = (Array.isArray(input.links) ? input.links : []).slice(0, 6).map((item, index) => {
    const label = cleanText(item?.label, 40);
    const url = optionalHttpsUrl(item?.url, `Website link ${index + 1}`);
    if (!label || !url) throw new Error(`Website link ${index + 1} needs a label and HTTPS address.`);
    return { label, url };
  });
  return {
    enabled: input.enabled === true,
    headline: headline || null,
    about: about || null,
    heroImageUrl: optionalHttpsUrl(input.heroImageUrl, "The hero image"),
    contactEmail: contactEmail || null,
    theme,
    links,
    showNowPlaying: input.showNowPlaying !== false,
    showPodcasts: input.showPodcasts !== false
  };
}

export function normalizeStationDomain(value) {
  const input = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!input || input.length > 253 || input.includes(":") || input.includes("/") || input.includes("@")) throw new Error("Enter a hostname such as radio.example.com.");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input)) throw new Error("Enter a valid public hostname.");
  if (input === "onrender.com" || input.endsWith(".onrender.com") || input === "ruvanas.com" || input.endsWith(".ruvanas.com")) throw new Error("Choose a domain owned by your organisation, not a Ruvanas service domain.");
  return input;
}

export function createStationDomainVerificationToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function stationDomainDnsName(hostname) {
  return `_ruvanas-radio.${normalizeStationDomain(hostname)}`;
}

export function stationDomainDnsValue(token) {
  return `${STATION_DOMAIN_CHALLENGE_PREFIX}${String(token || "").trim()}`;
}

export function stationDomainTxtVerified(records, token) {
  const expected = stationDomainDnsValue(token);
  return (records || []).some((record) => (Array.isArray(record) ? record.join("") : String(record || "")).trim() === expected);
}

export function publicStationWebsitePath(slug) {
  return `/radio/${encodeURIComponent(String(slug || ""))}`;
}
