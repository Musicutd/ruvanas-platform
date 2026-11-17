import QRCode from "qrcode";

const PREFIX = "RUVANAS-REWARDS:1:";
const TOKEN = /^[a-f0-9]{64}$/;

// QR content is deliberately not a URL. No identity, tenant, price, expiry or
// redemption authority is accepted from it; the server validates the bearer code.
export function checkoutQrPayload(token) {
  if (typeof token !== "string" || !TOKEN.test(token)) throw new Error("Invalid checkout code.");
  return `${PREFIX}${token}`;
}
export function parseCheckoutQrPayload(value) {
  if (typeof value !== "string" || value.length !== PREFIX.length + 64 || !value.startsWith(PREFIX)) return null;
  const token = value.slice(PREFIX.length);
  return TOKEN.test(token) ? token : null;
}
export function parseCheckoutInput(value) {
  if (typeof value !== "string" || value.length > 512) return null;
  const trimmed = value.trim();
  return TOKEN.test(trimmed) ? trimmed : parseCheckoutQrPayload(trimmed);
}
export async function renderCheckoutQr(canvas, token) {
  const payload = checkoutQrPayload(token);
  if (!canvas || typeof canvas.getContext !== "function") throw new Error("QR display is unavailable.");
  await QRCode.toCanvas(canvas, [{ data: payload, mode: "byte" }], {
    errorCorrectionLevel: "M", margin: 4, width: 256,
    color: { dark: "#000000ff", light: "#ffffffff" }
  });
}
