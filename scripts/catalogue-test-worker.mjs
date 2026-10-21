// Opt-in diagnostic worker. Default invocation validates code only and exits.
// Never added to the web startup, normal AutoDJ, scheduler or cron entry points.
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { runCatalogueTest } from "../lib/catalogue-test-runner.mjs";
import { loadAuthorizedCatalogueTest, catalogueTestSourceFingerprint, CATALOGUE_TEST_LEASE_PREFIX } from "../lib/catalogue-test-service.mjs";
import { catalogueTestMediaIdentity, connectCatalogueTestSource, downloadCatalogueTestMedia,
  sendCatalogueTestTrack, validateCatalogueTestTarget } from "../lib/catalogue-test-transport.mjs";
import { TEST_RADIO_CATALOGUE_TEST as LIMITS } from "../lib/online-radio-catalogue-test.mjs";

const failure = code => Object.assign(new Error(code), { code });
export function catalogueTestWorkerMode(args, env = {}) {
  if (!args.length || args.length === 1 && args[0] === "--check") return "CHECK_ONLY";
  if (args.length !== 1 || args[0] !== "--serve-tests") throw failure("TEST_WORKER_ARGUMENTS_INVALID");
  if (env.RUVANAS_CATALOGUE_TEST_ALLOW_LIVE !== "true" || env.RUVANAS_CATALOGUE_TEST_STATION_ID !== LIMITS.stationId) throw failure("TEST_WORKER_NOT_APPROVED");
  return "SERVE_EXPLICIT_OWNER_TESTS";
}

export async function serveCatalogueTests() {
  catalogueTestWorkerMode(["--serve-tests"], process.env);
  for (const name of ["DATABASE_URL", "SECRET_ENCRYPTION_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    if (!process.env[name]) throw failure("TEST_WORKER_CONFIGURATION_REQUIRED");
  }
  // Restrict the SDK endpoint to the actual authenticated R2 S3 service. No
  // supplied URL, redirect or arbitrary endpoint ever enters the media path.
  const endpoint = new URL(process.env.R2_ENDPOINT);
  if (endpoint.protocol !== "https:" || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) ||
      endpoint.port || endpoint.username || endpoint.password || !["", "/"].includes(endpoint.pathname) || endpoint.search || endpoint.hash) throw failure("TEST_STORAGE_ENDPOINT_INVALID");
  const [{ PrismaClient }, { S3Client, GetObjectCommand }, { decryptSecret }] = await Promise.all([
    import("@prisma/client"), import("@aws-sdk/client-s3"), import("../lib/crypto.js")
  ]);
  const require = createRequire(import.meta.url);
  const ffmpegPath = path.join(path.dirname(require.resolve("ffmpeg-static/package.json")), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (!ffmpegPath) throw failure("TEST_ENCODER_UNAVAILABLE");
  const db = new PrismaClient();
  const storage = new S3Client({ region: "auto", endpoint: endpoint.href, forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const owner = `${CATALOGUE_TEST_LEASE_PREFIX}${randomBytes(16).toString("hex")}`;
  const stop = new AbortController();
  const onStop = () => stop.abort(failure("TEST_WORKER_STOPPED"));
  process.once("SIGINT", onStop); process.once("SIGTERM", onStop);
  let quarantine = false;
  const clock = { now: () => Date.now(), monotonicNow: () => performance.now(), setTimeout, clearTimeout };
  const log = (event, code) => console.log(JSON.stringify({ service: "CATALOGUE_TEST_WORKER", event, ...(code ? { code } : {}) }));
  async function renewWorkerLease() {
    const now = new Date();
    const config = await db.stationStreamConfig.findUnique({ where: { stationId: LIMITS.stationId } });
    validateCatalogueTestTarget(config);
    const updated = await db.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, outboundAutoDjEnabled: false,
      sourcePasswordEncrypted: config.sourcePasswordEncrypted, serverHost: config.serverHost, sourcePort: config.sourcePort,
      OR: [{ encoderLeaseOwner: owner }, { encoderLeaseUntil: null }, { encoderLeaseUntil: { lt: now } }] },
      data: { encoderLeaseOwner: owner, encoderLeaseUntil: new Date(now.getTime() + 15_000) } });
    return updated.count === 1;
  }
  async function runOne(sessionId) {
    return runCatalogueTest({ sessionId, clock, signal: stop.signal,
      loadAuthorizedSession: ({ now }) => loadAuthorizedCatalogueTest(db, { sessionId, now }),
      claim: async ({ now, session }) => db.$transaction(async tx => {
        const config = await tx.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, outboundAutoDjEnabled: false,
          encoderLeaseOwner: owner, encoderLeaseUntil: { gt: now } }, data: { encoderLeaseUntil: new Date(now.getTime() + 15_000) } });
        if (config.count !== 1) return { claimed: false };
        const updated = await tx.onlineRadioCatalogueTest.updateMany({ where: { id: sessionId, stationId: LIMITS.stationId,
          organisationId: session.organisationId, status: "ARMED", stopRequestedAt: null, deadlineAt: { gt: now }, expiresAt: { gt: now } },
          data: { status: "RUNNING", startedAt: now, leaseOwner: owner, leaseUntil: new Date(now.getTime() + 15_000) } });
        return { claimed: updated.count === 1, leaseId: owner };
      }),
      heartbeat: async ({ now, session }) => {
        const current = await loadAuthorizedCatalogueTest(db, { sessionId, now });
        if (current.status !== "RUNNING" || current.leaseOwner !== owner || current.fingerprint !== session.fingerprint) return { authorized: false, leaseHeld: false };
        const leaseUntil = new Date(Math.min(now.getTime() + 15_000, current.deadlineAt.getTime()));
        const renewed = await db.$transaction(async tx => {
          const config = await tx.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, outboundAutoDjEnabled: false,
            encoderLeaseOwner: owner, encoderLeaseUntil: { gt: now } }, data: { encoderLeaseUntil: leaseUntil } });
          const test = await tx.onlineRadioCatalogueTest.updateMany({ where: { id: sessionId, status: "RUNNING", stopRequestedAt: null,
            leaseOwner: owner, leaseUntil: { gt: now }, deadlineAt: { gt: now } }, data: { leaseUntil } });
          if (config.count !== 1 || test.count !== 1) throw failure("TEST_WORKER_LEASE_LOST");
          return true;
        });
        return { authorized: true, leaseHeld: renewed, fingerprint: current.fingerprint };
      },
      prepareAudio: async ({ session, signal }) => {
        const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-catalogue-test-"));
        const files = new Map();
        let total = 0;
        try {
          for (const item of session.tracks) {
            signal.throwIfAborted();
            const asset = item.track.mediaAsset;
            const identity = catalogueTestMediaIdentity(asset);
            total += identity.sizeBytes;
            if (total > 100 * 1024 * 1024) throw failure("TEST_CACHE_LIMIT");
            const object = await storage.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: asset.storageKey }), {
              abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
            if (!object.Body || Number(object.ContentLength) !== identity.sizeBytes) { object.Body?.destroy?.(); throw failure("TEST_MEDIA_SIZE_MISMATCH"); }
            const file = path.join(directory, `${files.size}.${identity.extension}`);
            await downloadCatalogueTestMedia(object.Body, file, asset, { signal });
            files.set(item.id, file);
          }
          return { files, dispose: () => rm(directory, { recursive: true, force: true }) };
        } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
      },
      connectSource: async ({ session, signal, registerResource }) => {
        const current = await loadAuthorizedCatalogueTest(db, { sessionId, now: new Date() });
        if (current.fingerprint !== session.fingerprint || catalogueTestSourceFingerprint(current.source) !== catalogueTestSourceFingerprint(session.source)) throw failure("TEST_SOURCE_CHANGED");
        return connectCatalogueTestSource({ source: current.source, password: decryptSecret(current.source.sourcePasswordEncrypted), signal, registerResource });
      },
      playTrack: ({ prepared, connection, track, signal, emit, registerResource }) => sendCatalogueTestTrack({
        ffmpegPath, filePath: prepared.files.get(track.id), track, connection, signal, emit, registerResource
      }),
      appendEvent: async ({ event }) => {
        const details = {};
        for (const key of ["audioBytesSent", "completed", "endedReason", "stopConfirmed", "status", "code"]) if (event[key] !== undefined) details[key] = event[key];
        await db.onlineRadioCatalogueTestEvent.create({ data: { testId: sessionId, eventKey: `${owner}:${event.sequence}`,
          kind: event.type, trackId: event.trackId || null, details, occurredAt: event.occurredAt } });
        return true;
      },
      finish: async ({ result, releaseAllowed }) => {
        if (!releaseAllowed) quarantine = true;
        const terminal = result.status === "COMPLETED" ? "COMPLETE" : result.status === "STOPPED" ? "STOPPED" : "FAILED";
        const updated = await db.onlineRadioCatalogueTest.updateMany({ where: { id: sessionId, leaseOwner: owner, status: "RUNNING" },
          data: { status: terminal, endedAt: new Date(), endedReason: result.code,
            ...(releaseAllowed ? { leaseOwner: null, leaseUntil: null } : {}) } });
        if (!releaseAllowed) await db.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, encoderLeaseOwner: owner },
          data: { lastError: "CATALOGUE_TEST_STOP_UNCONFIRMED" } });
        return updated.count === 1;
      }
    });
  }
  log("worker_waiting_for_explicit_owner_test");
  try {
    while (!stop.signal.aborted && !quarantine) {
      if (!await renewWorkerLease()) throw failure("TEST_WORKER_LEASE_BUSY");
      const now = new Date();
      // Expired requests are terminal, never automatically retried after a
      // deploy/crash. No source starts from an old RUNNING or PREPARED row.
      await db.onlineRadioCatalogueTest.updateMany({ where: { stationId: LIMITS.stationId, status: "ARMED", deadlineAt: { lte: now } },
        data: { status: "EXPIRED", endedAt: now, endedReason: "TEST_REQUEST_EXPIRED" } });
      const session = await db.onlineRadioCatalogueTest.findFirst({ where: { stationId: LIMITS.stationId, status: "ARMED",
        stopRequestedAt: null, deadlineAt: { gt: now }, expiresAt: { gt: now } }, orderBy: { requestedAt: "asc" } });
      if (session) {
        const result = await runOne(session.id);
        log("test_finished", result.code);
        if (!result.stopConfirmed) quarantine = true;
        // Fail closed if claim/start bookkeeping failed. Do not poll and retry
        // the same ambiguous ARMED request on a later worker scan.
        await db.onlineRadioCatalogueTest.updateMany({ where: { id: session.id, status: "ARMED" },
          data: { status: "FAILED", endedAt: new Date(), endedReason: result.code } });
      }
      if (!stop.signal.aborted) await new Promise(resolve => {
        const done = () => { clearTimeout(timer); stop.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 3000); stop.signal.addEventListener("abort", done, { once: true });
        if (stop.signal.aborted) done();
      });
    }
  } finally {
    if (!quarantine) await db.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, encoderLeaseOwner: owner },
      data: { encoderLeaseOwner: null, encoderLeaseUntil: null } }).catch(() => undefined);
    process.removeListener("SIGINT", onStop); process.removeListener("SIGTERM", onStop);
    storage.destroy(); await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const mode = catalogueTestWorkerMode(process.argv.slice(2), process.env);
    if (mode === "CHECK_ONLY") console.log(JSON.stringify({ service: "CATALOGUE_TEST_WORKER", mode, streamingStarted: false }));
    else await serveCatalogueTests();
  } catch (error) {
    const code = /^(TEST|CATALOGUE_TEST)_[A-Z_]+$/.test(error?.code || "") ? error.code : "TEST_WORKER_FAILED";
    console.error(JSON.stringify({ service: "CATALOGUE_TEST_WORKER", code })); process.exitCode = 1;
  }
}
