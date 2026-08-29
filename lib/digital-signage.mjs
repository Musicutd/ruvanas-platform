const ORIENTATIONS = new Set(["LANDSCAPE", "PORTRAIT", "SQUARE", "CUSTOM"]);
const FIT_MODES = new Set(["COVER", "CONTAIN", "STRETCH"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REGIONS = 12;

function clean(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return parsed;
}

export function digitalSignageOrientation(width, height) {
  if (width === height) return "SQUARE";
  return width > height ? "LANDSCAPE" : "PORTRAIT";
}

export function normaliseDigitalSignageDevice(input = {}) {
  const organisationId = clean(input.organisationId, 100);
  const zoneId = clean(input.zoneId, 100);
  const name = clean(input.name);
  const viewportWidth = integer(input.viewportWidth, "Viewport width", { min: 320, max: 8192 });
  const viewportHeight = integer(input.viewportHeight, "Viewport height", { min: 240, max: 8192 });
  const orientation = clean(input.orientation || digitalSignageOrientation(viewportWidth, viewportHeight), 20).toUpperCase();

  if (!organisationId || !zoneId || !name) {
    throw new Error("Organisation, zone, and device name are required.");
  }
  if (!ORIENTATIONS.has(orientation)) throw new Error("Choose a valid display orientation.");

  return { organisationId, zoneId, name, viewportWidth, viewportHeight, orientation };
}

export function normaliseDigitalSignageLayout(input = {}) {
  const organisationId = clean(input.organisationId, 100);
  const name = clean(input.name);
  const description = clean(input.description, 1000) || null;
  const canvasWidth = integer(input.canvasWidth, "Canvas width", { min: 320, max: 8192 });
  const canvasHeight = integer(input.canvasHeight, "Canvas height", { min: 240, max: 8192 });
  const orientation = clean(input.orientation || digitalSignageOrientation(canvasWidth, canvasHeight), 20).toUpperCase();
  const backgroundColor = clean(input.backgroundColor || "#000000", 7).toUpperCase();
  const rawRegions = Array.isArray(input.regions) ? input.regions : [];

  if (!organisationId || !name) throw new Error("Organisation and layout name are required.");
  if (!ORIENTATIONS.has(orientation)) throw new Error("Choose a valid layout orientation.");
  if (!/^#[0-9A-F]{6}$/.test(backgroundColor)) throw new Error("Background colour must use six-digit hex format.");
  if (rawRegions.length < 1 || rawRegions.length > MAX_REGIONS) {
    throw new Error(`A layout must contain between 1 and ${MAX_REGIONS} regions.`);
  }

  const names = new Set();
  const regions = rawRegions.map((region, index) => {
    const regionName = clean(region.name || `Region ${index + 1}`, 100);
    const x = integer(region.x, `Region ${index + 1} x`, { min: 0, max: canvasWidth - 1 });
    const y = integer(region.y, `Region ${index + 1} y`, { min: 0, max: canvasHeight - 1 });
    const width = integer(region.width, `Region ${index + 1} width`, { min: 1, max: canvasWidth });
    const height = integer(region.height, `Region ${index + 1} height`, { min: 1, max: canvasHeight });
    const zIndex = integer(region.zIndex ?? index, `Region ${index + 1} layer`, { min: 0, max: 100 });
    const fitMode = clean(region.fitMode || "COVER", 12).toUpperCase();

    if (!regionName) throw new Error("Every region needs a name.");
    if (names.has(regionName.toLowerCase())) throw new Error("Region names must be unique within a layout.");
    if (x + width > canvasWidth || y + height > canvasHeight) {
      throw new Error(`${regionName} must remain inside the layout canvas.`);
    }
    if (!FIT_MODES.has(fitMode)) throw new Error(`${regionName} has an invalid fit mode.`);
    names.add(regionName.toLowerCase());
    return { name: regionName, x, y, width, height, zIndex, fitMode };
  });

  return { organisationId, name, description, canvasWidth, canvasHeight, orientation, backgroundColor, regions };
}

function pngDimensions(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), extension: "png", mimeType: "image/png" };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if (startOfFrame.has(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), extension: "jpg", mimeType: "image/jpeg" };
    }
    offset += 2 + length;
  }
  return null;
}

export function validateDigitalSignageImage({ buffer, fileName = "", claimedType = "" } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, error: "Choose an image before uploading." };
  if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, error: "The image exceeds the 15 MB upload limit." };

  const detected = pngDimensions(buffer) || jpegDimensions(buffer);
  if (!detected) return { ok: false, error: "Only valid PNG and JPEG images are accepted in this stage." };

  const normalizedType = String(claimedType || "").split(";", 1)[0].toLowerCase();
  if (normalizedType && ![detected.mimeType, "image/jpg"].includes(normalizedType)) {
    return { ok: false, error: "The file content does not match its reported image type." };
  }
  const extension = String(fileName).split(".").pop()?.toLowerCase();
  if (extension && ![detected.extension, detected.extension === "jpg" ? "jpeg" : detected.extension].includes(extension)) {
    return { ok: false, error: "The file extension does not match the image content." };
  }
  if (detected.width < 64 || detected.height < 64 || detected.width > 8192 || detected.height > 8192) {
    return { ok: false, error: "Image dimensions must be between 64 and 8192 pixels per side." };
  }
  if (detected.width * detected.height > 33_554_432) {
    return { ok: false, error: "The image contains too many pixels for safe display processing." };
  }

  return { ok: true, ...detected, sizeBytes: buffer.length, kind: "IMAGE" };
}
