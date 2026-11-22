import test from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { categoryPalette, displayVoucherNumber, verifiedCardCode, voucherQrMatrix } from "../lib/retail-rewards/vivid-voucher-ui.mjs";

test("vivid palettes map existing category keys without changing stored categories", () => {
  assert.equal(categoryPalette("RESTAURANTS"), "dining");
  assert.equal(categoryPalette("ELECTRONICS"), "tech");
  assert.equal(categoryPalette("coffee"), "coffee");
  assert.equal(categoryPalette("HEALTH"), "wellness");
  assert.equal(categoryPalette("unknown"), "tech");
  assert.equal(displayVoucherNumber("RUV 8842 9104"), "RUV · 8842 · 9104");
  assert.equal(displayVoucherNumber("RVS • 8842 • 9104"), "RVS · 8842 · 9104");
  assert.equal(displayVoucherNumber("<script>"), "RUV · VOUCHER");
  assert.equal(displayVoucherNumber(""), "RUV · VOUCHER");
});

test("the sample QR is deterministic and decodes to the explicit demo payload", () => {
  const payload = "RUVANAS-DEMO:dining-01";
  const matrix = voucherQrMatrix(payload, { previewOnly: true });
  assert.deepEqual(matrix, voucherQrMatrix(payload, { previewOnly: true }));
  const scale = 6, width = matrix.size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const match of matrix.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x = Number(match[1]), y = Number(match[2]);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const at = ((y * scale + dy) * width + x * scale + dx) * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
    }
  }
  assert.equal(jsQR(pixels, width, width)?.data, payload);
  assert.equal(voucherQrMatrix(payload), null);
  assert.equal(voucherQrMatrix("https://example.com", { previewOnly: true }), null);
});

test("live QR display requires a matching explicit credential and unexpired time", () => {
  const token = "ab".repeat(32), payload = `RUVANAS-REWARDS:1:${token}`;
  const now = Date.parse("2026-11-22T12:00:00.000Z"), future = "2026-11-22T12:05:00.000Z";
  const card = { code: token, qrPayload: payload, credentialExpiresAt: future };
  assert.equal(verifiedCardCode(card, { now }), token);
  assert.ok(voucherQrMatrix(payload, { now, credentialExpiresAt: future }));
  assert.equal(verifiedCardCode({ ...card, code: "cd".repeat(32) }, { now }), null);
  assert.equal(verifiedCardCode({ ...card, credentialExpiresAt: "2026-11-22T12:00:00.000Z" }, { now }), null);
  assert.equal(verifiedCardCode(card, { previewOnly: true, now }), null);
  assert.equal(voucherQrMatrix(payload, { now }), null);
  assert.equal(voucherQrMatrix(payload, { now, credentialExpiresAt: "invalid" }), null);
  assert.equal(verifiedCardCode({ qrPayload: "RUVANAS-DEMO:one", code: "DEMO10" }, { previewOnly: true }), "DEMO10");
});
