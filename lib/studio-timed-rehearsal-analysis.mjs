// Inspect only deliberately generated, self-owned test tones decoded to mono
// 16-bit little-endian PCM at 16 kHz. This cannot establish recording origin,
// rights, a live encoder connection or listener proof.
import { TIMED_PLAYLIST_CROSSFADE_SECONDS } from "./timed-playlist-generator.mjs";

const RATE = 16_000;
const WINDOW_SECONDS = 0.25;
const WINDOW_SAMPLES = RATE * WINDOW_SECONDS;
const MAX_SECONDS = 120;
const PRESENCE_FRACTION = 0.18;
// Gradual fade-in makes spectral presence detectable after the actual start.
// This is a coarse boundary check, not a sample-accurate crossfade measurement.
const BOUNDARY_TOLERANCE_SECONDS = 1;

function toneFraction(pcm, sampleOffset, frequency, energy) {
  let cosine = 0;
  let sine = 0;
  const step = 2 * Math.PI * frequency / RATE;
  for (let index = 0; index < WINDOW_SAMPLES; index += 1) {
    const sample = pcm.readInt16LE((sampleOffset + index) * 2) / 32768;
    cosine += sample * Math.cos(step * index);
    sine += sample * Math.sin(step * index);
  }
  return Math.min(1, 2 * (cosine * cosine + sine * sine) / (WINDOW_SAMPLES * energy));
}

function result(matches, reason, observedStarts = [], overlaps = []) {
  return { matches, reason, observedStarts, overlaps, sampleRateHz: RATE,
    boundaryToleranceSeconds: BOUNDARY_TOLERANCE_SECONDS,
    interpretation: "LOCAL_FILE_SAMPLE_ONLY", listenerVerified: false };
}

export function analyzeTimedRehearsalPcm(pcm, { expectedOrder, toneHzByTrackId }) {
  if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0 || pcm.length < RATE * 2 * 2 ||
      pcm.length > RATE * 2 * MAX_SECONDS || !Array.isArray(expectedOrder) ||
      expectedOrder.length < 2 || expectedOrder.length > 30 || !(toneHzByTrackId instanceof Map)) {
    throw new Error("Use 2–120 seconds of 16 kHz mono s16le test audio and a bounded frozen order.");
  }
  const frequencies = new Map();
  let previousEnd = 0;
  for (const [position, item] of expectedOrder.entries()) {
    const frequency = toneHzByTrackId.get(item?.trackId);
    const expectedStart = position === 0 ? 0 : previousEnd - TIMED_PLAYLIST_CROSSFADE_SECONDS;
    if (item?.position !== position || typeof item.trackId !== "string" || !item.trackId ||
        !Number.isInteger(item.startOffsetSeconds) || item.startOffsetSeconds !== expectedStart ||
        !Number.isInteger(item.endOffsetSeconds) || item.endOffsetSeconds <= previousEnd ||
        item.endOffsetSeconds > MAX_SECONDS ||
        !Number.isInteger(frequency) || frequency < 100 || frequency > 3000 || frequency % 4 !== 0) {
      throw new Error("The isolated tone mapping or frozen order is invalid.");
    }
    previousEnd = item.endOffsetSeconds;
    frequencies.set(item.trackId, frequency);
  }
  if (new Set(frequencies.values()).size !== frequencies.size) throw new Error("Each test track needs a distinct tone.");
  if (Math.abs(pcm.length / 2 / RATE - previousEnd) > 0.5) return result(false, "DURATION_MISMATCH");
  const windows = [];
  for (let offset = 0; offset + WINDOW_SAMPLES <= pcm.length / 2; offset += WINDOW_SAMPLES) {
    let energy = 0;
    for (let index = 0; index < WINDOW_SAMPLES; index += 1) {
      const sample = pcm.readInt16LE((offset + index) * 2) / 32768;
      energy += sample * sample;
    }
    const present = new Set();
    if (Math.sqrt(energy / WINDOW_SAMPLES) >= 0.015) {
      for (const [trackId, frequency] of frequencies) {
        if (toneFraction(pcm, offset, frequency, energy) >= PRESENCE_FRACTION) present.add(trackId);
      }
    }
    windows.push({ atSeconds: offset / RATE, present, loud: Math.sqrt(energy / WINDOW_SAMPLES) >= 0.03 });
  }
  // A one-window spectral dip is not a new play event. Longer gaps separate
  // distinct occurrences of the same test track, including A-B-A repeats.
  for (const trackId of frequencies.keys()) {
    for (let index = 1; index < windows.length - 1; index += 1) {
      if (windows[index - 1].present.has(trackId) && windows[index + 1].present.has(trackId)) windows[index].present.add(trackId);
    }
  }
  const observedStarts = [];
  for (const trackId of frequencies.keys()) {
    for (const [index, window] of windows.entries()) {
      if (window.present.has(trackId) && (index === 0 || !windows[index - 1].present.has(trackId))) {
        observedStarts.push({ trackId, atSeconds: window.atSeconds });
      }
    }
  }
  observedStarts.sort((left, right) => left.atSeconds - right.atSeconds || left.trackId.localeCompare(right.trackId));
  if (observedStarts.length !== expectedOrder.length || observedStarts.some((event, index) =>
    event.trackId !== expectedOrder[index].trackId ||
    Math.abs(event.atSeconds - expectedOrder[index].startOffsetSeconds) > BOUNDARY_TOLERANCE_SECONDS)) {
    return result(false, "ORDER_OR_BOUNDARY_MISMATCH", observedStarts);
  }
  const overlaps = [];
  for (let index = 1; index < expectedOrder.length; index += 1) {
    const previous = expectedOrder[index - 1].trackId;
    const current = expectedOrder[index].trackId;
    const start = expectedOrder[index].startOffsetSeconds;
    const audibleOverlapWindows = windows.filter((window) =>
      window.atSeconds >= start && window.atSeconds < start + 2 &&
      window.present.has(previous) && window.present.has(current)).length;
    const detected = previous !== current && audibleOverlapWindows >= 2;
    overlaps.push({ from: previous, to: current, detected });
  }
  if (overlaps.some((overlap) => !overlap.detected)) return result(false, "CROSSFADE_NOT_DETECTED", observedStarts, overlaps);
  if (windows.some((window) => window.loud && window.present.size === 0)) {
    return result(false, "UNRECOGNISED_AUDIO", observedStarts, overlaps);
  }
  return result(true, "LOCAL_SEQUENCE_MATCH_ONLY", observedStarts, overlaps);
}
