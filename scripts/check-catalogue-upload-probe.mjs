// Post-build, local-only check of the actual compiled catalogue upload dependency graph.
// It never invokes a route handler, opens a database, or sends a storage request.
import { execFile as execFileOriginal } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileOriginal);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = {
  single: "app/api/admin/catalogue/upload/route.js",
  bulk: "app/api/admin/catalogue/bulk-upload/route.js"
};
const SENSITIVE_ENV = ["DATABASE_URL", "DIRECT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME"];

class CheckFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireCheck(condition, code) {
  if (!condition) throw new CheckFailure(code);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function parseRouteChunkIds(source) {
  const matches = [...source.matchAll(/\.X\(0,\[([\d,\s]+)\]/g)];
  requireCheck(matches.length === 1, "ROUTE_GRAPH_INVALID");
  const ids = matches[0][1].split(",").map((value) => Number(value.trim()));
  requireCheck(ids.length > 0 && ids.every((value) => Number.isSafeInteger(value) && value > 0) &&
    new Set(ids).size === ids.length, "ROUTE_GRAPH_INVALID");
  return ids;
}

export function selectStorageModuleId(modules) {
  const ids = Object.entries(modules).filter(([id, factory]) =>
    /^\d+$/.test(id) && typeof factory === "function" &&
    factory.toString().includes("inspectCatalogueAudio:") &&
    factory.toString().includes("storeCatalogueTrack:"))
    .map(([id]) => Number(id));
  requireCheck(ids.length === 1 && Number.isSafeInteger(ids[0]) && ids[0] > 0, "STORAGE_MODULE_INVALID");
  return ids[0];
}

export function validateRouteGraphs(singleSource, bulkSource, storageChunkId) {
  const single = parseRouteChunkIds(singleSource);
  const bulk = parseRouteChunkIds(bulkSource);
  requireCheck(single.includes(storageChunkId) && bulk.includes(storageChunkId), "STORAGE_NOT_IN_BOTH_ROUTES");
  requireCheck(singleSource.includes("storeCatalogueTrack") &&
    bulkSource.includes("inspectCatalogueAudio") && bulkSource.includes("storeCatalogueTrack"),
  "UPLOAD_EXPORTS_NOT_IN_BOTH_ROUTES");
  return { single: true, bulk: true, chunks: [...new Set([...single, ...bulk])] };
}

export function createSyntheticWav(seconds = 2) {
  requireCheck(seconds === 2, "SYNTHETIC_AUDIO_INVALID");
  const sampleRate = 8_000;
  const dataBytes = seconds * sampleRate * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

export function classifyCompiledFailure(error) {
  if (error?.code === "CATALOGUE_DURATION_UNVERIFIED") return "COMPILED_AUDIO_UNVERIFIED";
  if (error instanceof CheckFailure) return error.code;
  return "COMPILED_CHECK_FAILED";
}

export function guardedExecFile(original, onInvoke) {
  requireCheck(typeof original === "function" && typeof onInvoke === "function" &&
    typeof original[promisify.custom] === "function", "EXECFILE_GUARD_INVALID");
  function guarded(...args) {
    onInvoke(args[0]);
    return original.apply(this, args);
  }
  // Node's execFile custom promisifier returns {stdout, stderr}; losing it
  // would make a valid compiled ffprobe invocation look like a probe failure.
  guarded[promisify.custom] = (...args) => {
    onInvoke(args[0]);
    return original[promisify.custom](...args);
  };
  return guarded;
}

export function describeCompiledFfprobePath(invokedPath, appRoot, nativePath, nativePackageRoot) {
  if (invokedPath === nativePath) {
    const packageRelative = path.relative(nativePackageRoot, invokedPath).replaceAll("\\", "/");
    requireCheck(packageRelative.startsWith("bin/") && !packageRelative.includes(".."), "FFPROBE_PATH_INVALID");
    return `node_modules/ffprobe-static/${packageRelative}`;
  }
  const relative = path.relative(appRoot, invokedPath).replaceAll("\\", "/");
  requireCheck(relative && !relative.startsWith("../") && !path.isAbsolute(relative), "FFPROBE_PATH_INVALID");
  return relative;
}

async function generateSyntheticMp3(appRequire) {
  const ffmpegPath = appRequire("ffmpeg-static");
  requireCheck(typeof ffmpegPath === "string" && existsSync(ffmpegPath), "FFMPEG_UNAVAILABLE");
  const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-compiled-upload-"));
  const output = path.join(directory, "synthetic.mp3");
  try {
    await execFileAsync(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i",
      "anullsrc=channel_layout=mono:sample_rate=8000", "-t", "2", "-c:a", "libmp3lame",
      "-b:a", "32k", "-f", "mp3", output], {
      windowsHide: true, shell: false, timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 4_096
    });
    const mp3 = await readFile(output);
    requireCheck(mp3.length > 0 && mp3.length < 128 * 1024, "SYNTHETIC_MP3_INVALID");
    return mp3;
  } finally {
    try { await unlink(output); } catch (error) {
      if (error?.code !== "ENOENT") throw new CheckFailure("TEMP_CLEANUP_FAILED");
    }
    try { await rmdir(directory); } catch { throw new CheckFailure("TEMP_CLEANUP_FAILED"); }
  }
}

async function checkCompiledBuild(appRoot = APP_ROOT) {
  requireCheck(SENSITIVE_ENV.every((name) => !Object.hasOwn(process.env, name)), "CLEAN_ENV_REQUIRED");
  const serverRoot = path.join(appRoot, ".next", "server");
  const appRequire = createRequire(path.join(appRoot, "package.json"));
  const [buildIdRaw, singleSource, bulkSource] = await Promise.all([
    readFile(path.join(appRoot, ".next", "BUILD_ID"), "utf8"),
    readFile(path.join(serverRoot, ROUTES.single), "utf8"),
    readFile(path.join(serverRoot, ROUTES.bulk), "utf8")
  ]);
  const buildId = buildIdRaw.trim();
  requireCheck(/^[A-Za-z0-9_-]{8,100}$/.test(buildId), "BUILD_ID_INVALID");
  const singleIds = parseRouteChunkIds(singleSource);
  const bulkIds = parseRouteChunkIds(bulkSource);
  const sharedIds = singleIds.filter((id) => bulkIds.includes(id));
  const candidates = [];
  for (const id of sharedIds) {
    const chunkPath = path.join(serverRoot, "chunks", `${id}.js`);
    if (!existsSync(chunkPath)) continue;
    const source = await readFile(chunkPath, "utf8");
    if (source.includes("inspectCatalogueAudio:") && source.includes("storeCatalogueTrack:")) {
      candidates.push({ id, chunkPath, source });
    }
  }
  requireCheck(candidates.length === 1, "STORAGE_CHUNK_INVALID");
  const candidate = candidates[0];
  const graphs = validateRouteGraphs(singleSource, bulkSource, candidate.id);
  const chunk = appRequire(candidate.chunkPath);
  requireCheck(chunk?.ids?.includes(candidate.id) && chunk?.modules, "STORAGE_CHUNK_INVALID");
  const moduleId = selectStorageModuleId(chunk.modules);
  const evidence = {
    schema: 1,
    check: "CATALOGUE_COMPILED_UPLOAD_PROBE",
    status: "FAIL",
    buildId,
    routeGraphs: { single: graphs.single, bulk: graphs.bulk },
    compiledStorageChunk: `chunks/${candidate.id}.js`,
    compiledStorageModuleId: moduleId,
    compiledStorageChunkSha256: sha256(candidate.source),
    singleRouteSha256: sha256(singleSource),
    bulkRouteSha256: sha256(bulkSource),
    ffprobeExecutablePresent: false,
    wavSeconds: null,
    mp3Seconds: null,
    routeHandlersInvoked: false,
    dbQueries: 0,
    r2Requests: 0,
    networkAttempts: 0
  };
  const nativeFfprobePath = appRequire("ffprobe-static")?.path;
  const nativeFfprobeRoot = path.dirname(appRequire.resolve("ffprobe-static"));
  requireCheck(typeof nativeFfprobePath === "string" && existsSync(nativeFfprobePath), "FFPROBE_UNAVAILABLE");
  const runtime = appRequire(path.join(serverRoot, "webpack-runtime.js"));
  const priorX = runtime.X;
  try {
    runtime.X = () => ({});
    appRequire(path.join(serverRoot, ROUTES.single));
    appRequire(path.join(serverRoot, ROUTES.bulk));
  } finally {
    runtime.X = priorX;
  }
  for (const id of graphs.chunks) await runtime.e(id);
  const childProcess = appRequire("node:child_process");
  const originalExecFile = childProcess.execFile;
  const invokedPaths = [];
  const priorPrisma = globalThis.prisma;
  const priorFetch = globalThis.fetch;
  const priorConnect = net.Socket.prototype.connect;
  const priorHttpRequest = http.request;
  const priorHttpGet = http.get;
  const priorHttpsRequest = https.request;
  const priorHttpsGet = https.get;
  let dbAccessAttempts = 0;
  let networkAttempts = 0;
  const denyDatabase = () => {
    dbAccessAttempts += 1;
    throw new CheckFailure("DB_ACCESS_ATTEMPTED");
  };
  const denyNetwork = () => {
    networkAttempts += 1;
    throw new CheckFailure("NETWORK_ACCESS_ATTEMPTED");
  };
  // The compiled prisma module selects global.prisma; this sentinel prevents
  // even an accidental query if the inspected function changes in the future.
  requireCheck(priorPrisma === undefined, "CLEAN_GLOBAL_REQUIRED");
  globalThis.prisma = new Proxy(Object.create(null), { get: denyDatabase, set: denyDatabase });
  globalThis.fetch = denyNetwork;
  net.Socket.prototype.connect = denyNetwork;
  http.request = denyNetwork;
  http.get = denyNetwork;
  https.request = denyNetwork;
  https.get = denyNetwork;
  childProcess.execFile = guardedExecFile(originalExecFile, (file) => invokedPaths.push(file));
  try {
    const storage = runtime(moduleId);
    requireCheck(typeof storage.inspectCatalogueAudio === "function", "STORAGE_EXPORT_INVALID");
    const wav = createSyntheticWav();
    let wavResult;
    try {
      wavResult = await storage.inspectCatalogueAudio({ buffer: wav, fileName: "synthetic.wav", claimedType: "audio/wav" });
    } catch (error) {
      throw new CheckFailure(classifyCompiledFailure(error));
    }
    evidence.wavSeconds = wavResult?.durationSeconds;
    requireCheck(evidence.wavSeconds === 2, "COMPILED_WAV_DURATION_INVALID");
    const mp3 = await generateSyntheticMp3(appRequire);
    let mp3Result;
    try {
      mp3Result = await storage.inspectCatalogueAudio({ buffer: mp3, fileName: "synthetic.mp3", claimedType: "audio/mpeg" });
    } catch (error) {
      throw new CheckFailure(classifyCompiledFailure(error));
    }
    evidence.mp3Seconds = mp3Result?.durationSeconds;
    requireCheck(evidence.mp3Seconds === 2, "COMPILED_MP3_DURATION_INVALID");
    requireCheck(invokedPaths.length === 2 && invokedPaths.every((value) => value === invokedPaths[0]),
      "FFPROBE_INVOCATION_INVALID");
    evidence.compiledFfprobePath = describeCompiledFfprobePath(invokedPaths[0], appRoot,
      nativeFfprobePath, nativeFfprobeRoot);
    evidence.ffprobeExecutablePresent = existsSync(invokedPaths[0]);
    requireCheck(evidence.ffprobeExecutablePresent, "FFPROBE_UNAVAILABLE");
    requireCheck(invokedPaths[0] === nativeFfprobePath, "FFPROBE_NOT_EXTERNAL");
    requireCheck(dbAccessAttempts === 0 && networkAttempts === 0, "EXTERNAL_ACCESS_ATTEMPTED");
    evidence.status = "PASS";
    return evidence;
  } catch (error) {
    evidence.failureCode = classifyCompiledFailure(error);
    evidence.dbQueries = dbAccessAttempts;
    evidence.r2Requests = networkAttempts;
    evidence.networkAttempts = networkAttempts;
    if (invokedPaths.length) {
      evidence.ffprobeExecutablePresent = existsSync(invokedPaths[0]);
      try {
        evidence.compiledFfprobePath = describeCompiledFfprobePath(invokedPaths[0], appRoot,
          nativeFfprobePath, nativeFfprobeRoot);
      } catch { /* fixed failure code remains above; never print an arbitrary path */ }
    }
    return evidence;
  } finally {
    childProcess.execFile = originalExecFile;
    globalThis.prisma = priorPrisma;
    globalThis.fetch = priorFetch;
    net.Socket.prototype.connect = priorConnect;
    http.request = priorHttpRequest;
    http.get = priorHttpGet;
    https.request = priorHttpsRequest;
    https.get = priorHttpsGet;
  }
}

export async function main() {
  let result;
  try {
    result = await checkCompiledBuild();
  } catch (error) {
    result = { schema: 1, check: "CATALOGUE_COMPILED_UPLOAD_PROBE", status: "FAIL",
      failureCode: classifyCompiledFailure(error) };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "PASS") process.exitCode = 1;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
