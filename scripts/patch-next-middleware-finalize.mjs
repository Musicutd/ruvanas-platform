import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Temporary, exact-version correction for Next's Node-middleware handoff.
// Never silently apply this to a different release or an otherwise edited file.
// Re-reviewed for the 15.5.28 security backport: next-server.js and
// body-streams.js are byte-identical to 15.5.27; the upload race remains.
export const NEXT_MIDDLEWARE_PATCH_VERSION = "15.5.28";
export const NEXT_SERVER_ORIGINAL_SHA256 = "7c97c35f81d4171ef0d5f16e18e3fe1a8e5c0bcaabf6810abdc2e92ce814a104";
const STRICT_PREFIX = '"use strict";\n';
const ORIGINAL_CALL = "                    requestData.body.finalize();";
const PATCHED_CALL = "                    await ruvanasFinalizeMiddlewareBody(requestData.body, requestData.signal, params.request.originalRequest);";
const HELPER_BEGIN = "// BEGIN RUVANAS NEXT 15.5.28 BOUNDED MIDDLEWARE FINALIZE\n";
const HELPER_END = "\n// END RUVANAS NEXT 15.5.28 BOUNDED MIDDLEWARE FINALIZE\n";
const sha256 = (source) => crypto.createHash("sha256").update(source).digest("hex");

// Kept self-contained because its exact source is injected into Next's CJS
// server. No app imports, credentials, request parsing, or security bypasses.
export async function ruvanasFinalizeMiddlewareBody(body, signal, originalRequest, timeoutMs = 300_000) {
  if (!body || typeof body.finalize !== "function" || !originalRequest ||
      typeof originalRequest.destroy !== "function" || typeof originalRequest.once !== "function" ||
      typeof originalRequest.removeListener !== "function" || !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 || timeoutMs > 300_000) {
    throw new TypeError("Invalid bounded middleware body finalization.");
  }
  let timer;
  let settled = false;
  let uploadEnded = Boolean(originalRequest.readableEnded);
  let interruptedError = null;
  let rejectInterrupted;
  const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
  const stop = (code) => {
    if (settled || interruptedError) return;
    const error = new Error(code === "RUVANAS_MIDDLEWARE_BODY_TIMEOUT" ?
      "The request upload did not finish within the middleware deadline." : "The request upload was interrupted.");
    error.code = code;
    error.statusCode = 408;
    interruptedError = error;
    rejectInterrupted(error);
    // Next's clone owns an error listener and settles its endPromise on error.
    // Destroying the original also stops accepting the stalled upload; the
    // pending finalize rejection is observed by Promise.race below.
    if (!uploadEnded) originalRequest.destroy(error);
  };
  const onAbort = () => stop("RUVANAS_MIDDLEWARE_BODY_ABORTED");
  const onError = (error) => rejectInterrupted(error);
  const onEnd = () => { uploadEnded = true; };
  const onClose = () => { if (!uploadEnded) onAbort(); };
  // Start and observe finalize even when the signal is already aborted.
  // Its synchronous throws become rejections too; none are fire-and-forget.
  const completion = Promise.resolve().then(() => body.finalize());
  originalRequest.once("aborted", onAbort);
  originalRequest.once("error", onError);
  originalRequest.once("end", onEnd);
  originalRequest.once("close", onClose);
  signal?.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => stop("RUVANAS_MIDDLEWARE_BODY_TIMEOUT"), timeoutMs);
  if (signal?.aborted || originalRequest.aborted) onAbort();
  try {
    await Promise.race([completion, interrupted]);
  } finally {
    settled = true;
    clearTimeout(timer);
    originalRequest.removeListener("aborted", onAbort);
    originalRequest.removeListener("error", onError);
    originalRequest.removeListener("end", onEnd);
    originalRequest.removeListener("close", onClose);
    signal?.removeEventListener("abort", onAbort);
  }
}

const injectedHelper = HELPER_BEGIN + ruvanasFinalizeMiddlewareBody.toString() + HELPER_END;

export function patchNextMiddlewareSource(source, version) {
  if (version !== NEXT_MIDDLEWARE_PATCH_VERSION) {
    throw new Error("Next middleware patch refused: unreviewed Next version.");
  }
  if (typeof source !== "string") throw new TypeError("Next server source must be text.");
  let original = source;
  let alreadyPatched = false;
  if (source.startsWith(STRICT_PREFIX + injectedHelper)) {
    original = STRICT_PREFIX + source.slice((STRICT_PREFIX + injectedHelper).length);
    if (original.split(PATCHED_CALL).length !== 2) throw new Error("Next middleware patch refused: patched call differs.");
    original = original.replace(PATCHED_CALL, ORIGINAL_CALL);
    alreadyPatched = true;
  }
  if (sha256(original) !== NEXT_SERVER_ORIGINAL_SHA256 ||
      !original.startsWith(STRICT_PREFIX) || original.split(ORIGINAL_CALL).length !== 2) {
    throw new Error("Next middleware patch refused: unreviewed server source checksum.");
  }
  const patched = (STRICT_PREFIX + injectedHelper + original.slice(STRICT_PREFIX.length))
    .replace(ORIGINAL_CALL, PATCHED_CALL);
  if (alreadyPatched && patched !== source) throw new Error("Next middleware patch refused: patched source differs.");
  return { source: patched, changed: !alreadyPatched, sha256: sha256(patched) };
}

export function restoreNextMiddlewareSource(source, version) {
  const verified = patchNextMiddlewareSource(source, version);
  if (verified.changed) return { source, changed: false, sha256: sha256(source) };
  const original = (STRICT_PREFIX + source.slice((STRICT_PREFIX + injectedHelper).length))
    .replace(PATCHED_CALL, ORIGINAL_CALL);
  if (sha256(original) !== NEXT_SERVER_ORIGINAL_SHA256) throw new Error("Next middleware restore refused: source checksum differs.");
  return { source: original, changed: true, sha256: sha256(original) };
}

export async function patchInstalledNext({ projectRoot = fileURLToPath(new URL("../", import.meta.url)), restore = false } = {}) {
  const nextRoot = path.join(projectRoot, "node_modules", "next");
  const metadata = JSON.parse(await readFile(path.join(nextRoot, "package.json"), "utf8"));
  if (metadata.name !== "next") throw new Error("Next middleware patch refused: unexpected package.");
  const target = path.join(nextRoot, "dist", "server", "next-server.js");
  const before = await readFile(target, "utf8");
  const result = restore ? restoreNextMiddlewareSource(before, metadata.version) : patchNextMiddlewareSource(before, metadata.version);
  if (result.changed) {
    await writeFile(target, result.source, "utf8");
    if (await readFile(target, "utf8") !== result.source) throw new Error("Next middleware patch verification failed.");
  }
  return { status: restore ? (result.changed ? "RESTORED" : "ALREADY_PRISTINE") :
    (result.changed ? "PATCHED" : "ALREADY_PATCHED"), nextVersion: metadata.version, sha256: result.sha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argumentsValid = process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--restore");
  (argumentsValid ? patchInstalledNext({ restore: process.argv[2] === "--restore" }) :
    Promise.reject(new Error("Unsupported Next middleware patch argument.")))
    .then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error instanceof Error ? error.message : "Next middleware patch failed.");
    process.exitCode = 1;
  });
}
