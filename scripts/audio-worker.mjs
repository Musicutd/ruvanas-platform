import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { S3Client } from "@aws-sdk/client-s3";
import { buildMultitrackRenderGraph, buildRenderGraph, parseLoudnessReport, reducePcmPeaks } from "../lib/audio-worker.mjs";
import { deploymentIdentity, safeOperationalErrorCode, structuredServiceLog } from "../lib/operational-observability.mjs";
import { recordServiceHeartbeat } from "../lib/operational-observability-service.js";

const prisma = new PrismaClient();
const intervalMs = Math.max(2000, Number(process.env.AUDIO_WORKER_INTERVAL_MS || 5000));
const processStartedAt = new Date();
const identity = deploymentIdentity({ service: "AUDIO_WORKER", instanceId: String(process.env.RENDER_INSTANCE_ID || `audio-${hostname()}-${process.pid}`).slice(0, 120), startedAt: processStartedAt });
const writeLog = (level, event, details = {}) => console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](structuredServiceLog(identity, level, event, details));
const storage = {
  client: new S3Client({
    region: "auto", endpoint: process.env.R2_ENDPOINT, forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
  }),
  bucketName: process.env.R2_BUCKET_NAME
};

function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, ...options });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      const result = { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") };
      code === 0 ? resolve(result) : reject(Object.assign(new Error(result.stderr.slice(-2000) || `Audio process exited with ${code}.`), result));
    });
  });
}

async function download(storageKey, filePath) {
  const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucketName, Key: storageKey }));
  if (typeof object.Body?.pipe === "function") {
    await pipeline(object.Body, createWriteStream(filePath));
    return;
  }
  if (typeof object.Body?.transformToByteArray === "function") {
    await writeFile(filePath, Buffer.from(await object.Body.transformToByteArray()));
    return;
  }
  throw new Error("Protected storage did not provide a readable audio stream.");
}

async function processWaveform() {
  const take = await prisma.audioTake.findFirst({ where: { waveformStatus: "PENDING", status: "READY" }, orderBy: { createdAt: "asc" }, include: { mediaAsset: true } });
  if (!take) return false;
  const claimed = await prisma.audioTake.updateMany({ where: { id: take.id, waveformStatus: "PENDING" }, data: { waveformStatus: "RUNNING" } });
  if (!claimed.count) return true;
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-waveform-"));
  try {
    const input = path.join(directory, "source");
    await download(take.mediaAsset.storageKey, input);
    const pcm = await run(ffmpegPath, ["-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "100", "-f", "s16le", "pipe:1"]);
    const probe = await run(ffprobeStatic.path, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input]);
    const durationSeconds = Math.max(1, Math.round(Number(probe.stdout.toString("utf8").trim()) || take.durationMs / 1000 || 1));
    await prisma.$transaction([
      prisma.audioTake.update({ where: { id: take.id }, data: { waveformStatus: "READY", waveformPeaks: reducePcmPeaks(pcm.stdout), waveformGeneratedAt: new Date(), durationMs: durationSeconds * 1000 } }),
      prisma.mediaAsset.update({ where: { id: take.mediaAssetId }, data: { durationSeconds } })
    ]);
  } catch (error) {
    writeLog("error", "waveform_job_failed", { entityId: take.id, errorCode: safeOperationalErrorCode(error, "WAVEFORM_JOB_FAILED") });
    await prisma.audioTake.update({ where: { id: take.id }, data: { waveformStatus: "FAILED" } }).catch(() => {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return true;
}

async function processRender() {
  const render = await prisma.audioRender.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, include: { project: true, version: true } });
  if (!render) return false;
  const claimed = await prisma.audioRender.updateMany({ where: { id: render.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), errorMessage: null } });
  if (!claimed.count) return true;
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-render-"));
  try {
    const multitrack = render.version.state?.multitrack;
    const state = multitrack || render.version.state?.editor;
    const graph = multitrack ? buildMultitrackRenderGraph(multitrack) : buildRenderGraph(state?.clips, state || {});
    const sourceIds = graph.inputs.map((input) => input.mediaAssetId);
    const assets = await prisma.mediaAsset.findMany({ where: { id: { in: [...new Set(sourceIds)] }, organisationId: render.organisationId } });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const inputArgs = [];
    for (let index = 0; index < graph.inputs.length; index += 1) {
      const asset = byId.get(graph.inputs[index].mediaAssetId);
      if (!asset) throw new Error("A protected source needed by this version is unavailable.");
      const inputPath = path.join(directory, `input-${index}`);
      await download(asset.storageKey, inputPath);
      inputArgs.push("-i", inputPath);
    }
    const wav = render.preset === "WAV_MASTER";
    const extension = wav ? "wav" : "mp3";
    const mimeType = wav ? "audio/wav" : "audio/mpeg";
    const output = path.join(directory, `render.${extension}`);
    const codecArgs = wav ? ["-c:a", "pcm_s24le"] : ["-c:a", "libmp3lame", "-b:a", render.preset === "SPEECH_MP3" ? "128k" : "192k"];
    await run(ffmpegPath, ["-y", ...inputArgs, "-filter_complex", graph.filterComplex, "-map", graph.outputLabel, ...codecArgs, output]);
    const [probe, loudness, fileInfo] = await Promise.all([
      run(ffprobeStatic.path, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output]),
      run(ffmpegPath, ["-hide_banner", "-nostats", "-i", output, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]).catch((error) => ({ stderr: error.stderr || error.message })),
      stat(output)
    ]);
    const report = parseLoudnessReport(loudness.stderr);
    const durationSeconds = Math.max(1, Math.round(Number(probe.stdout.toString("utf8").trim()) || 1));
    const key = `organisations/${render.organisationId}/school-audio/renders/${render.projectId}/${crypto.randomUUID()}.${extension}`;
    await storage.client.send(new PutObjectCommand({ Bucket: storage.bucketName, Key: key, Body: createReadStream(output), ContentLength: fileInfo.size, ContentType: mimeType, Metadata: { source: multitrack ? "multitrack-studio" : "waveform-editor", project: render.projectId, version: String(render.version.version) } }));

    const sourceTake = await prisma.audioTake.findFirst({ where: { projectId: render.projectId, mediaAssetId: { in: sourceIds }, promoVersionId: { not: null } }, include: { promoVersion: { include: { promoAsset: { include: { versions: { select: { version: true } } } } } } } });
    const priorOutput = multitrack ? await prisma.audioRender.findFirst({ where: { projectId: render.projectId, id: { not: render.id }, outputPromoVersionId: { not: null } }, orderBy: { completedAt: "desc" }, include: { outputPromoVersion: { include: { promoAsset: { include: { versions: { select: { version: true } } } } } } } }) : null;
    const result = await prisma.$transaction(async (tx) => {
      const mediaAsset = await tx.mediaAsset.create({ data: { organisationId: render.organisationId, libraryType: "ORGANISATION_PROMO", name: `${render.project.title} final`, originalName: `${render.project.title}.${extension}`, storageKey: key, mimeType, sizeBytes: BigInt(fileInfo.size), durationSeconds, mediaType: "ANNOUNCEMENT", status: "READY" } });
      let promoVersion = null;
      const existingPromo = priorOutput?.outputPromoVersion?.promoAsset || sourceTake?.promoVersion?.promoAsset || null;
      if (existingPromo || multitrack) {
        const promoAsset = existingPromo || await tx.promoAsset.create({ data: { organisationId: render.organisationId, name: render.project.title, mediaType: "ANNOUNCEMENT", languageCode: "und" } });
        const nextVersion = Math.max(0, ...(promoAsset.versions || []).map((item) => item.version)) + 1;
        const processingJobs = multitrack ? undefined : { create: ["PREVIEW", "TRANSCODE", "LOUDNESS_ANALYSIS"].map((jobType) => ({ jobType, status: "QUEUED" })) };
        promoVersion = await tx.promoVersion.create({ data: { promoAssetId: promoAsset.id, mediaAssetId: mediaAsset.id, version: nextVersion, status: "IN_REVIEW", qcStatus: multitrack ? "PASSED" : "PENDING", sourceType: "STUDIO", sourceReference: `audio-render:${render.id}`, languageCode: sourceTake?.promoVersion?.languageCode || "und", durationSeconds, loudnessLufs: report.integratedLufs, submittedById: render.requestedByUserId, submittedAt: new Date(), ...(processingJobs ? { processingJobs } : {}) } });
      }
      await tx.audioRender.update({ where: { id: render.id }, data: { status: "SUCCEEDED", completedAt: new Date(), outputMediaAssetId: mediaAsset.id, outputPromoVersionId: promoVersion?.id || null, loudnessLufs: report.integratedLufs, resultJson: { ...report, durationSeconds, immutableSource: true, version: render.version.version } } });
      return { mediaAsset, promoVersion };
    });
    writeLog("info", "audio_render_completed", { entityId: render.id, outputEntityId: result.mediaAsset.id });
  } catch (error) {
    writeLog("error", "audio_render_failed", { entityId: render.id, errorCode: safeOperationalErrorCode(error, "AUDIO_RENDER_FAILED") });
    await prisma.audioRender.update({ where: { id: render.id }, data: { status: "FAILED", completedAt: new Date(), errorMessage: String(error?.message || "Render failed").slice(0, 2000) } }).catch(() => {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return true;
}

async function processSignageVideo() {
  const retryBefore = new Date(Date.now() - 15 * 60 * 1000);
  const job = await prisma.digitalSignageVideoJob.findFirst({
    where: { OR: [{ status: "QUEUED" }, { status: "RUNNING", updatedAt: { lt: retryBefore } }] },
    orderBy: { createdAt: "asc" },
    include: { asset: true }
  });
  if (!job) return false;
  const claimed = await prisma.digitalSignageVideoJob.updateMany({
    where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
    data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date(), errorMessage: null }
  });
  if (!claimed.count) return true;
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-signage-video-"));
  try {
    const input = path.join(directory, "source");
    const output = path.join(directory, "display.mp4");
    await download(job.asset.storageKey, input);
    const sourceProbe = await run(ffprobeStatic.path, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", input], { timeout: 2 * 60 * 1000 });
    const sourceInfo = JSON.parse(sourceProbe.stdout.toString("utf8"));
    const sourceStream = sourceInfo.streams?.[0];
    const durationSeconds = Math.ceil(Number(sourceInfo.format?.duration || 0));
    if (!sourceStream?.width || !sourceStream?.height || durationSeconds < 1 || durationSeconds > 3600) throw new Error("Video must contain a valid picture stream and be no longer than 60 minutes.");
    if (sourceStream.width > 8192 || sourceStream.height > 8192) throw new Error("Video dimensions exceed the protected processing limit.");
    if (sourceStream.width * sourceStream.height > 33_554_432) throw new Error("Video contains too many pixels for safe display processing.");
    await run(ffmpegPath, [
      "-y", "-v", "error", "-i", input,
      "-map", "0:v:0", "-map", "0:a?",
      "-vf", "scale='min(1920,iw)':-2",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output
    ], { timeout: 10 * 60 * 1000 });
    const [outputProbe, fileInfo] = await Promise.all([
      run(ffprobeStatic.path, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", output], { timeout: 2 * 60 * 1000 }),
      stat(output)
    ]);
    const outputInfo = JSON.parse(outputProbe.stdout.toString("utf8"));
    const outputStream = outputInfo.streams?.[0];
    if (!outputStream?.width || !outputStream?.height) throw new Error("The normalized display video could not be verified.");
    if (fileInfo.size > 250 * 1024 * 1024) throw new Error("The normalized display video exceeds the protected output limit.");
    const outputKey = `organisations/${job.asset.organisationId}/signage/videos/${crypto.randomUUID()}.mp4`;
    await storage.client.send(new PutObjectCommand({
      Bucket: storage.bucketName,
      Key: outputKey,
      Body: createReadStream(output),
      ContentLength: fileInfo.size,
      ContentType: "video/mp4",
      Metadata: { source: "digital-signage-video-worker", asset: job.assetId }
    }));
    await prisma.$transaction([
      prisma.digitalSignageAsset.update({ where: { id: job.assetId }, data: { storageKey: outputKey, mimeType: "video/mp4", sizeBytes: BigInt(fileInfo.size), width: outputStream.width, height: outputStream.height, durationSeconds: Math.ceil(Number(outputInfo.format?.duration || durationSeconds)), status: "READY" } }),
      prisma.digitalSignageVideoJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), errorMessage: null } }),
      prisma.auditLog.create({ data: { organisationId: job.asset.organisationId, actorUserId: job.asset.uploadedByUserId, action: "DIGITAL_SIGNAGE_VIDEO_READY", entityType: "DigitalSignageAsset", entityId: job.assetId, details: { width: outputStream.width, height: outputStream.height, durationSeconds, normalizedMimeType: "video/mp4" } } })
    ]);
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucketName, Key: job.asset.storageKey })).catch(() => {});
    writeLog("info", "signage_video_ready", { entityId: job.assetId });
  } catch (error) {
    writeLog("error", "signage_video_failed", { entityId: job.assetId, errorCode: safeOperationalErrorCode(error, "SIGNAGE_VIDEO_FAILED") });
    const errorMessage = String(error?.message || "Video processing failed").slice(0, 2000);
    await prisma.$transaction([
      prisma.digitalSignageVideoJob.update({ where: { id: job.id }, data: { status: "FAILED", completedAt: new Date(), errorMessage } }),
      prisma.digitalSignageAsset.update({ where: { id: job.assetId }, data: { status: "FAILED" } })
    ]).catch(() => {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return true;
}

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; });
await recordServiceHeartbeat(prisma, { identity, details: { intervalMs } });
const heartbeatTimer = setInterval(() => recordServiceHeartbeat(prisma, { identity, details: { intervalMs } }).catch((error) => writeLog("error", "audio_worker_heartbeat_failed", { errorCode: safeOperationalErrorCode(error) })), 30_000);
heartbeatTimer.unref();
writeLog("info", "audio_worker_ready", { intervalMs });
while (!stopping) {
  const worked = await processWaveform() || await processRender() || await processSignageVideo();
  if (!worked) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
clearInterval(heartbeatTimer);
await prisma.$disconnect();
