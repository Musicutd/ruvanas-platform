import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  digitalSignageOrientation,
  normaliseDigitalSignageEnrolmentCode,
  normaliseDigitalSignageDevice,
  normaliseDigitalSignageLayout,
  validateDigitalSignageImage,
  validateDigitalSignageVideo
} from "../lib/digital-signage.mjs";

test("display enrolment accepts either a code or the copied confirmation sentence", () => {
  const code = "A".repeat(43);
  assert.equal(normaliseDigitalSignageEnrolmentCode(code), code);
  assert.equal(normaliseDigitalSignageEnrolmentCode(`Device created. One-time enrolment code: ${code}`), code);
  assert.equal(normaliseDigitalSignageEnrolmentCode(""), "");
});

test("the Digital Signage interface separates tasks and makes display enrolment explicit", async () => {
  const consoleSource = await readFile(new URL("../app/admin/digital-signage/DigitalSignageConsole.js", import.meta.url), "utf8");
  const displaySource = await readFile(new URL("../app/signage/page.js", import.meta.url), "utf8");
  for (const label of ["Displays", "Visuals & layouts", "Playlists", "Takeovers", "Copy code", "Open display screen"]) {
    assert.ok(consoleSource.includes(label));
  }
  assert.match(displaySource, /TV or display screen, not an audio player/);
  assert.match(consoleSource, /showOrganisationSelector \|\| subscriberTheme === "light" \? lightStyles : darkStyles/);
  assert.match(consoleSource, /useSubscriberTheme/);
  assert.match(consoleSource, /const darkStyles =/);
  assert.match(consoleSource, /background: "radial-gradient\([^\n]+#101827"/);
});

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

test("video uploads are signature checked and size bounded before protected processing", () => {
  const mp4 = Buffer.alloc(24); mp4.write("ftyp", 4, "ascii");
  assert.equal(validateDigitalSignageVideo({ buffer: mp4, fileName: "campaign.mp4", claimedType: "video/mp4" }).ok, true);
  assert.match(validateDigitalSignageVideo({ buffer: mp4, fileName: "campaign.webm", claimedType: "video/webm" }).error, /reported video type/);
  assert.match(validateDigitalSignageVideo({ buffer: Buffer.from("not-video"), fileName: "campaign.mp4", claimedType: "video/mp4" }).error, /valid MP4 and WebM/);
});
