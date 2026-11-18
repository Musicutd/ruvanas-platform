// An organisation-owned spot is deliberately separate from catalogue music.
// This validates identity only; the caller must hold a fresh owner approval.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG } from "./retail-subscriber-access.mjs";

const fail = code => Object.assign(new Error(code), { code });
const MIME = { mp3: ["audio/mpeg", "audio/mp3"], wav: ["audio/wav", "audio/x-wav"], ogg: ["audio/ogg"], m4a: ["audio/mp4", "audio/x-m4a"] };
export function retailCommercialMediaIdentity(asset) {
  const prefix = `organisations/${ORG}/`, key = asset?.storageKey;
  const relative = typeof key === "string" && key.startsWith(prefix) ? key.slice(prefix.length) : "";
  const match = relative.match(/^(?:promos\/(?:commercial|jingle|announcement|voiceover)|studio\/[A-Za-z0-9_-]{1,191}\/[a-z_]{1,40})\/([A-Za-z0-9_-]{1,191})\.(mp3|wav|ogg|m4a)$/);
  const sizeBytes = Number(asset?.sizeBytes), checksum = asset?.checksumSha256;
  if (asset?.organisationId !== ORG || asset.libraryType !== "ORGANISATION_PROMO" || asset.status !== "READY" ||
      !["COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"].includes(asset.mediaType) || !match ||
      !/^[a-f0-9]{64}$/.test(checksum || "") || !MIME[match[2]].includes(asset.mimeType) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 50 * 1024 * 1024 ||
      relative.startsWith("promos/") && match[1] !== checksum) throw fail("RETAIL_COMMERCIAL_MEDIA_IDENTITY_INVALID");
  return { checksum, extension: match[2], sizeBytes };
}

export async function downloadRetailCommercialMedia(body, filePath, asset, { signal }) {
  const identity = retailCommercialMediaIdentity(asset), digest = createHash("sha256"); let bytes = 0;
  signal.throwIfAborted();
  const checked = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > identity.sizeBytes) return callback(fail("RETAIL_COMMERCIAL_MEDIA_SIZE_MISMATCH"));
    digest.update(chunk); callback(null, chunk);
  } });
  await pipeline(body, checked, createWriteStream(filePath, { flags: "wx", mode: 0o600 }), { signal });
  if (bytes !== identity.sizeBytes || digest.digest("hex") !== identity.checksum) throw fail("RETAIL_COMMERCIAL_MEDIA_CHECKSUM_MISMATCH");
  return bytes;
}
