// Test-only transport. Importing this file never connects or starts a process.
// Every socket/decoder is registered with the independent session watchdog.
import net from "node:net";
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { isPrivateNetworkAddress } from "./stream-source-health.mjs";

const fail = code => Object.assign(new Error(code), { code });
export const CATALOGUE_TEST_SOURCE = Object.freeze({ host: "pollux.shoutca.st", port: 8282, bitrateKbps: 128 });

export function catalogueTestMediaIdentity(asset) {
  const match = typeof asset?.storageKey === "string" && asset.storageKey.match(/^catalogue\/music\/([a-f0-9]{64})\.(mp3|wav|ogg|m4a)$/);
  const size = Number(asset?.sizeBytes);
  if (!match || asset?.libraryType !== "RUVANAS_CATALOGUE" || asset.organisationId !== null ||
      !Number.isSafeInteger(size) || size < 1 || size > 50 * 1024 * 1024) throw fail("TEST_MEDIA_IDENTITY_INVALID");
  return { checksum: match[1], extension: match[2], sizeBytes: size };
}

export async function downloadCatalogueTestMedia(body, filePath, asset, { signal }) {
  const identity = catalogueTestMediaIdentity(asset);
  const digest = createHash("sha256");
  let bytes = 0;
  const checked = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > identity.sizeBytes) return callback(fail("TEST_MEDIA_SIZE_MISMATCH"));
    digest.update(chunk); callback(null, chunk);
  } });
  await pipeline(body, checked, createWriteStream(filePath, { flags: "wx", mode: 0o600 }), { signal });
  if (bytes !== identity.sizeBytes || digest.digest("hex") !== identity.checksum) throw fail("TEST_MEDIA_CHECKSUM_MISMATCH");
  return bytes;
}

export function validateCatalogueTestTarget(source) {
  if (source?.providerKey !== "CENTOVA_CAST" || source.serverHost !== CATALOGUE_TEST_SOURCE.host ||
      source.sourcePort !== CATALOGUE_TEST_SOURCE.port || source.bitrateKbps !== CATALOGUE_TEST_SOURCE.bitrateKbps ||
      source.sourceUsername || source.centovaUsername !== "ruvanas_test_radio" || source.outboundAutoDjEnabled !== false ||
      !source.sourcePasswordEncrypted || source.lastError === "CATALOGUE_TEST_STOP_UNCONFIRMED") throw fail("TEST_SOURCE_NOT_READY");
  return true;
}

// Accept only the documented Shoutcast v1 success token, not a substring of
// an error. Never record the authentication response or credential in logs.
export function shoutcastTestResponseAccepted(buffer) {
  return /^OK2\r?\n/.test(String(buffer));
}

export async function connectCatalogueTestSource({ source, password, signal, registerResource }) {
  validateCatalogueTestTarget(source);
  if (typeof password !== "string" || password.length < 1 || password.length > 512 || /[\r\n\0]/.test(password)) throw fail("TEST_SOURCE_CREDENTIAL_INVALID");
  if (typeof registerResource !== "function") throw fail("TEST_WATCHDOG_REQUIRED");
  signal.throwIfAborted();
  const addresses = await lookup(CATALOGUE_TEST_SOURCE.host, { all: true, family: 4, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) throw fail("TEST_SOURCE_ADDRESS_INVALID");
  signal.throwIfAborted();
  const socket = net.createConnection({ host: addresses[0].address, port: CATALOGUE_TEST_SOURCE.port });
  // Keep a permanent error listener: a late socket failure must not become an
  // unhandled process exception after an awaiting operation has settled.
  let socketError = null;
  socket.on("error", () => { socketError = fail("TEST_SOURCE_DISCONNECTED"); });
  const closed = new Promise(resolve => socket.once("close", resolve));
  const resource = { forceClose: () => socket.destroy(), close: async () => { socket.destroy(); await closed; } };
  registerResource(resource);
  const aborted = () => socket.destroy(fail("TEST_ABORTED"));
  signal.addEventListener("abort", aborted, { once: true });
  const timeout = setTimeout(() => socket.destroy(fail("TEST_SOURCE_TIMEOUT")), 8000);
  timeout.unref?.();
  try {
    await new Promise((resolve, reject) => {
      let response = "";
      const cleanup = () => { socket.off("data", data); socket.off("error", error); socket.off("close", close); };
      const error = () => { cleanup(); reject(fail("TEST_SOURCE_CONNECTION_FAILED")); };
      const close = () => { cleanup(); reject(fail("TEST_SOURCE_DISCONNECTED")); };
      const data = chunk => {
        response += chunk.toString("ascii");
        if (response.length > 4096) return error();
        if (!response.includes("\n")) return;
        if (!shoutcastTestResponseAccepted(response)) return error();
        cleanup(); resolve();
      };
      socket.on("data", data); socket.once("error", error); socket.once("close", close);
      socket.once("connect", () => socket.write(`${password}\n`, error => { if (error) socket.destroy(); }));
      if (signal.aborted) socket.destroy();
    });
    signal.throwIfAborted();
    await new Promise((resolve, reject) => socket.write("icy-name:Ruvanas Test Radio\nicy-pub:0\nicy-br:128\ncontent-type:audio/mpeg\n\n", error => error ? reject(fail("TEST_SOURCE_DISCONNECTED")) : resolve()));
    return { ...resource, authenticated: true, socket, hasError: () => Boolean(socketError || socket.destroyed),
      // This is kernel-accepted source data, not proof of remote playback.
      write: chunk => new Promise((resolve, reject) => {
        if (signal.aborted || socketError || socket.destroyed) return reject(fail("TEST_SOURCE_DISCONNECTED"));
        const onClose = () => { socket.off("close", onClose); reject(fail("TEST_SOURCE_DISCONNECTED")); };
        socket.once("close", onClose);
        socket.write(chunk, error => { socket.off("close", onClose); error ? reject(fail("TEST_SOURCE_DISCONNECTED")) : resolve(); });
      }) };
  } catch (error) {
    socket.destroy(); throw error;
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", aborted); }
}

export function catalogueTestFfmpegArguments(filePath, playSeconds) {
  if (typeof filePath !== "string" || !Number.isFinite(playSeconds) || playSeconds <= 0 || playSeconds > 300) throw fail("TEST_AUDIO_ARGUMENTS_INVALID");
  const extension = filePath.match(/\.(mp3|wav|ogg|m4a)$/)?.[1];
  const demuxer = { mp3: "mp3", wav: "wav", ogg: "ogg", m4a: "mov" }[extension];
  if (!demuxer) throw fail("TEST_AUDIO_ARGUMENTS_INVALID");
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-re", "-f", demuxer, "-i", filePath,
    "-t", String(playSeconds), "-vn", "-sn", "-dn", "-map", "0:a:0", "-map_metadata", "-1", "-ac", "2", "-ar", "44100",
    "-c:a", "libmp3lame", "-b:a", "128k", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1"];
}

export function watchCatalogueTestChild(child, registerResource) {
  let ended = false, failed = false;
  // 'error' may mean a failed kill of a STILL RUNNING process. Only the
  // actual close event confirms exit and permits file cleanup/lease release.
  child.on("error", () => { failed = true; });
  const exit = new Promise(resolve => child.once("close", code => { ended = true; resolve(failed ? -1 : code); }));
  const kill = () => { if (!ended) child.kill("SIGKILL"); };
  registerResource({ forceClose: kill, close: async () => { kill(); await exit; } });
  return { exit, kill };
}

export async function sendCatalogueTestTrack({ ffmpegPath, filePath, track, connection, signal, emit, registerResource }) {
  if (connection?.authenticated !== true || typeof connection.write !== "function" || typeof registerResource !== "function") throw fail("TEST_SOURCE_NOT_AUTHENTICATED");
  signal.throwIfAborted();
  // No network URLs, passwords, database/storage credentials or inherited
  // FFmpeg options enter the child process. Only a verified local media file.
  const child = spawn(ffmpegPath, catalogueTestFfmpegArguments(filePath, track.durationSeconds), {
    stdio: ["ignore", "pipe", "ignore"], windowsHide: true, shell: false,
    env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}
  });
  const { exit, kill } = watchCatalogueTestChild(child, registerResource);
  signal.addEventListener("abort", kill, { once: true });
  let audioBytesSent = 0;
  try {
    for await (const chunk of child.stdout) {
      signal.throwIfAborted();
      await connection.write(chunk);
      audioBytesSent += chunk.length;
      if (!await emit({ type: "AUDIO_SENT", trackId: track.id, audioBytesSent })) throw fail("TEST_EVENT_NOT_RECORDED");
    }
    const code = await exit;
    signal.throwIfAborted();
    if (code !== 0 || !audioBytesSent) throw fail("TEST_AUDIO_ENCODER_FAILED");
    return { audioBytesSent, completed: true };
  } finally { signal.removeEventListener("abort", kill); kill(); }
}
