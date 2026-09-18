import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { spawn, spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../lib/crypto.js";
import { resolveEntitlements } from "../lib/entitlements.mjs";
import { isPrivateNetworkAddress } from "../lib/stream-source-health.mjs";
import { eligibleOnlineRadioRotation, liquidsoapScript, rotationFingerprint } from "../lib/online-radio-output.mjs";

const stationId = String(process.env.RUVANAS_AUTODJ_STATION_ID || "");
if (!/^c[a-z0-9]{10,40}$/i.test(stationId)) throw new Error("RUVANAS_AUTODJ_STATION_ID must identify one Online Radio station.");
for (const name of ["DATABASE_URL", "SECRET_ENCRYPTION_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
  if (!process.env[name]) throw new Error(`Encoder worker requires ${name}.`);
}
const encoderBinary = process.env.LIQUIDSOAP_BIN || "liquidsoap";
if (spawnSync(encoderBinary, ["--version"], { stdio: "ignore", windowsHide: true, timeout: 10_000 }).status !== 0) {
  throw new Error("The encoder worker requires a working Liquidsoap executable with MP3 output support.");
}

const prisma = new PrismaClient();
const storage = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const owner = `${String(process.env.RENDER_INSTANCE_ID || hostname()).slice(0, 70)}-${process.pid}`;
const scanMs = 15_000;
const leaseMs = 45_000;
let stopping = false;
let running = null;
let lastWaitingReason = null;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; if (running?.child && running.child.exitCode === null) running.child.kill("SIGTERM"); });

function event(name, details = {}) {
  console.log(JSON.stringify({ service: "ONLINE_RADIO_ENCODER", event: name, stationId, ...details }));
}

async function stopOutput() {
  const current = running;
  if (!current) return;
  running = null;
  if (current.child.exitCode === null) {
    current.child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => current.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 8_000))
    ]);
    if (current.child.exitCode === null) current.child.kill("SIGKILL");
  }
  await rm(current.directory, { recursive: true, force: true });
  event("encoder_stopped");
}

async function readRotation() {
  const modeInclude = {
    tracks: { include: {
      track: { include: {
        mediaAsset: { include: { genres: { include: { mediaGenre: true } } } }
      } }
    } }
  };
  const station = await prisma.station.findUnique({
    where: { id: stationId },
    include: {
      streamConfig: true,
      organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } },
      channels: {
        where: { status: "ACTIVE" },
        include: { autoDjPolicy: { include: {
          defaultMusicMode: { include: modeInclude },
          backupMusicMode: { include: modeInclude }
        } } }
      }
    }
  });
  if (!station) return { ready: false, reason: "STATION_NOT_FOUND" };
  const entitlements = resolveEntitlements(station.organisation.subscription);
  const genres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 250 });
  const rotation = eligibleOnlineRadioRotation(station, entitlements, new Date(), genres);
  if (!rotation.ready) return rotation;
  const bitrateKbps = station.streamConfig.bitrateKbps || Math.min(128, station.maxBitrateKbps, entitlements.maxBitrateKbps || 128);
  if (bitrateKbps > station.maxBitrateKbps || bitrateKbps > (entitlements.maxBitrateKbps || 0)) return { ready: false, reason: "BITRATE_NOT_ALLOWED" };
  return { ...rotation, bitrateKbps, fingerprint: rotationFingerprint(rotation) };
}

async function claimLease() {
  const now = new Date();
  const result = await prisma.stationStreamConfig.updateMany({
    where: { stationId, outboundAutoDjEnabled: true, OR: [{ encoderLeaseOwner: owner }, { encoderLeaseUntil: null }, { encoderLeaseUntil: { lt: now } }] },
    data: { encoderLeaseOwner: owner, encoderLeaseUntil: new Date(now.getTime() + leaseMs) }
  });
  return result.count === 1;
}

async function releaseLease() {
  await prisma.stationStreamConfig.updateMany({ where: { stationId, encoderLeaseOwner: owner }, data: { encoderLeaseOwner: null, encoderLeaseUntil: null } });
}

async function publicSourceAddress(host) {
  if (!/^[a-z0-9.-]{1,253}$/i.test(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Invalid public source host.");
  const addresses = await lookup(host, { all: true, family: 4, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) throw new Error("The source host must resolve only to public addresses.");
  return addresses[0].address;
}

async function downloadRotation(rotation, directory) {
  const paths = [];
  let bytes = 0;
  for (const [index, entry] of rotation.entries.entries()) {
    const asset = entry.track.mediaAsset;
    bytes += Number(asset.sizeBytes);
    if (!Number.isSafeInteger(bytes) || bytes > 1024 * 1024 * 1024) throw new Error("The selected rotation exceeds the one-gigabyte encoder cache limit.");
    const extension = path.extname(asset.storageKey).toLowerCase();
    if (![".mp3", ".aac", ".m4a", ".wav", ".flac", ".ogg"].includes(extension)) throw new Error("A selected track uses an unsupported audio format.");
    const filePath = path.join(directory, `${String(index).padStart(3, "0")}${extension}`);
    const object = await storage.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: asset.storageKey }));
    if (!object.Body || typeof object.Body.pipe !== "function") throw new Error("Protected storage did not return an audio stream.");
    await pipeline(object.Body, createWriteStream(filePath, { flags: "wx", mode: 0o600 }));
    paths.push(filePath);
  }
  if (!paths.length) throw new Error("The rotation has no eligible tracks.");
  return paths;
}

async function startOutput(rotation) {
  const address = await publicSourceAddress(rotation.station.streamConfig.serverHost);
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-online-radio-"));
  try {
    const files = await downloadRotation(rotation, directory);
    const latest = await readRotation();
    if (!latest.ready || latest.fingerprint !== rotation.fingerprint || stopping) throw new Error("The approved rotation changed while preparing audio.");
    const playlistPath = path.join(directory, "rotation.m3u");
    const scriptPath = path.join(directory, "source.liq");
    await writeFile(playlistPath, `${files.join("\n")}\n`, { mode: 0o600 });
    const source = rotation.station.streamConfig;
    await writeFile(scriptPath, liquidsoapScript({ playlistPath, host: address, port: source.sourcePort, username: source.sourceUsername, password: decryptSecret(source.sourcePasswordEncrypted), bitrateKbps: rotation.bitrateKbps, stationName: rotation.station.name }), { mode: 0o600 });
    await chmod(scriptPath, 0o600);
    const child = spawn(encoderBinary, [scriptPath], { cwd: directory, windowsHide: true, stdio: "ignore" });
    running = { child, directory, fingerprint: rotation.fingerprint, failed: false };
    child.once("error", () => { if (running?.child === child) running.failed = true; event("encoder_process_error"); });
    child.once("exit", (code) => { if (running?.child === child) running.failed = true; if (!stopping) event("encoder_process_exited", { code }); });
    event("encoder_spawn_attempted", { tracks: files.length, bitrateKbps: rotation.bitrateKbps });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

event("worker_ready");
try {
  while (!stopping) {
    try {
      const rotation = await readRotation();
      if (!rotation.ready) {
        await stopOutput();
        if (lastWaitingReason !== rotation.reason) event("waiting_for_configuration", { reason: rotation.reason });
        lastWaitingReason = rotation.reason;
      } else if (!await claimLease()) {
        await stopOutput();
        if (lastWaitingReason !== "ENCODER_LEASE_BUSY") event("waiting_for_encoder_lease");
        lastWaitingReason = "ENCODER_LEASE_BUSY";
      } else if (!running || running.failed || running.child.exitCode !== null || running.fingerprint !== rotation.fingerprint) {
        lastWaitingReason = null;
        await stopOutput();
        if (!stopping) await startOutput(rotation);
      } else {
        lastWaitingReason = null;
      }
    } catch (error) {
      await stopOutput();
      event("encoder_scan_failed", { code: String(error?.code || error?.name || "UNKNOWN").slice(0, 80) });
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, scanMs));
  }
} finally {
  await stopOutput();
  await releaseLease().catch(() => undefined);
  await prisma.$disconnect();
  storage.destroy();
}
