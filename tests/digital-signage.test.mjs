import test from "node:test";
import assert from "node:assert/strict";

import {
  digitalSignageOrientation,
  normaliseDigitalSignageDevice,
  normaliseDigitalSignageLayout,
  validateDigitalSignageImage
} from "../lib/digital-signage.mjs";

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("digital signage device input is tenant- and zone-scoped", () => {
  assert.deepEqual(normaliseDigitalSignageDevice({
    organisationId: "org_1",
    zoneId: "zone_1",
    name: "Entrance display",
    viewportWidth: 1920,
    viewportHeight: 1080
  }), {
    organisationId: "org_1",
    zoneId: "zone_1",
    name: "Entrance display",
    viewportWidth: 1920,
    viewportHeight: 1080,
    orientation: "LANDSCAPE"
  });
  assert.throws(() => normaliseDigitalSignageDevice({ organisationId: "org_1", name: "No zone", viewportWidth: 1920, viewportHeight: 1080 }), /zone/);
});

test("layout regions must remain inside the canvas", () => {
  const layout = normaliseDigitalSignageLayout({
    organisationId: "org_1",
    name: "Full-screen landscape",
    canvasWidth: 1920,
    canvasHeight: 1080,
    backgroundColor: "#112233",
    regions: [{ name: "Main", x: 0, y: 0, width: 1920, height: 1080, fitMode: "cover" }]
  });
  assert.equal(layout.orientation, "LANDSCAPE");
  assert.equal(layout.regions[0].fitMode, "COVER");
  assert.throws(() => normaliseDigitalSignageLayout({
    organisationId: "org_1",
    name: "Overflow",
    canvasWidth: 1920,
    canvasHeight: 1080,
    regions: [{ name: "Main", x: 1800, y: 0, width: 200, height: 1080 }]
  }), /inside/);
});

test("layout region names are unique", () => {
  assert.throws(() => normaliseDigitalSignageLayout({
    organisationId: "org_1",
    name: "Duplicate regions",
    canvasWidth: 1000,
    canvasHeight: 1000,
    regions: [
      { name: "Hero", x: 0, y: 0, width: 500, height: 1000 },
      { name: "hero", x: 500, y: 0, width: 500, height: 1000 }
    ]
  }), /unique/);
});

test("visual upload validation trusts file signatures rather than extensions", () => {
  const valid = validateDigitalSignageImage({ buffer: pngHeader(1920, 1080), fileName: "campaign.png", claimedType: "image/png" });
  assert.equal(valid.ok, true);
  assert.equal(valid.width, 1920);
  assert.equal(valid.height, 1080);

  const disguised = validateDigitalSignageImage({ buffer: Buffer.from("not really an image"), fileName: "campaign.png", claimedType: "image/png" });
  assert.equal(disguised.ok, false);
  assert.match(disguised.error, /valid PNG and JPEG/);
});

test("orientation is derived consistently", () => {
  assert.equal(digitalSignageOrientation(1080, 1920), "PORTRAIT");
  assert.equal(digitalSignageOrientation(1080, 1080), "SQUARE");
});
