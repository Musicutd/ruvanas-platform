// Pure local playout: the caller owns approval, downloads, source connection,
// lease checks, accounting and retries. This module never opens a network socket.
import path from "node:path";

const SAMPLE_RATE = 48_000, FRAME_BYTES = 4, CHUNK_LIMIT = 256 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024, MAX_TRACK_SECONDS = 3600;
const demuxers = { mp3: "mp3", wav: "wav", ogg: "ogg", m4a: "mov" };
const failure = code => Object.assign(new Error(code), { code });
const localFile = value => typeof value === "string" && path.isAbsolute(value) &&
  !/^[\\/]{2}/.test(value) && !/[\0\r\n]/.test(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);

export function subscriberAudioDecodeArguments(filePath, durationSeconds) {
  const demuxer = demuxers[path.extname(filePath || "").slice(1).toLowerCase()];
  if (!localFile(filePath) || !demuxer || !Number.isFinite(durationSeconds) || durationSeconds < 0.25 || durationSeconds > MAX_TRACK_SECONDS) {
    throw failure("SUBSCRIBER_AUDIO_TRACK_INVALID");
  }
  // Duration is an already verified safety ceiling, not a playlist clip. A normal
  // recording ends naturally; a file exceeding its approved duration fails closed.
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-f", demuxer,
    "-i", filePath, "-t", String(durationSeconds + 2), "-vn", "-sn", "-dn", "-map", "0:a:0", "-map_metadata", "-1",
    "-ac", "2", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"];
}

export function subscriberAudioEncoderArguments() {
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-re",
    "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0", "-vn", "-sn", "-dn",
    "-map", "0:a:0", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "128k",
    "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1"];
}

// A fresh approved catalogue must be supplied by the caller; this helper grants
// no access. A shuffle bag avoids repeats until the eligible bag is exhausted.
export function createSubscriberShuffleSelector({ random = Math.random } = {}) {
  let remaining = [], lastId = null;
  return tracks => {
    if (!Array.isArray(tracks) || tracks.length > 100_000 || tracks.some(track => !track || typeof track.id !== "string")) {
      throw failure("SUBSCRIBER_AUDIO_CATALOGUE_INVALID");
    }
    const byId = new Map(tracks.map(track => [track.id, track]));
    if (byId.size !== tracks.length) throw failure("SUBSCRIBER_AUDIO_CATALOGUE_INVALID");
    remaining = remaining.filter(id => byId.has(id));
    if (!remaining.length) {
      remaining = [...byId.keys()];
      for (let index = remaining.length - 1; index > 0; index--) {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw failure("SUBSCRIBER_AUDIO_RANDOM_INVALID");
        const other = Math.floor(value * (index + 1));
        [remaining[index], remaining[other]] = [remaining[other], remaining[index]];
      }
      if (remaining.length > 1 && remaining.at(-1) === lastId) [remaining[0], remaining[remaining.length - 1]] = [remaining.at(-1), remaining[0]];
    }
    const selected = remaining.pop();
    if (selected === undefined) return null;
    lastId = selected;
    return byId.get(selected);
  };
}

export function createSubscriberMp3Parser() {
  let pending = Buffer.alloc(0), frameIndex = 0;
  return {
    push(chunk) {
      if (!Buffer.isBuffer(chunk) || chunk.length > CHUNK_LIMIT) throw failure("SUBSCRIBER_AUDIO_MP3_INVALID");
      pending = Buffer.concat([pending, chunk]);
      const frames = [];
      while (pending.length >= 4) {
        const [a, b, c, d] = pending;
        if (a !== 255 || (b & 224) !== 224 || ((b >> 3) & 3) !== 3 || ((b >> 1) & 3) !== 1 ||
            (c >> 4) !== 9 || ((c >> 2) & 3) !== 1 || (d >> 6) === 3) throw failure("SUBSCRIBER_AUDIO_MP3_INVALID");
        const length = 384 + ((c >> 1) & 1);
        if (pending.length < length) break;
        if (!Number.isSafeInteger((frameIndex + 1) * 1152)) throw failure("SUBSCRIBER_AUDIO_FRAME_LIMIT");
        frames.push({ bytes: pending.subarray(0, length), startFrame: frameIndex++ * 1152 });
        pending = pending.subarray(length);
      }
      return frames;
    },
    finish() {
      if (pending.length || !frameIndex) throw failure("SUBSCRIBER_AUDIO_MP3_INCOMPLETE");
      return frameIndex;
    },
    get bufferedBytes() { return pending.length; }
  };
}

