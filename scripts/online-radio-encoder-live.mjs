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
import { boundEncoderCache, eligibleOnlineRadioRotation, eligibleScheduledOnlineRotation, liquidsoapScript, rotationFingerprint } from "../lib/online-radio-output.mjs";
import { loadEligibleSubscriberMusic } from "../lib/subscriber-playlist-service.mjs";
import { buildGenreRotation } from "../lib/subscriber-playlists.mjs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { runAccountedRotation } from "../lib/online-radio-accounted-runner.mjs";
import { accountedMediaIdentity, downloadAccountedMedia, connectAccountedSource, sendAccountedTrack } from "../lib/online-radio-accounted-transport.mjs";
import { licensedManualCatalogueDecision } from "../lib/online-radio-catalogue-policy.mjs";
import { createOnlineRadioDeliveryLedger, ONLINE_RADIO_DELIVERY_ACTION, reconcileDeliveryEvents } from "../lib/online-radio-delivery-ledger.mjs";
import { musicTrackEligibility } from "../lib/media-library-pro.mjs";
import { onlineRadioSourceScope } from "../lib/online-radio-output.mjs";
import { assertNoOpenSourceSession, openSourceSession, closeSourceSession } from "../lib/online-radio-source-session.mjs";

// Importing this implementation never starts a worker. Only the explicitly
// approved --serve dispatcher can enter it.
export async function runLiveEncoder() {
if (process.env.RUVANAS_AUTODJ_ALLOW_LIVE !== "true") throw new Error("LIVE_OUTPUT_NOT_APPROVED");
const accountedDelivery = process.env.RUVANAS_AUTODJ_ACCOUNTED_DELIVERY === "true";
const deliveryOptions = { deliveryAccounting: accountedDelivery,
  manualCatalogueOutput: accountedDelivery && process.env.RUVANAS_AUTODJ_MANUAL_CATALOGUE_OUTPUT === "true" };

const stationId = String(process.env.RUVANAS_AUTODJ_STATION_ID || "");
if (!/^c[a-z0-9]{10,40}$/i.test(stationId)) throw new Error("RUVANAS_AUTODJ_STATION_ID must identify one Online Radio station.");
for (const name of ["DATABASE_URL", "SECRET_ENCRYPTION_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
  if (!process.env[name]) throw new Error(`Encoder worker requires ${name}.`);
}
const encoderBinary = process.env.LIQUIDSOAP_BIN || "liquidsoap";
if (!accountedDelivery && spawnSync(encoderBinary, ["--version"], { stdio: "ignore", windowsHide: true, timeout: 10_000 }).status !== 0) {
  throw new Error("The encoder worker requires a working Liquidsoap executable with MP3 output support.");
}

const prisma = new PrismaClient();
if (accountedDelivery) {
  const endpoint = new URL(process.env.R2_ENDPOINT.trim());
  if (endpoint.protocol !== "https:" || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) ||
      endpoint.port || endpoint.username || endpoint.password || !["", "/"].includes(endpoint.pathname) || endpoint.search || endpoint.hash) throw new Error("ENCODER_STORAGE_ENDPOINT_INVALID");
}
const storage = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT.trim(), forcePathStyle: true,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim() } });
const owner = `${String(process.env.RENDER_INSTANCE_ID || hostname()).slice(0, 70)}-${process.pid}`;
const scanMs = 15_000;
const leaseMs = 45_000;
let stopping = false;
let running = null;
let lastWaitingReason = null;
let accountedQuarantined = false;
const onStop = () => { stopping = true; running?.controller?.abort(Object.assign(new Error("SHUTDOWN"), { code: "SHUTDOWN" })); if (running?.child && running.child.exitCode === null) running.child.kill("SIGTERM"); };
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, onStop);

function event(name, details = {}) {
  console.log(JSON.stringify({ service: "ONLINE_RADIO_ENCODER", event: name, stationId, ...details }));
}

async function stopOutput() {
  const current = running;
  if (!current) return;
  if (current.accounted) {
    current.controller.abort(Object.assign(new Error(stopping ? "SHUTDOWN" : "POLICY_CHANGED"), { code: stopping ? "SHUTDOWN" : "POLICY_CHANGED" }));
    const result = await current.task;
    if (result.quarantined) accountedQuarantined = true;
    if (!result.stopConfirmed) throw Object.assign(new Error("ENCODER_STOP_UNCONFIRMED"), { code: "ENCODER_STOP_UNCONFIRMED" });
    running = null;
    event("encoder_stopped", { senderEvidenceOnly: true });
    return;
  }
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
        mediaAsset: { include: { genres: { include: { mediaGenre: true } } } },
        distributorItems: { select: { id: true } }
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
  if (!entitlements.outputEnabled) return { ready: false, reason: "OUTPUT_NOT_PERMITTED" };
  if (accountedQuarantined) return { ready: false, reason: "ENCODER_ACCOUNTED_REVIEW_REQUIRED" };
  if (station.streamConfig?.lastError === "ENCODER_ACCOUNTED_REVIEW_REQUIRED") return { ready: false, reason: "ENCODER_ACCOUNTED_REVIEW_REQUIRED" };
  if (accountedDelivery && (station.channels?.length !== 1 || station.channels[0].organisationId !== station.organisationId ||
      station.channels[0].stationId !== station.id || station.channels[0].musicRightsUse !== "ONLINE_RADIO")) return { ready: false, reason: "CHANNEL_SCOPE_INVALID" };
  const genres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 250 });
  const now = new Date();
  const nonStopChannel = station.channels?.length === 1 ? station.channels[0] : null;
  if (nonStopChannel?.autoDjPolicy?.defaultMusicMode?.slug === `nonstop-${nonStopChannel.id}`) {
    const policy = nonStopChannel.autoDjPolicy;
    const entries = await loadEligibleSubscriberMusic(prisma, { organisationId: station.organisationId, requiredUse: "ONLINE_RADIO", territory: policy.territory, catalogueLevel: entitlements.licensedMusicCatalogueLevel, instant: now, configuredGenres: genres, sourceScopes: Array.isArray(policy.sourceScopes) ? policy.sourceScopes : null });
    const rotation = buildGenreRotation({ entries, genreCodes: Array.isArray(policy.selectedGenreCodes) ? policy.selectedGenreCodes : [], durationMinutes: 90, seed: `${station.id}:${now.toISOString().slice(0, 10)}` });
    policy.defaultMusicMode.tracks = boundEncoderCache(rotation.entries).map((entry, position) => ({ track: entry.track, weight: 100, position }));
  }
  let rotation = eligibleOnlineRadioRotation(station, entitlements, now, genres, deliveryOptions);
  const activeChannel = station.channels?.length === 1 ? station.channels[0] : null;
  let nextEventStartsAt = null;
  if (activeChannel) {
    const playlistEvent = await prisma.subscriberPlaylistEvent.findFirst({
      where: { organisationId: station.organisationId, channelId: activeChannel.id, cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
      include: { smartPlaylist: true }, orderBy: { startsAt: "desc" }
    });
    if (playlistEvent) {
      const entries = await loadEligibleSubscriberMusic(prisma, { organisationId: station.organisationId, requiredUse: "ONLINE_RADIO", territory: activeChannel.autoDjPolicy?.territory || null, catalogueLevel: entitlements.licensedMusicCatalogueLevel, instant: now, configuredGenres: genres, sourceScopes: deliveryOptions.manualCatalogueOutput ? ["SUBSCRIBER_LIBRARY", "RUVANAS_CORE", "LICENSED_CATALOGUE"] : ["SUBSCRIBER_LIBRARY", "RUVANAS_CORE"] });
      const scheduled = eligibleScheduledOnlineRotation(station, entitlements, playlistEvent, entries, now, { ...deliveryOptions, configuredGenres: genres });
      if (scheduled.ready) rotation = scheduled;
      else event("scheduled_playlist_unavailable", { reason: scheduled.reason, playlistEventId: playlistEvent.id });
    } else {
      const nextEvent = await prisma.subscriberPlaylistEvent.findFirst({
        where: { organisationId: station.organisationId, channelId: activeChannel.id, cancelledAt: null, startsAt: { gt: now } },
        select: { startsAt: true }, orderBy: { startsAt: "asc" }
      });
      nextEventStartsAt = nextEvent?.startsAt || null;
    }
  }
  if (!rotation.ready) return { ...rotation, nextEventStartsAt };
  const bitrateKbps = station.streamConfig.bitrateKbps || Math.min(128, station.maxBitrateKbps, entitlements.maxBitrateKbps || 128);
  if (bitrateKbps > station.maxBitrateKbps || bitrateKbps > (entitlements.maxBitrateKbps || 0)) return { ready: false, reason: "BITRATE_NOT_ALLOWED" };
  return { ...rotation, bitrateKbps, fingerprint: rotationFingerprint({ ...rotation, bitrateKbps }), entitlements, configuredGenres: genres, nextEventStartsAt };
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
  if (accountedDelivery) return startAccountedOutput(rotation);
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

async function assertPreviousAccountedRunClosed(rotation) {
  const where = { organisationId: rotation.station.organisationId, entityType: "Station", entityId: stationId,
    action: ONLINE_RADIO_DELIVERY_ACTION, details: { path: ["event", "destinationId"], equals: rotation.station.streamConfig.id } };
  const latest = await prisma.auditLog.findFirst({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { details: true } });
  if (!latest) return;
  const sessionId = latest.details?.event?.sessionId;
  if (typeof sessionId !== "string") throw new Error("ENCODER_ACCOUNTED_REVIEW_REQUIRED");
  const records = await prisma.auditLog.findMany({ where: { ...where, details: { path: ["event", "sessionId"], equals: sessionId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10000, select: { details: true } });
  const phase = { STARTED: 0, AUDIO_SENT: 1, ENDED: 2, INTERRUPTED: 2, FAILED: 2 };
  const events = records.map(row => row.details?.event).sort((a, b) => a.segmentSequence - b.segmentSequence || phase[a.type] - phase[b.type]);
  if (records.length >= 10000 || reconcileDeliveryEvents(events).activeSegment) throw new Error("ENCODER_ACCOUNTED_REVIEW_REQUIRED");
}

async function startAccountedOutput(rotation) {
  const scope = { organisationId: rotation.station.organisationId, stationId, destinationId: rotation.station.streamConfig.id };
  await assertNoOpenSourceSession(prisma, scope);
  await assertPreviousAccountedRunClosed(rotation);
  const controller = new AbortController();
  const source = rotation.station.streamConfig;
  const identity = { ...scope, sessionId: randomUUID() };
  const ledger = createOnlineRadioDeliveryLedger({ prisma, identity });
  const require = createRequire(import.meta.url);
  const ffmpegPath = path.join(path.dirname(require.resolve("ffmpeg-static/package.json")), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  try { await openSourceSession(prisma, identity); }
  catch { accountedQuarantined = true; throw new Error("ENCODER_ACCOUNTED_REVIEW_REQUIRED"); }
  const current = { accounted: true, controller, failed: false, fingerprint: rotation.fingerprint, task: null };
  running = current;
  current.task = runAccountedRotation({ entries: rotation.entries, ledger, signal: controller.signal,
    loadApproval: async ({ entry, now }) => {
      const latest = await readRotation();
      if (stopping || !latest.ready || latest.fingerprint !== rotation.fingerprint || latest.entitlements.outputEnabled !== true || latest.entitlements.sandboxDraftOnly === true) return { allowed: false };
      const policy = latest.channel.autoDjPolicy;
      if (policy?.organisationId !== latest.station.organisationId || policy.channelId !== latest.channel.id) return { allowed: false };
      if (entry) {
        const fresh = latest.entries.find(candidate => candidate.track.id === entry.track.id && candidate.track.mediaAsset.id === entry.track.mediaAsset.id);
        if (!fresh) return { allowed: false };
        const stopAt = new Date(now.getTime() + (Number(fresh.track.mediaAsset.durationSeconds) + 2) * 1000);
        if (onlineRadioSourceScope(fresh) === "LICENSED_CATALOGUE") {
          if (!licensedManualCatalogueDecision(fresh.track, { enabled: deliveryOptions.manualCatalogueOutput, organisationId: latest.station.organisationId,
            entitlements: latest.entitlements, territory: policy.territory, instant: now, stopAt, configuredGenres: latest.configuredGenres,
            selectedGenreCodes: Array.isArray(policy.selectedGenreCodes) ? policy.selectedGenreCodes : [] }).allowed) return { allowed: false };
        } else {
          const options = { organisationId: latest.station.organisationId, requiredUse: "ONLINE_RADIO", territory: policy.territory || null,
            licensedCatalogueLevel: latest.entitlements.licensedMusicCatalogueLevel, configuredGenres: latest.configuredGenres };
          if (![now, stopAt].every(instant => musicTrackEligibility(fresh.track, { ...options, instant }).playable)) return { allowed: false };
        }
      }
      const graceDeadline = latest.entitlements.graceEndsAt ? new Date(latest.entitlements.graceEndsAt).getTime() : null;
      const boundaries = [now.getTime() + 10000, latest.scheduleEndsAt?.getTime(), latest.nextEventStartsAt?.getTime(), graceDeadline].filter(Number.isFinite);
      return { allowed: true, approvedUntil: new Date(Math.min(...boundaries)) };
    },
    renewLease: async () => {
      const now = new Date();
      const renewed = await prisma.stationStreamConfig.updateMany({ where: { stationId, outboundAutoDjEnabled: true,
        encoderLeaseOwner: owner, encoderLeaseUntil: { gt: now }, sourcePasswordEncrypted: source.sourcePasswordEncrypted,
        serverHost: source.serverHost, sourcePort: source.sourcePort }, data: { encoderLeaseUntil: new Date(now.getTime() + leaseMs) } });
      return renewed.count === 1;
    },
    prepareAudio: async ({ entries, signal }) => {
      const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-accounted-source-")), files = new Map();
      let total = 0;
      try {
        for (const entry of entries) {
          signal.throwIfAborted();
          const asset = entry.track.mediaAsset;
          if (files.has(asset.id)) continue;
          const identity = accountedMediaIdentity(asset, rotation.station.organisationId);
          total += identity.sizeBytes;
          if (total > 850 * 1024 * 1024) throw new Error("ENCODER_CACHE_LIMIT");
          const fileSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
          const object = await storage.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: asset.storageKey }), { abortSignal: fileSignal });
          if (!object.Body || Number(object.ContentLength) !== identity.sizeBytes) { object.Body?.destroy?.(); throw new Error("ENCODER_MEDIA_SIZE_MISMATCH"); }
          const file = path.join(directory, `${files.size}.${identity.extension}`);
          await downloadAccountedMedia(object.Body, file, identity, fileSignal);
          files.set(asset.id, file);
        }
        return { files, dispose: () => rm(directory, { recursive: true, force: true }) };
      } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    },
    connectSource: ({ signal, registerResource }) => connectAccountedSource({ source, password: decryptSecret(source.sourcePasswordEncrypted), signal, registerResource }),
    playTrack: ({ prepared, connection, entry, ...options }) => sendAccountedTrack({ ...options, ffmpegPath,
      filePath: prepared.files.get(entry.track.mediaAsset.id), track: { id: entry.track.id, durationSeconds: entry.track.mediaAsset.durationSeconds }, connection })
  }).catch(() => ({ status: "FAILED", reasonCode: "UNKNOWN_FAILURE", stopConfirmed: false, quarantined: true,
    listenerProof: false, royaltyConfirmed: false })).then(async result => {
    if (result.stopConfirmed && !result.quarantined) {
      try { await closeSourceSession(prisma, identity, { stopConfirmed: true, ledgerDrained: true }); }
      catch { result = { ...result, status: "FAILED", reasonCode: "DELIVERY_RECORD_FAILED", quarantined: true }; }
    }
    current.result = result; current.failed = true;
    if (result.quarantined) accountedQuarantined = true;
    if (result.quarantined) {
      let markerTimeout;
      await Promise.race([prisma.stationStreamConfig.updateMany({ where: { stationId, encoderLeaseOwner: owner },
        data: { lastError: "ENCODER_ACCOUNTED_REVIEW_REQUIRED" } }), new Promise(resolve => { markerTimeout = setTimeout(resolve, 2000); })])
        .catch(() => undefined).finally(() => clearTimeout(markerTimeout));
    }
    event("source_delivery_run_ended", { reason: result.reasonCode, stopConfirmed: result.stopConfirmed, senderEvidenceOnly: true });
    return result;
  });
}

event("worker_ready");
try {
  while (!stopping) {
    let rotation = null;
    try {
      rotation = await readRotation();
      if (!rotation.ready) {
        await stopOutput();
        if (lastWaitingReason !== rotation.reason) event("waiting_for_configuration", { reason: rotation.reason });
        lastWaitingReason = rotation.reason;
      } else if (!await claimLease()) {
        await stopOutput();
        if (lastWaitingReason !== "ENCODER_LEASE_BUSY") event("waiting_for_encoder_lease");
        lastWaitingReason = "ENCODER_LEASE_BUSY";
      } else if (!running || running.failed || !running.accounted && running.child.exitCode !== null || running.fingerprint !== rotation.fingerprint) {
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
    if (!stopping) {
      const boundaries = [rotation?.scheduleEndsAt, rotation?.nextEventStartsAt].filter(Boolean).map((date) => date.getTime() - Date.now());
      const delay = Math.max(100, Math.min(scanMs, ...boundaries));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
} finally {
  await stopOutput();
  await releaseLease().catch(() => undefined);
  await prisma.$disconnect();
  storage.destroy();
  for (const signal of ["SIGTERM", "SIGINT"]) process.removeListener(signal, onStop);
}
}
