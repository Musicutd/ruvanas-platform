import QRCode from "qrcode";
import { parseCheckoutQrPayload } from "./checkout-qr.mjs";

const palettes = Object.freeze({
  DINING: "dining", RESTAURANTS: "dining", TECH: "tech", ELECTRONICS: "tech",
  FASHION: "fashion", COFFEE: "coffee", ENTERTAINMENT: "entertainment", LEISURE: "entertainment",
  WELLNESS: "wellness", HEALTH: "wellness", BEAUTY: "wellness"
});

export function categoryPalette(category) {
  return palettes[String(category || "").toUpperCase()] || "tech";
}

// A visual reference only; it is never a payment card number or checkout token.
export function displayVoucherNumber(value) {
  if (typeof value !== "string" || value.length > 40 || !/^[a-z0-9 .•-]+$/i.test(value)) return "RUV · VOUCHER";
  const compact = value.toUpperCase().replace(/[ .•-]+/g, "");
  const prefixed = compact.match(/^([A-Z]{2,4})(\d{4,16})$/);
  const groups = prefixed ? [prefixed[1], ...prefixed[2].match(/.{1,4}/g)] : compact.match(/.{1,4}/g);
  return groups?.join(" · ") || "RUV · VOUCHER";
}

export function verifiedCardCode(card, { previewOnly = false, now = Date.now() } = {}) {
  if (!card || typeof card.code !== "string") return null;
  if (previewOnly) {
    return /^RUVANAS-DEMO:[a-z0-9:_-]{1,100}$/i.test(card.qrPayload || "") && /^[a-z0-9_-]{1,32}$/i.test(card.code)
      ? card.code : null;
  }
  const token = parseCheckoutQrPayload(card.qrPayload);
  const expiry = Date.parse(card.credentialExpiresAt);
  return token && card.code === token && Number.isFinite(now) && Number.isFinite(expiry) && expiry > now ? token : null;
}

export function voucherQrMatrix(payload, { previewOnly = false, credentialExpiresAt, now = Date.now() } = {}) {
  const sample = previewOnly && /^RUVANAS-DEMO:[a-z0-9:_-]{1,100}$/i.test(payload || "");
  const expiry = Date.parse(credentialExpiresAt);
  const live = !previewOnly && parseCheckoutQrPayload(payload) && Number.isFinite(now) && Number.isFinite(expiry) && expiry > now;
  if (!sample && !live) return null;
  const qr = QRCode.create([{ data: payload, mode: "byte" }], { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (qr.modules.get(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
  }
  return { size: size + 8, path };
}
