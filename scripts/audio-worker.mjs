import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { S3Client } from "@aws-sdk/client-s3";
import { buildMultitrackRenderGraph, buildRenderGraph, parseLoudnessReport, reducePcmPeaks } from "../lib/audio-worker.mjs";

const prisma = new PrismaClient();
const intervalMs = Math.max(2000, Number(process.env.AUDIO_WORKER_INTERVAL_MS || 5000));
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
    console.error("waveform job failed", take.id, error);
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
    console.log("audio render complete", render.id, result.mediaAsset.id);
  } catch (error) {
    console.error("audio render failed", render.id, error);
    await prisma.audioRender.update({ where: { id: render.id }, data: { status: "FAILED", completedAt: new Date(), errorMessage: String(error?.message || "Render failed").slice(0, 2000) } }).catch(() => {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return true;
}

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; });
console.log("Ruvanas audio worker ready");
while (!stopping) {
  const worked = await processWaveform() || await processRender();
  if (!worked) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
await prisma.$disconnect();
