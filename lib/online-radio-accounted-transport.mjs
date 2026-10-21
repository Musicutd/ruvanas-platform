// Normal opt-in source sender. Importing this module never opens a connection.
// Counters describe local socket-write observations, never listener playback.
import net from "node:net";
import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isPrivateNetworkAddress } from "./stream-source-health.mjs";

const fail = code => Object.assign(new Error(code), { code });
const MAX_FILE_BYTES = 100 * 1024 * 1024;
export function accountedMediaIdentity(asset, organisationId) {
  const sizeBytes = Number(asset?.sizeBytes), durationSeconds = Number(asset?.durationSeconds);
  const key = typeof asset?.storageKey === "string" ? asset.storageKey : "";
  let match = null;
  if (asset?.libraryType === "RUVANAS_CATALOGUE" && asset.organisationId === null)
    match = key.match(/^catalogue\/music\/([a-f0-9]{64})\.(mp3|wav|ogg|m4a)$/);
  else if (asset?.libraryType === "ORGANISATION_MUSIC" && /^[a-z0-9]+$/i.test(organisationId || "") && asset.organisationId === organisationId) {
    const found = key.match(/^organisations\/([a-z0-9]+)\/music\/([a-f0-9]{64})\.(mp3|wav|ogg|m4a)$/i);
    if (found?.[1] === organisationId) match = [found[0], found[2], found[3]];
  }
  if (!match || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_FILE_BYTES ||
      !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86400) throw fail("ENCODER_MEDIA_IDENTITY_INVALID");
  return Object.freeze({ checksum: match[1], extension: match[2], sizeBytes, durationSeconds });
}

export async function downloadAccountedMedia(body, filePath, identity, signal) {
  if (!Number.isSafeInteger(identity?.sizeBytes) || identity.sizeBytes <= 0 || identity.sizeBytes > MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(identity?.checksum || "")) throw fail("ENCODER_MEDIA_IDENTITY_INVALID");
  const digest = createHash("sha256");
  let bytes = 0;
  const verifier = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    if (bytes > identity.sizeBytes) return done(fail("ENCODER_MEDIA_SIZE_MISMATCH"));
    digest.update(chunk); done(null, chunk);
  }, flush(done) {
    if (bytes !== identity.sizeBytes || digest.digest("hex") !== identity.checksum) return done(fail("ENCODER_MEDIA_IDENTITY_MISMATCH"));
    done();
  } });
  await pipeline(body, verifier, createWriteStream(filePath, { flags: "wx", mode: 0o600 }), { signal });
  return bytes;
}

export function validateAccountedSource(source) {
  if (source?.providerKey !== "CENTOVA_CAST" || source.outboundAutoDjEnabled !== true ||
      typeof source.serverHost !== "string" || !/^[a-z0-9.-]{1,253}$/i.test(source.serverHost) ||
      source.serverHost === "localhost" || /\.(local|internal)$/i.test(source.serverHost) ||
      !Number.isInteger(source.sourcePort) || source.sourcePort < 1 || source.sourcePort > 65535 ||
      source.sourceUsername || source.bitrateKbps !== 128 || !source.sourcePasswordEncrypted) throw fail("ENCODER_SOURCE_NOT_READY");
  return true;
}

export async function connectAccountedSource({ source, password, signal, registerResource, lookupHost = lookup, openSocket = net.createConnection }) {
  validateAccountedSource(source);
  if (typeof password !== "string" || !password.length || password.length > 512 || /[\r\n\0]/.test(password) ||
      !signal || typeof registerResource !== "function") throw fail("ENCODER_SOURCE_ARGUMENTS_INVALID");
  signal.throwIfAborted();
  const addresses = await lookupHost(source.serverHost, { all: true, family: 4, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) throw fail("ENCODER_SOURCE_ADDRESS_INVALID");
  signal.throwIfAborted();
  const socket = openSocket({ host: addresses[0].address, port: source.sourcePort });
  let errorSeen = false;
  socket.on("error", () => { errorSeen = true; });
  let isClosed = false;
  const closed = new Promise(resolve => socket.once("close", () => { isClosed = true; resolve(); }));
  const resource = { forceClose: () => socket.destroy(), close: async () => { socket.destroy(); await closed; return { closed: isClosed }; } };
  registerResource(resource);
  const abort = () => socket.destroy();
  signal.addEventListener("abort", abort, { once: true });
  const write = chunk => new Promise((resolve, reject) => {
    if (signal.aborted || errorSeen || socket.destroyed) return reject(fail("SOURCE_DISCONNECTED"));
    const complete = error => { clearTimeout(timer); socket.off("close", close); error ? reject(fail("SOURCE_DISCONNECTED")) : resolve(); };
    const close = () => complete(true);
    const timer = setTimeout(() => { complete(true); socket.destroy(); }, 2000);
    socket.once("close", close);
    socket.write(chunk, error => complete(error));
  });
  const timeout = setTimeout(abort, 8000);
  try {
    await new Promise((resolve, reject) => {
      let response = "";
      const cleanup = () => { socket.off("data", data); socket.off("error", error); socket.off("close", error); };
      const error = () => { cleanup(); reject(fail("SOURCE_AUTHENTICATION_FAILED")); };
      const data = chunk => {
        response += chunk.toString("ascii");
        if (response.length > 4096) return error();
        if (!response.includes("\n")) return;
        if (!/^OK2\r?\n/.test(response)) return error();
        cleanup(); resolve();
      };
      socket.on("data", data); socket.once("error", error); socket.once("close", error);
      socket.once("connect", () => { if (signal.aborted) return socket.destroy(); socket.write(`${password}\n`, error => { if (error) socket.destroy(); }); });
      if (signal.aborted) socket.destroy();
    });
    signal.throwIfAborted();
    await write("icy-name:Ruvanas\nicy-pub:0\nicy-br:128\ncontent-type:audio/mpeg\n\n");
    return { ...resource, authenticated: true, write, closed };
  } catch (error) { socket.destroy(); throw error; }
  finally { clearTimeout(timeout); socket.once("close", () => signal.removeEventListener("abort", abort)); }
}

export function accountedFfmpegArguments(filePath) {
  const extension = typeof filePath === "string" && filePath.match(/\.(mp3|wav|ogg|m4a)$/)?.[1];
  const demuxer = { mp3: "mp3", wav: "wav", ogg: "ogg", m4a: "mov" }[extension];
  if (!demuxer) throw fail("ENCODER_AUDIO_ARGUMENTS_INVALID");
  // No -t: an intentional truncation must never look like natural file EOF.
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-re", "-f", demuxer, "-i", filePath,
    "-vn", "-sn", "-dn", "-map", "0:a:0", "-map_metadata", "-1", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame",
    "-b:a", "128k", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1"];
}

// FFmpeg is pinned to MPEG1 Layer3, 128kbps/44.1kHz. Parse whole frames so
// reported seconds come from accepted encoded samples, not a wall-clock guess.
export function mp3FrameLength(header) {
  if (header.length < 4 || header[0] !== 255 || (header[1] & 0xfe) !== 0xfa ||
      header[2] >> 4 !== 9 || ((header[2] >> 2) & 3) !== 0 || (header[3] >> 6) > 1) throw fail("ENCODER_MP3_FRAME_INVALID");
  return Math.floor(144000 * 128 / 44100) + ((header[2] >> 1) & 1);
}

export async function sendAccountedTrack({ ffmpegPath, filePath, track, connection, signal, emit, registerResource, spawnProcess = spawn }) {
  if (connection?.authenticated !== true || typeof connection.write !== "function" || typeof emit !== "function" ||
      typeof registerResource !== "function" || !Number.isFinite(track?.durationSeconds) || track.durationSeconds <= 0 || track.durationSeconds > 86400) throw fail("ENCODER_AUDIO_ARGUMENTS_INVALID");
  signal.throwIfAborted();
  const child = spawnProcess(ffmpegPath, accountedFfmpegArguments(filePath), { windowsHide: true, shell: false,
    stdio: ["ignore", "pipe", "ignore"], env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {} });
  let childError = false, closed = false;
  child.on("error", () => { childError = true; });
  const exit = new Promise(resolve => child.once("close", code => { closed = true; resolve(childError ? -1 : code); }));
  const kill = () => { if (!closed) child.kill("SIGKILL"); };
  const unregister = registerResource({ forceClose: kill, close: async () => { kill(); await exit; return { closed }; } });
  signal.addEventListener("abort", kill, { once: true });
  let bytes = 0, frames = 0, pending = Buffer.alloc(0);
  const maximumFrames = Math.ceil((track.durationSeconds + 2) * 44100 / 1152);
  try {
    for await (const chunk of child.stdout) {
      signal.throwIfAborted();
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const length = mp3FrameLength(pending);
        if (pending.length < length) break;
        if (frames >= maximumFrames) throw fail("ENCODER_AUDIO_DURATION_MISMATCH");
        const frame = pending.subarray(0, length);
        await connection.write(frame);
        bytes += length; frames++;
        if (!await emit({ audioBytesSent: bytes, encodedSecondsSent: frames * 1152 / 44100 })) throw fail("DELIVERY_RECORD_FAILED");
        pending = pending.subarray(length);
      }
      if (pending.length > 4096) throw fail("ENCODER_MP3_FRAME_INVALID");
    }
    const code = await exit;
    signal.throwIfAborted();
    if (code !== 0 || !frames || pending.length || Math.abs(frames * 1152 / 44100 - track.durationSeconds) > 2) throw fail("SOURCE_ENCODER_FAILED");
    return { completed: true, audioBytesSent: bytes, encodedSecondsSent: frames * 1152 / 44100 };
  } finally {
    signal.removeEventListener("abort", kill); kill();
    if (closed) unregister?.();
    // Otherwise the runner retains this child until its actual close confirms
    // it is safe to release the source lease and remove cached files.
  }
}
