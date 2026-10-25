import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { retailWorkerMode, retailWorkerCode, retailPrivateDatabase, runRetailOutputSession } from "../lib/retail-stream-worker.mjs";
import { subscriberAudioWait as wait, subscriberAudioBounded as bounded } from "../lib/subscriber-stream-audio-runtime.mjs";

const fail = code => Object.assign(new Error(code), { code });
/** A deployable, long-running off mode. No environment inspection, database,
 * storage, lease or source connection occurs, even if live flags are present.
 * Changing from standby to serving always requires a new explicit command.
 */
export async function standbyRetailStreams({ signal: parentSignal, heartbeatMs = 60000,
  log = data => console.log(JSON.stringify(data)) } = {}) {
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > 60000 || typeof log !== "function")
    throw fail("RETAIL_WORKER_STANDBY_OPTIONS_INVALID");
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  const report = event => log({ service: "RETAIL_SHARED_AUDIO", mode: "STANDBY", event,
    streamingStarted: false, cloudAccessed: false });
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  parentSignal?.addEventListener("abort", stop, { once: true }); if (parentSignal?.aborted) stop();
  try {
    if (!shutdown.signal.aborted) report("standby_ready");
    while (!shutdown.signal.aborted) {
      await wait(heartbeatMs, shutdown.signal);
      if (!shutdown.signal.aborted) report("standby_heartbeat");
    }
  } finally {
    stop();
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    parentSignal?.removeEventListener("abort", stop);
    report("standby_stopped");
  }
  return { mode: "STANDBY", streamingStarted: false, cloudAccessed: false, stopped: true };
}

export async function serveRetailStreams({ env = process.env, signal: parentSignal } = {}) {
  const configuration = retailWorkerMode(["--serve"], env);
  if (!retailPrivateDatabase(env.DATABASE_URL)) throw fail("RETAIL_WORKER_PRIVATE_DATABASE_REQUIRED");
  for (const key of ["SECRET_ENCRYPTION_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_ENDPOINT"])
    if (typeof env[key] !== "string" || !env[key].trim()) throw fail("RETAIL_WORKER_CONFIGURATION_REQUIRED");
  const endpoint = new URL(env.R2_ENDPOINT.trim());
  if (endpoint.protocol !== "https:" || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) ||
    endpoint.port || endpoint.username || endpoint.password || !["/", ""].includes(endpoint.pathname) || endpoint.search || endpoint.hash)
    throw fail("RETAIL_WORKER_STORAGE_ENDPOINT_INVALID");
  const [{ PrismaClient }, { S3Client, GetObjectCommand }, service, transport, { decryptSecret }] = await Promise.all([
    import("@prisma/client"), import("@aws-sdk/client-s3"), import("../lib/retail-stream-playout-service.mjs"),
    import("../lib/subscriber-stream-transport.mjs"), import("../lib/crypto.js")
  ]);
  const require = createRequire(import.meta.url);
  const ffmpegPath = path.join(path.dirname(require.resolve("ffmpeg-static/package.json")), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const storage = new S3Client({ region: "auto", endpoint: endpoint.href, forcePathStyle: true,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim() } });
  const shutdown = new AbortController();
  const stop = () => shutdown.abort(fail("RETAIL_WORKER_STOPPED"));
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  parentSignal?.addEventListener("abort", stop, { once: true }); if (parentSignal?.aborted) stop();
  const jobs = new Map(), quarantined = new Set();
  async function openMediaSession({ signal }) {
    const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-retail-audio-"));
    // Only this exact owned temporary directory can be recursively removed.
    const parent = path.resolve(tmpdir());
    if (path.dirname(path.resolve(directory)) !== parent || !path.basename(directory).startsWith("ruvanas-retail-audio-")) throw fail("RETAIL_WORKER_CACHE_INVALID");
    const files = new Set(); let fileBytes = 0;
    return {
      async prepare(entry, operationSignal) {
        const asset = entry.track.mediaAsset, identity = transport.subscriberMediaIdentity(asset);
        while (files.size >= 3 || fileBytes + identity.sizeBytes > 150 * 1024 * 1024) {
          operationSignal.throwIfAborted(); signal.throwIfAborted(); await wait(25, operationSignal);
        }
        operationSignal.throwIfAborted(); signal.throwIfAborted();
        const filePath = path.join(directory, `${randomUUID()}.${identity.extension}`);
        files.add(filePath); fileBytes += identity.sizeBytes; let removed = false;
        const dispose = async () => {
          if (removed) return; removed = true; await rm(filePath, { force: true }); files.delete(filePath); fileBytes -= identity.sizeBytes;
        };
        try {
          const downloadSignal = AbortSignal.any([signal, operationSignal, AbortSignal.timeout(30000)]);
          const object = await storage.send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: asset.storageKey }), { abortSignal: downloadSignal });
          if (!object.Body || Number(object.ContentLength) !== identity.sizeBytes) { object.Body?.destroy?.(); throw fail("RETAIL_WORKER_MEDIA_SIZE_MISMATCH"); }
          await transport.downloadSubscriberMedia(object.Body, filePath, asset, { signal: downloadSignal });
          return { id: entry.track.id, mediaAssetId: asset.id, filePath, durationSeconds: entry.durationSeconds, dispose };
        } catch (error) { await dispose(); throw error; }
      },
      async disposeAll() { await rm(directory, { recursive: true, force: true }); }
    };
  }
  const log = (stationId, event, details = {}) => console.log(JSON.stringify({ service: "RETAIL_SHARED_AUDIO", stationId, event, ...details }));
  function launch(assignment) {
    const controller = new AbortController(), signal = AbortSignal.any([shutdown.signal, controller.signal]);
    const task = (async () => {
      let attempt = 0, previousCode = null;
      while (!signal.aborted) {
        try {
          await runRetailOutputSession({ db, service, assignment, workerId: configuration.workerId, env, signal, openMediaSession, ffmpegPath,
            connect: options => transport.connectSubscriberStreamSource({ ...options, password: decryptSecret(options.source.sourcePasswordEncrypted) }),
            log: (event, details) => log(assignment.stationId, event, details) });
          attempt = 0;
        } catch (error) {
          const code = retailWorkerCode(error);
          if (code !== previousCode) log(assignment.stationId, "waiting_or_recovering", { code }); previousCode = code;
          if (code === "RETAIL_WORKER_STOP_UNCONFIRMED") { quarantined.add(assignment.stationId); break; }
          attempt = Math.min(6, attempt + 1);
        }
        await wait(Math.min(60000, 5000 * Math.max(1, attempt)), signal);
      }
    })();
    jobs.set(assignment.stationId, { controller, task, assignment });
  }
  try {
    log(null, "worker_ready", { streamingStarted: false, configuredSlots: configuration.maximumSlots || configuration.assignments.length });
    while (!shutdown.signal.aborted) {
      const assignments = typeof service.listRetailWorkerAssignments === "function"
        ? await bounded(() => service.listRetailWorkerAssignments(db, { workerId: configuration.workerId, env }), shutdown.signal)
        : configuration.assignments;
      if (assignments.length > (configuration.maximumSlots || configuration.assignments.length)) throw fail("RETAIL_WORKER_CAPACITY_INVALID");
      for (const [stationId, job] of jobs) if (!assignments.some(row => row.stationId === stationId && JSON.stringify(row) === JSON.stringify(job.assignment))) {
        job.controller.abort(fail("RETAIL_WORKER_ASSIGNMENT_CHANGED")); await job.task; jobs.delete(stationId);
      }
      for (const assignment of assignments) if (!jobs.has(assignment.stationId) && !quarantined.has(assignment.stationId)) launch(assignment);
      await wait(5000, shutdown.signal);
    }
  } finally {
    stop(); await Promise.allSettled([...jobs.values()].map(job => job.task)); storage.destroy(); await db.$disconnect();
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); parentSignal?.removeEventListener("abort", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const mode = retailWorkerMode(process.argv.slice(2), process.env);
    if (mode.mode === "CHECK_ONLY") console.log(JSON.stringify({ service: "RETAIL_SHARED_AUDIO", mode: mode.mode, streamingStarted: false, cloudAccessed: false }));
    else if (mode.mode === "STANDBY") await standbyRetailStreams();
    else await serveRetailStreams();
  } catch (error) { console.error(JSON.stringify({ service: "RETAIL_SHARED_AUDIO", code: retailWorkerCode(error) })); process.exitCode = 1; }
}
