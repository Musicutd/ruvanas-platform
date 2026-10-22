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
import { catalogueTestPreparationDeadline, catalogueTestProfileForSession, getCatalogueTestProfile } from "../lib/catalogue-test-profiles.mjs";

const failure = code => Object.assign(new Error(code), { code });
const validSessionId = value => typeof value === "string" && /^c[a-z0-9]{10,40}$/i.test(value);
export function catalogueTestWorkerMode(args = [], env = {}) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw failure("TEST_WORKER_ARGUMENTS_INVALID");
  if (!args.length || args.length === 1 && args[0] === "--check") return "CHECK_ONLY";
  if (args.length !== 1 || !["--serve-tests", "--serve-test-once"].includes(args[0])) throw failure("TEST_WORKER_ARGUMENTS_INVALID");
  if (env.RUVANAS_CATALOGUE_TEST_ALLOW_LIVE !== "true" || env.RUVANAS_CATALOGUE_TEST_STATION_ID !== LIMITS.stationId) throw failure("TEST_WORKER_NOT_APPROVED");
  if (args[0] === "--serve-test-once") {
    if (!validSessionId(env.RUVANAS_CATALOGUE_TEST_SESSION_ID)) throw failure("TEST_WORKER_SESSION_REQUIRED");
    return "SERVE_ONE_EXPLICIT_OWNER_TEST";
  }
  return "SERVE_EXPLICIT_OWNER_TESTS";
}

function waitForPoll(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

// Pure injected selector/orchestration: never searches or claims another row.
// Waiting PREPARED does not arm it. The existing runner alone owns actual audio,
// its independent deadline, rights revalidation and closure confirmation.
export async function runCatalogueTestOnce({ sessionId, loadSelected, renewLease, runSelected,
  signal = new AbortController().signal, now = () => new Date(), monotonicNow = () => performance.now(), wait = waitForPoll } = {}) {
  if (!validSessionId(sessionId) || [loadSelected, renewLease, runSelected, now, monotonicNow, wait].some(fn => typeof fn !== "function") ||
      typeof signal?.throwIfAborted !== "function") throw failure("TEST_WORKER_ONCE_OPTIONS_INVALID");
  // A longer audio grant never extends the separate ten-minute pre-arm wait.
  const started = monotonicNow(), maximumWaitMs = getCatalogueTestProfile().maximumPreparationSeconds * 1000;
  let selectedStopAt = Infinity;
  const refused = code => ({ status: "REFUSED", code, stopConfirmed: true });
  const stopped = () => ({ status: "STOPPED", code: "TEST_WORKER_STOPPED", stopConfirmed: true });
  async function beforeStart(operation) {
    signal.throwIfAborted();
    const instant = now(), elapsed = monotonicNow() - started;
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime()) || !Number.isFinite(elapsed) || elapsed < 0) throw failure("TEST_WORKER_CLOCK_INVALID");
    const remaining = Math.min(maximumWaitMs - elapsed, selectedStopAt - instant.getTime());
    if (remaining <= 0) throw failure("TEST_REQUEST_EXPIRED");
    // Allow a cold database connection, but never extend the original wait
    // budget or any expiry/deadline already learned from this selected row.
    const timeoutMs = Math.min(5000, remaining);
    const timeoutCode = remaining <= 5000 ? "TEST_REQUEST_EXPIRED" : "TEST_WORKER_ONCE_LOOKUP_TIMEOUT";
    return new Promise((resolve, reject) => {
      let settled = false;
      const operationStop = new AbortController();
      const finish = (value, error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", cancel);
        error ? reject(error) : resolve(value);
      };
      const cancel = () => { operationStop.abort(failure("TEST_WORKER_STOPPED")); finish(null, failure("TEST_WORKER_STOPPED")); };
      const timer = setTimeout(() => {
        operationStop.abort(failure(timeoutCode));
        finish(null, failure(timeoutCode));
      }, timeoutMs);
      signal.addEventListener("abort", cancel, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); return operation(operationStop.signal); }).then(value => finish(value), error => finish(null, error));
      if (signal.aborted) cancel();
    });
  }
  while (!signal.aborted) {
    try {
      const instant = now(), elapsed = monotonicNow() - started;
      if (!(instant instanceof Date) || !Number.isFinite(instant.getTime()) || !Number.isFinite(elapsed) || elapsed < 0) return refused("TEST_WORKER_CLOCK_INVALID");
      if (elapsed >= maximumWaitMs) return refused("TEST_REQUEST_EXPIRED");
      const selected = await beforeStart(operationSignal => loadSelected({ sessionId, now: instant, allowPrepared: true, signal: operationSignal }));
      const current = now();
      if (!(current instanceof Date) || !Number.isFinite(current.getTime())) return refused("TEST_WORKER_CLOCK_INVALID");
      if (selected?.authorized !== true || selected.id !== sessionId || selected.stationId !== LIMITS.stationId) return refused("TEST_WORKER_SESSION_MISMATCH");
      if (!["PREPARED", "ARMED"].includes(selected.status)) return refused("TEST_WORKER_SESSION_NOT_STARTABLE");
      if (selected.stopRequestedAt) return stopped();
      if (!catalogueTestProfileForSession(selected)) return refused("TEST_PROFILE_INVALID");
      if (!(selected.expiresAt instanceof Date) || !Number.isFinite(selected.expiresAt.getTime()) || selected.expiresAt <= current) return refused("TEST_REQUEST_EXPIRED");
      if (selected.status === "ARMED" && (!(selected.deadlineAt instanceof Date) || !Number.isFinite(selected.deadlineAt.getTime()) ||
          selected.deadlineAt <= current || selected.deadlineAt > selected.expiresAt)) return refused("TEST_REQUEST_EXPIRED");
      selectedStopAt = Math.min(selectedStopAt, selected.expiresAt.getTime(), selected.status === "ARMED" ? selected.deadlineAt.getTime() : Infinity);
      if (selected.status === "PREPARED" && selected.authorization !== undefined) {
        const preparationDeadline = catalogueTestPreparationDeadline(selected.authorization, selected.durationSeconds);
        if (!preparationDeadline || preparationDeadline <= current) return refused("TEST_REQUEST_EXPIRED");
        selectedStopAt = Math.min(selectedStopAt, preparationDeadline.getTime());
      }
      const leaseHeld = await beforeStart(operationSignal => renewLease({ sessionId, now: current, signal: operationSignal }));
      // A previous deployment may retain its short lease during shutdown.
      // Retry only an explicitly occupied lease, never an ambiguous result.
      if (leaseHeld !== true && leaseHeld !== false) return refused("TEST_WORKER_LEASE_BUSY");
      if (signal.aborted) return stopped();
      const afterLease = now(), currentElapsed = monotonicNow() - started;
      if (!(afterLease instanceof Date) || !Number.isFinite(afterLease.getTime()) || !Number.isFinite(currentElapsed) || currentElapsed < 0) return refused("TEST_WORKER_CLOCK_INVALID");
      if (currentElapsed >= maximumWaitMs || selectedStopAt <= afterLease.getTime() || selected.expiresAt <= afterLease ||
          selected.status === "ARMED" && selected.deadlineAt <= afterLease) return refused("TEST_REQUEST_EXPIRED");
      if (leaseHeld && selected.status === "ARMED") {
        // Exactly one invocation. There is intentionally no retry, even if a
        // claim response or terminal bookkeeping becomes uncertain.
        try {
          const result = await runSelected(sessionId);
          if (!result || typeof result.stopConfirmed !== "boolean" || !["REFUSED", "STOPPED", "FAILED", "COMPLETED"].includes(result.status) ||
              !/^(TEST|CATALOGUE_TEST)_[A-Z_]+$/.test(result.code || "")) throw failure("TEST_WORKER_ONCE_RESULT_INVALID");
          return result;
        } catch { return { status: "FAILED", code: "CATALOGUE_TEST_STOP_UNCONFIRMED", stopConfirmed: false }; }
      }
      const remaining = Math.min(selectedStopAt - afterLease.getTime(), maximumWaitMs - currentElapsed,
        selected.status === "ARMED" ? selected.deadlineAt.getTime() - afterLease.getTime() : Infinity);
      if (remaining <= 0) return refused("TEST_REQUEST_EXPIRED");
      await wait(Math.min(3000, remaining), signal);
    } catch (error) {
      if (signal.aborted) return stopped();
      return refused(/^(TEST|CATALOGUE_TEST)_[A-Z_]+$/.test(error?.code || "") ? error.code : "TEST_WORKER_ONCE_REFUSED");
    }
  }
  return stopped();
}

// Cancellation cannot retract a database query already sent. Check before a
// write, and release only this owner's lease if that write completes too late.
export async function renewCatalogueTestWorkerLease({ db, owner, signal, now = () => new Date() }) {
  signal.throwIfAborted();
  const config = await db.stationStreamConfig.findUnique({ where: { stationId: LIMITS.stationId } });
  signal.throwIfAborted();
  validateCatalogueTestTarget(config);
  const instant = now();
  const updated = await db.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, outboundAutoDjEnabled: false,
    sourcePasswordEncrypted: config.sourcePasswordEncrypted, serverHost: config.serverHost, sourcePort: config.sourcePort,
    OR: [{ encoderLeaseOwner: owner }, { encoderLeaseUntil: null }, { encoderLeaseUntil: { lt: instant } }] },
    data: { encoderLeaseOwner: owner, encoderLeaseUntil: new Date(instant.getTime() + 15_000) } });
  if (signal.aborted) {
    if (updated.count === 1) await db.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, encoderLeaseOwner: owner },
      data: { encoderLeaseOwner: null, encoderLeaseUntil: null } });
    signal.throwIfAborted();
  }
  return updated.count === 1;
}

export async function holdCatalogueTestWorker(signal) {
  if (signal.aborted) return;
  await waitForPoll(2147483647, signal);
  // A very long manual hold must remain inert, not resume database polling.
  if (!signal.aborted) return holdCatalogueTestWorker(signal);
}

// Preflight every selected file before the first storage request. The runner's
// authenticated session supplies the profile; a supplied testProfile is ignored.
export function catalogueTestPreparationPlan(session) {
  const profile = catalogueTestProfileForSession(session);
  if (!profile || session?.authorized !== true) throw failure("TEST_PROFILE_INVALID");
  if (!Array.isArray(session.tracks) || !session.tracks.length || session.tracks.length > profile.maximumItems) throw failure("TEST_PLAN_CHANGED");
  const trackIds = new Set(), assets = new Map(), entries = [];
  let totalBytes = 0;
  for (const item of session.tracks) {
    const asset = item?.track?.mediaAsset;
    if (typeof item?.id !== "string" || !item.id || trackIds.has(item.id) ||
        typeof asset?.id !== "string" || !asset.id || item.mediaAssetId !== asset.id) throw failure("TEST_PLAN_CHANGED");
    trackIds.add(item.id);
    const identity = catalogueTestMediaIdentity(asset), prior = assets.get(asset.id);
    if (prior && (prior.checksum !== identity.checksum || prior.sizeBytes !== identity.sizeBytes || prior.extension !== identity.extension)) throw failure("TEST_MEDIA_IDENTITY_INVALID");
    if (!prior) {
      totalBytes += identity.sizeBytes;
      if (totalBytes > profile.maximumUniqueFileBytes) throw failure("TEST_CACHE_LIMIT");
      assets.set(asset.id, identity);
    }
    entries.push(Object.freeze({ trackId: item.id, asset: Object.freeze({ ...asset }), identity: Object.freeze(identity) }));
  }
  return Object.freeze({ profile, totalBytes, entries: Object.freeze(entries) });
}

export async function serveCatalogueTests({ once = false } = {}) {
  if (typeof once !== "boolean") throw failure("TEST_WORKER_ARGUMENTS_INVALID");
  catalogueTestWorkerMode([once ? "--serve-test-once" : "--serve-tests"], process.env);
  const selectedSessionId = once ? process.env.RUVANAS_CATALOGUE_TEST_SESSION_ID : null;
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
  let quarantine = false, onceResult = null, onceRunAttempted = false;
  const clock = { now: () => Date.now(), monotonicNow: () => performance.now(), setTimeout, clearTimeout };
  const log = (event, code) => console.log(JSON.stringify({ service: "CATALOGUE_TEST_WORKER", event, ...(code ? { code } : {}) }));
  function renewWorkerLease({ signal = stop.signal } = {}) {
    return renewCatalogueTestWorkerLease({ db, owner, signal: AbortSignal.any([stop.signal, signal]) });
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
        const preparation = catalogueTestPreparationPlan(session);
        const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-catalogue-test-"));
        const files = new Map(), cachedAssets = new Map();
        let total = 0;
        try {
          for (const item of preparation.entries) {
            signal.throwIfAborted();
            const { asset, identity } = item;
            if (cachedAssets.has(asset.id)) { files.set(item.trackId, cachedAssets.get(asset.id)); continue; }
            total += identity.sizeBytes;
            if (total > preparation.profile.maximumUniqueFileBytes) throw failure("TEST_CACHE_LIMIT");
            const object = await storage.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: asset.storageKey }), {
              abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
            if (!object.Body || Number(object.ContentLength) !== identity.sizeBytes) { object.Body?.destroy?.(); throw failure("TEST_MEDIA_SIZE_MISMATCH"); }
            const file = path.join(directory, `${files.size}.${identity.extension}`);
            await downloadCatalogueTestMedia(object.Body, file, asset, { signal });
            files.set(item.trackId, file); cachedAssets.set(asset.id, file);
          }
          return { files, dispose: () => rm(directory, { recursive: true, force: true }) };
        } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
      },
      connectSource: async ({ session, signal, registerResource }) => {
        const current = await loadAuthorizedCatalogueTest(db, { sessionId, now: new Date() });
        if (current.fingerprint !== session.fingerprint || catalogueTestSourceFingerprint(current.source) !== catalogueTestSourceFingerprint(session.source)) throw failure("TEST_SOURCE_CHANGED");
        return connectCatalogueTestSource({ source: current.source, password: decryptSecret(current.source.sourcePasswordEncrypted), signal, registerResource });
      },
      playTrack: ({ prepared, connection, track, session, signal, emit, registerResource }) => sendCatalogueTestTrack({
        ffmpegPath, filePath: prepared.files.get(track.id), track, session, connection, signal, emit, registerResource
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
  log(once ? "worker_waiting_for_selected_owner_test" : "worker_waiting_for_explicit_owner_test");
  try {
    if (once) {
      onceResult = await runCatalogueTestOnce({ sessionId: selectedSessionId, signal: stop.signal,
        loadSelected: options => loadAuthorizedCatalogueTest(db, options), renewLease: renewWorkerLease,
        runSelected: sessionId => { onceRunAttempted = true; return runOne(sessionId); } });
      if (!onceResult.stopConfirmed) {
        quarantine = true;
        await db.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, encoderLeaseOwner: owner },
          data: { lastError: "CATALOGUE_TEST_STOP_UNCONFIRMED" } }).catch(() => undefined);
      }
      // A pre-audio shutdown must not fail an ARMED row that the replacement
      // can still claim. An attempted/ambiguous run is never automatically retried.
      // This exact selected row only; never expire or select unrelated tests.
      if (!stop.signal.aborted || onceRunAttempted) {
        await db.onlineRadioCatalogueTest.updateMany({ where: { id: selectedSessionId, stationId: LIMITS.stationId, status: "ARMED" },
          data: { status: "FAILED", endedAt: new Date(), endedReason: onceResult.code } });
      }
    } else while (!stop.signal.aborted && !quarantine) {
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
    try {
      if (!quarantine) await db.stationStreamConfig.updateMany({ where: { stationId: LIMITS.stationId, encoderLeaseOwner: owner },
        data: { encoderLeaseOwner: null, encoderLeaseUntil: null } }).catch(() => undefined);
      storage.destroy(); await db.$disconnect();
    } catch (error) {
      if (!once) throw error;
      onceResult = { status: "FAILED", code: "TEST_WORKER_CLEANUP_FAILED", stopConfirmed: onceResult?.stopConfirmed === true };
    } finally {
      if (once) {
        console.log(JSON.stringify({ service: "CATALOGUE_TEST_WORKER", event: "single_test_done_held", status: onceResult?.status || "FAILED",
          code: /^(TEST|CATALOGUE_TEST)_[A-Z_]+$/.test(onceResult?.code || "") ? onceResult.code : "TEST_WORKER_ONCE_REFUSED",
          stopConfirmed: onceResult?.stopConfirmed === true, anotherSessionAllowed: false }));
        await holdCatalogueTestWorker(stop.signal);
      }
      process.removeListener("SIGINT", onStop); process.removeListener("SIGTERM", onStop);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const mode = catalogueTestWorkerMode(process.argv.slice(2), process.env);
    if (mode === "CHECK_ONLY") console.log(JSON.stringify({ service: "CATALOGUE_TEST_WORKER", mode, streamingStarted: false }));
    else await serveCatalogueTests({ once: mode === "SERVE_ONE_EXPLICIT_OWNER_TEST" });
  } catch (error) {
    const code = /^(TEST|CATALOGUE_TEST)_[A-Z_]+$/.test(error?.code || "") ? error.code : "TEST_WORKER_FAILED";
    console.error(JSON.stringify({ service: "CATALOGUE_TEST_WORKER", code })); process.exitCode = 1;
  }
}
