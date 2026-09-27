import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { verifyEdgeManifest } from "../lib/corrections-edge-manifest.mjs";

const MAGIC = Buffer.from("RVEDGE01", "ascii");
const MAX_ITEM_BYTES = 100 * 1024 * 1024;
const MAX_CONTENT = 500;
const CLOCK_DRIFT_MS = 5 * 60_000;

const hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const edgeContentKey = (item) => `${item.mediaAssetId}:${item.promoVersionId}:${item.sha256}`;

function cacheKey(key) {
  const bytes = Buffer.isBuffer(key) ? key : Buffer.from(String(key || ""), "base64url");
  if (bytes.length !== 32) throw new Error("A separate 256-bit Edge cache key is required.");
  return bytes;
}

function assertSafeRoot(root) {
  const resolved = path.resolve(String(root || ""));
  if (!root || resolved === path.parse(resolved).root || resolved.length < path.parse(resolved).root.length + 12) {
    throw new Error("Choose a dedicated Edge cache directory, not a filesystem root.");
  }
  return resolved;
}

export function encryptEdgeMedia(bytes, key, contentKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cacheKey(key), iv);
  cipher.setAAD(Buffer.from(contentKey, "utf8"));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptEdgeMedia(blob, key, contentKey) {
  if (blob.length < MAGIC.length + 12 + 16 || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Corrupt Edge media header.");
  }
  const iv = blob.subarray(8, 20);
  const tag = blob.subarray(20, 36);
  const decipher = createDecipheriv("aes-256-gcm", cacheKey(key), iv);
  decipher.setAAD(Buffer.from(contentKey, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(36)), decipher.final()]);
}

export class CorrectionsEdgeCache {
  constructor({ root, key, publicKeyPem, scope, fetchMedia, now = () => new Date() }) {
    this.root = assertSafeRoot(root);
    this.key = cacheKey(key);
    if (!publicKeyPem || !scope?.nodeId || !scope.organisationId || !scope.facilityId || typeof fetchMedia !== "function") {
      throw new Error("An Edge trust anchor, fixed scope and protected media fetcher are required.");
    }
    this.publicKeyPem = publicKeyPem;
    this.scope = scope;
    this.fetchMedia = fetchMedia;
    this.now = now;
    this.monotonicBase = process.hrtime.bigint();
    this.trustedBaseMs = 0;
    this.lastClockPersistMs = 0;
    this.active = null;
    this.cacheRevision = 0;
  }

  objectPath(item) { return path.join(this.root, "objects", `${hex(edgeContentKey(item))}.edge`); }
  async initialise() {
    await mkdir(path.join(this.root, "objects"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.root, "quarantine"), { recursive: true, mode: 0o700 });
    const clock = await this.readClock();
    this.trustedBaseMs = clock?.time || 0;
    this.lastClockPersistMs = this.trustedBaseMs;
    this.monotonicBase = process.hrtime.bigint();
    try { this.active = JSON.parse(await readFile(path.join(this.root, "active.json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (this.active && !verifyEdgeManifest(this.active, this.publicKeyPem, this.scope,
      { now: this.trustedNow(), lastSequence: this.active.payload.sequence - 1 })) {
      this.active = null;
      throw new Error("The active Edge manifest is invalid or expired.");
    }
    return this.active;
  }

  trustedNow() {
    const wall = new Date(this.now()).getTime();
    const elapsed = Number(process.hrtime.bigint() - this.monotonicBase) / 1e6;
    if (this.trustedBaseMs && wall < this.trustedBaseMs - CLOCK_DRIFT_MS) {
      throw new Error("The Edge clock moved behind the last trusted cloud time.");
    }
    return new Date(Math.max(wall, this.trustedBaseMs + Math.max(0, elapsed)));
  }

  async readClock() {
    try {
      const record = JSON.parse(await readFile(path.join(this.root, "clock.json"), "utf8"));
      const expected = createHmac("sha256", this.key).update(String(record.time)).digest("hex");
      if (!Number.isSafeInteger(record.time) || !/^[a-f0-9]{64}$/.test(record.mac) ||
          !timingSafeEqual(Buffer.from(record.mac, "hex"), Buffer.from(expected, "hex"))) {
        throw new Error("Edge trusted clock record failed integrity verification.");
      }
      return record;
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async saveClock(time) {
    const record = { time, mac: createHmac("sha256", this.key).update(String(time)).digest("hex") };
    const temporary = path.join(this.root, `clock-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    await rename(temporary, path.join(this.root, "clock.json"));
  }

  async validMedia(item) {
    try {
      const bytes = decryptEdgeMedia(await readFile(this.objectPath(item)), this.key, edgeContentKey(item));
      return bytes.length === item.sizeBytes && hex(bytes) === item.sha256;
    } catch { return false; }
  }

  async fetchAndStage(item) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.sizeBytes) ||
        item.sizeBytes < 1 || item.sizeBytes > MAX_ITEM_BYTES || item.rightsUse !== "CORRECTIONS_RADIO") {
      throw new Error("Invalid protected Edge content entry.");
    }
    if (await this.validMedia(item)) return "reused";
    let bytes;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        bytes = await this.fetchMedia(item);
        if (!Buffer.isBuffer(bytes) || bytes.length !== item.sizeBytes || hex(bytes) !== item.sha256) {
          throw new Error("Protected media checksum or size mismatch.");
        }
        break;
      } catch (error) { if (attempt === 2) throw error; }
    }
    const temporary = path.join(this.root, "objects", `${randomUUID()}.tmp`);
    await writeFile(temporary, encryptEdgeMedia(bytes, this.key, edgeContentKey(item)), { mode: 0o600, flag: "wx" });
    try { await rename(this.objectPath(item), path.join(this.root, "quarantine", `${randomUUID()}.edge`)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await rename(temporary, this.objectPath(item));
    return "downloaded";
  }

  async sync(envelope) {
    const now = this.trustedNow();
    const priorSequence = this.active?.payload.sequence || 0;
    const sameVersion = this.active?.version === envelope?.version;
    if (!verifyEdgeManifest(envelope, this.publicKeyPem, this.scope,
      { now, lastSequence: sameVersion ? priorSequence - 1 : priorSequence })) {
      throw new Error("Edge manifest signature, scope, version, clock or sequence was rejected.");
    }
    const payload = envelope.payload;
    if (payload.content.length > MAX_CONTENT || !payload.windows.every((window) =>
      window.facilityId === this.scope.facilityId && payload.content.some((item) => edgeContentKey(item) === window.contentKey)) ||
      !payload.overrides.every((override) => override.facilityId === this.scope.facilityId &&
        payload.content.some((item) => edgeContentKey(item) === override.contentKey)) ||
      payload.zones.some((zone) => !zone.id || !Array.isArray(zone.playerIds))) {
      throw new Error("Edge manifest contains invalid facility content references.");
    }
    let downloaded = 0;
    let reused = 0;
    for (const item of payload.content) {
      const result = await this.fetchAndStage(item);
      if (result === "reused") reused += 1; else downloaded += 1;
    }
    if (sameVersion) {
      if (downloaded) this.cacheRevision += 1;
      return { unchanged: downloaded === 0, downloaded, reused, sequence: payload.sequence };
    }
    // Media is fully checked before the active pointer changes. A failed
    // download leaves the prior signed manifest and its objects intact.
    const temporary = path.join(this.root, `manifest-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600, flag: "wx" });
    await rename(temporary, path.join(this.root, "active.json"));
    this.active = envelope;
    this.cacheRevision += 1;
    this.trustedBaseMs = Math.max(this.trustedBaseMs, Date.parse(payload.issuedAt));
    this.monotonicBase = process.hrtime.bigint();
    await this.saveClock(this.trustedBaseMs);
    this.lastClockPersistMs = this.trustedBaseMs;
    await this.evictUnlisted();
    return { unchanged: false, downloaded, reused, sequence: payload.sequence };
  }

  async evictUnlisted() {
    if (!this.active) return;
    const keep = new Set(this.active.payload.content.map((item) => path.basename(this.objectPath(item))));
    for (const name of await readdir(path.join(this.root, "objects"))) {
      if (!/^[a-f0-9]{64}\.edge$/.test(name) || keep.has(name)) continue;
      await unlink(path.join(this.root, "objects", name));
    }
  }

  async readMedia(contentKey) {
    const now = this.trustedNow();
    if (!this.active || new Date(this.active.payload.validUntil) <= now) {
      throw new Error("Edge offline authorisation expired; playback is suspended.");
    }
    if (now.getTime() > this.lastClockPersistMs + 60_000) {
      await this.saveClock(now.getTime());
      this.lastClockPersistMs = now.getTime();
    }
    const item = this.active.payload.content.find((candidate) => edgeContentKey(candidate) === contentKey);
    if (!item) throw new Error("Media is not authorised by the active Edge manifest.");
    try {
      const blob = await readFile(this.objectPath(item));
      const bytes = decryptEdgeMedia(blob, this.key, contentKey);
      if (bytes.length !== item.sizeBytes || hex(bytes) !== item.sha256) throw new Error("Cached content checksum failed.");
      return { bytes, mimeType: item.mimeType };
    } catch (error) {
      try { await rename(this.objectPath(item), path.join(this.root, "quarantine", `${randomUUID()}.edge`)); }
      catch { /* Preserve original failure; a missing file is already unusable. */ }
      throw new Error(`Protected Edge media is unavailable: ${error.message}`);
    }
  }
}
