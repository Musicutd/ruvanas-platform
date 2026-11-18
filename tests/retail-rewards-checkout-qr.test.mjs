import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { checkoutQrPayload, parseCheckoutQrPayload, parseCheckoutInput, renderCheckoutQr } from "../lib/retail-rewards/checkout-qr.mjs";

const TOKEN = "0123456789abcdef".repeat(4);
test("QR envelope is versioned, non-URL and contains only the existing short-lived token", () => {
  assert.equal(checkoutQrPayload(TOKEN), `RUVANAS-REWARDS:1:${TOKEN}`);
  assert.equal(parseCheckoutQrPayload(checkoutQrPayload(TOKEN)), TOKEN);
  for (const token of [null, TOKEN.toUpperCase(), ` ${TOKEN}`, `${TOKEN}\n`, "claim-id", "a".repeat(63)]) assert.throws(() => checkoutQrPayload(token));
});
test("scans reject URLs, raw codes, wrong versions, case changes, extra fields and unbounded input", () => {
  const qr = checkoutQrPayload(TOKEN);
  for (const input of [null, {}, TOKEN, `https://example.invalid/${qr}`, `javascript:${qr}`, ` ${qr}`, `${qr}\n`,
    qr.replace(":1:", ":2:"), qr.toLowerCase(), qr.toUpperCase(), `${qr}:shop-one`, `${qr}\u0000`, `${qr}\u200b`, "x".repeat(100000)])
    assert.equal(parseCheckoutQrPayload(input), null);
});
test("manual entry alone accepts outer whitespace and raw codes; it never repairs case or embedded whitespace", () => {
  assert.equal(parseCheckoutInput(` \n${TOKEN}\t `), TOKEN);
  assert.equal(parseCheckoutInput(` \n${checkoutQrPayload(TOKEN)}\t `), TOKEN);
  for (const value of [TOKEN.toUpperCase(), TOKEN.slice(0, 32) + " " + TOKEN.slice(32), `https://example.invalid/#${TOKEN}`, {}, " ".repeat(600) + TOKEN])
    assert.equal(parseCheckoutInput(value), null);
});
test("actual QR rendering independently decodes to the exact accepted payload without external services", async () => {
  for (const token of [TOKEN, "0".repeat(64), "f".repeat(64), "a17b3d9e".repeat(8)]) {
    let image;
    const context = { createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      clearRect() {}, putImageData(value) { image = value; } };
    const canvas = { width: 0, height: 0, style: {}, getContext: () => context };
    await renderCheckoutQr(canvas, token);
    assert.equal(canvas.width, 256); assert.equal(canvas.height, 256); assert.equal(image.data.length, 256 * 256 * 4);
    const decoded = jsQR(image.data, 256, 256, { inversionAttempts: "dontInvert" });
    assert.equal(decoded?.data, checkoutQrPayload(token)); assert.equal(parseCheckoutQrPayload(decoded.data), token);
    // The four-module quiet zone is white and high contrast, independent of theme.
    assert.deepEqual(Array.from(image.data.slice(0, 4)), [255, 255, 255, 255]);
    assert.ok(image.data.some((value, index) => index % 4 !== 3 && value === 0));
  }
});
test("bad render input fails with a generic message before writing to a canvas", async () => {
  let contexts = 0;
  await assert.rejects(renderCheckoutQr({ getContext: () => { contexts++; } }, "secret-invalid-value"), error => !error.message.includes("secret-invalid-value"));
  assert.equal(contexts, 0);
});
