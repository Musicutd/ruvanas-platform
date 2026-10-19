import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  classifyCompiledFailure,
  createSyntheticWav,
  describeCompiledFfprobePath,
  guardedExecFile,
  parseRouteChunkIds,
  selectStorageModuleId,
  validateRouteGraphs
} from "../scripts/check-catalogue-upload-probe.mjs";

const single = "var b=require('webpack-runtime');b.C(a);b.X(0,[11,22,33],()=>b(b.s=44)); storeCatalogueTrack";
const bulk = "var b=require('webpack-runtime');b.C(a);b.X(0,[11,22,33],()=>b(b.s=55)); inspectCatalogueAudio storeCatalogueTrack";

test("compiled route chunk parser accepts one finite graph only", () => {
  assert.deepEqual(parseRouteChunkIds(single), [11, 22, 33]);
  assert.throws(() => parseRouteChunkIds("b.X(0,[11,11],()=>0)"), { code: "ROUTE_GRAPH_INVALID" });
  assert.throws(() => parseRouteChunkIds("b.X(0,[11],()=>0);b.X(0,[12],()=>0)"), { code: "ROUTE_GRAPH_INVALID" });
  assert.throws(() => parseRouteChunkIds("b.X(0,[bad],()=>0)"), { code: "ROUTE_GRAPH_INVALID" });
});

test("both compiled route graphs must bind the same storage chunk and exports", () => {
  assert.deepEqual(validateRouteGraphs(single, bulk, 22), {
    single: true, bulk: true, chunks: [11, 22, 33]
  });
  assert.throws(() => validateRouteGraphs(single, bulk.replace("22,", "24,"), 22),
    { code: "STORAGE_NOT_IN_BOTH_ROUTES" });
  assert.throws(() => validateRouteGraphs(single, bulk.replace("inspectCatalogueAudio", "missing"), 22),
    { code: "UPLOAD_EXPORTS_NOT_IN_BOTH_ROUTES" });
});

test("storage module selector rejects missing or ambiguous compiled exports", () => {
  const factory = function moduleFactory() {
    return { inspectCatalogueAudio:()=>1, storeCatalogueTrack:()=>2 };
  };
  assert.equal(selectStorageModuleId({ 3059: factory }), 3059);
  assert.throws(() => selectStorageModuleId({ 0: factory }), { code: "STORAGE_MODULE_INVALID" });
  assert.throws(() => selectStorageModuleId({ 1: factory, 2: factory }),
    { code: "STORAGE_MODULE_INVALID" });
});

test("two-second in-memory WAV is structurally valid and bounded", () => {
  const wav = createSyntheticWav();
  assert.equal(wav.length, 32_044);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 8_000);
  assert.equal(wav.readUInt32LE(40), 32_000);
  assert.throws(() => createSyntheticWav(3), { code: "SYNTHETIC_AUDIO_INVALID" });
});

test("compiled ffprobe path distinguishes packaged binary from misplaced bundled path", () => {
  const appRoot = path.join("C:", "workspace", "app");
  const packageRoot = path.join("C:", "workspace", "dependencies", "ffprobe-static");
  const nativePath = path.join(packageRoot, "bin", "win32", "x64", "ffprobe.exe");
  assert.equal(describeCompiledFfprobePath(nativePath, appRoot, nativePath, packageRoot),
    "node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe");
  assert.equal(describeCompiledFfprobePath(path.join(appRoot, ".next", "server", "chunks", "bin", "ffprobe.exe"),
    appRoot, nativePath, packageRoot), ".next/server/chunks/bin/ffprobe.exe");
  assert.throws(() => describeCompiledFfprobePath(path.join("C:", "other", "ffprobe.exe"),
    appRoot, nativePath, packageRoot), { code: "FFPROBE_PATH_INVALID" });
});

test("duration-probe failures are reduced to fixed non-sensitive codes", () => {
  assert.equal(classifyCompiledFailure({ code: "CATALOGUE_DURATION_UNVERIFIED", message: "private path" }),
    "COMPILED_AUDIO_UNVERIFIED");
  assert.equal(classifyCompiledFailure(new Error("private path")), "COMPILED_CHECK_FAILED");
});

test("execFile guard preserves Node's structured custom promisifier", async () => {
  const files = [];
  const original = function originalExecFile(file, options, callback) {
    callback(null, "output", "");
    return { pid: 1 };
  };
  original[promisify.custom] = async (file) => ({ stdout: "output", stderr: "" });
  const guarded = guardedExecFile(original, (file) => files.push(file));
  assert.deepEqual(await promisify(guarded)("synthetic-ffprobe"), { stdout: "output", stderr: "" });
  assert.deepEqual(files, ["synthetic-ffprobe"]);
});
