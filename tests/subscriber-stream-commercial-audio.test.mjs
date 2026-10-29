import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runSubscriberStreamAudio } from '../lib/subscriber-stream-audio.mjs';
import { createRetailCommercialTimeline } from '../lib/retail-commercial-timeline.mjs';

const require = createRequire(import.meta.url), ffmpegPath = require('ffmpeg-static'), RATE = 48000;
const done = () => Object.assign(new Error('test complete'), { code: 'TEST_DONE' });
function wav(frequency, seconds) {
  const frames = Math.round(seconds * RATE), bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let n = 0; n < frames; n++) {
    const value = Math.round(12000 * Math.sin(2 * Math.PI * frequency * n / RATE));
    bytes.writeInt16LE(value, 44 + n * 4); bytes.writeInt16LE(value, 46 + n * 4);
  }
  return bytes;
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ruvanas-commercial-audio-')), tracks = {};
  for (const [id, frequency, seconds] of [['music', 220, 3], ['next', 330, 10], ['spot', 880, 1], ['programme', 660, 2]]) {
    const filePath = path.join(directory, `${id}.wav`); await writeFile(filePath, wav(frequency, seconds));
    tracks[id] = { id, mediaAssetId: id, filePath, durationSeconds: seconds, frames: Math.round(seconds * RATE) };
  }
  let active = 0, peak = 0;
  const resources = new Set();
  return { tracks, descriptor: track => { active++; peak = Math.max(peak, active); return { ...track, dispose: async () => { active--; } }; },
    registerResource: item => { resources.add(item); return () => resources.delete(item); },
    clean: () => { assert.equal(active, 0); assert.equal(resources.size, 0); assert.ok(peak <= 3, `peak descriptors ${peak}`); },
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}
function planned(track, start, end, at, extra = {}) {
  return { phase: 'SCHEDULED', key: extra.key || track.id, occurrenceId: extra.occurrenceId || track.id,
    occurrenceEndsAtMs: end, nextBoundaryAtMs: end, trackId: track.id, mediaAssetId: track.mediaAssetId,
    totalFrames: track.frames, offsetFrames: Math.max(0, Math.ceil((at - start) * RATE / 1000 - .02)), ...extra };
}
function energy(pcm, second, frequency) {
  const offset = Math.floor(second * RATE), count = 2400; let re = 0, im = 0;
  for (let n = 0; n < count; n++) { const value = pcm.readInt16LE((offset + n) * 4), angle = 2 * Math.PI * frequency * n / RATE; re += value * Math.cos(angle); im += value * Math.sin(angle); }
  return Math.hypot(re, im) / count;
}

for (const rounding of [-0.05, 0.05]) test(`frequency break waits for actual music EOF despite ${rounding}s rounded metadata`, { timeout: 13000 }, async () => {
  const data = await fixture(), stop = new AbortController(), events = [], output = [], started = [], finished = [];
  data.tracks.music.durationSeconds += rounding;
  let predicted = null, actual = null, selected = 0;
  const schedule = {
    musicStarted: event => { started.push(event); if (event.trackId === 'music') predicted = event.expectedEndAtMs; },
    musicFinished: event => { finished.push(event); if (event.trackId === 'music') actual = event.atMs; },
    planAt(at) {
      const start = actual ?? predicted;
      if (start === null || at < start) return { phase: 'RANDOM', nextBoundaryAtMs: start };
      if (actual !== null && at >= actual + 1000) return { phase: 'RANDOM', nextBoundaryAtMs: null };
      return planned(data.tracks.spot, start, start + 1000, at, { contentKind: 'COMMERCIAL', afterMusic: true,
        offsetFrames: actual === null ? 0 : Math.max(0, Math.ceil((at - actual) * RATE / 1000 - .02)) });
    },
    prepareTrack: async () => data.descriptor(data.tracks.spot)
  };
  const timer = setTimeout(() => stop.abort(done()), 11000);
  try {
    await assert.rejects(runSubscriberStreamAudio({ ffmpegPath, signal: stop.signal, registerResource: data.registerResource, schedule,
      nextTrack: async () => data.descriptor(data.tracks[selected++ === 0 ? 'music' : 'next']),
      connection: { authenticated: true, write: async bytes => { output.push(Buffer.from(bytes)); } },
      emit: event => { events.push(event); if (event.type === 'TRACK_AUDIO_STARTED' && event.trackId === 'next') setTimeout(() => stop.abort(done()), 300); return true; }
    }), error => error.code === 'TEST_DONE' && error.stopConfirmed);
    const starts = events.filter(event => event.type === 'TRACK_AUDIO_STARTED');
    assert.deepEqual(starts.map(event => event.contentKind), ['MUSIC', 'COMMERCIAL', 'MUSIC']);
    assert.equal(started.length, 2); assert.equal(finished.length, 1); assert.equal(finished[0].trackId, 'music');
    assert.ok(Math.abs(actual - started[0].atMs - 3000) < .01);
    assert.ok(Math.abs(Date.parse(starts[1].presentationAt) - actual) <= 24);
    assert.ok(events.find(event => event.type === 'TRACK_ENDED' && event.trackId === 'music').completed);
    const decoded = spawnSync(ffmpegPath, ['-v', 'error', '-f', 'mp3', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
      { input: Buffer.concat(output), maxBuffer: 5 * 1024 * 1024, windowsHide: true });
    assert.equal(decoded.status, 0); assert.ok(energy(decoded.stdout, 3.2, 880) > 4000); assert.ok(energy(decoded.stdout, 4.1, 330) > 4000);
    data.clean();
  } finally { clearTimeout(timer); stop.abort(); await data.cleanup(); }
});

test('unavailable commercial preserves a playing programme and does not count interrupted music', { timeout: 14000 }, async () => {
  const data = await fixture(), stop = new AbortController(), events = [], finished = [], refused = [];
  const start = Date.now() + 4500, adStart = start + 800, end = start + 2000;
  let selected = 0;
  const schedule = {
    musicStarted: () => {}, musicFinished: value => finished.push(value), refuse: id => refused.push(id),
    planAt(at) {
      if (at < start) return { phase: 'RANDOM', nextBoundaryAtMs: start };
      if (at >= end) return { phase: 'RANDOM', nextBoundaryAtMs: null };
      if (at >= adStart && !refused.includes('spot')) return planned(data.tracks.spot, adStart, adStart + 1000, at, { contentKind: 'COMMERCIAL' });
      return planned(data.tracks.programme, start, end, at, { nextBoundaryAtMs: !refused.includes('spot') && at < adStart ? adStart : end });
    },
    prepareTrack: async ({ plan }) => { if (plan.contentKind === 'COMMERCIAL') throw new Error('spot unavailable'); return data.descriptor(data.tracks.programme); }
  };
  const timer = setTimeout(() => stop.abort(done()), 9000);
  try {
    await assert.rejects(runSubscriberStreamAudio({ ffmpegPath, signal: stop.signal, registerResource: data.registerResource, schedule,
      nextTrack: async () => data.descriptor(data.tracks[selected++ % 2 ? 'music' : 'next']),
      connection: { authenticated: true, write: async () => {} },
      emit: event => { events.push(event); if (event.type === 'TRACK_AUDIO_STARTED' && event.phase === 'RANDOM' && events.some(item => item.phase === 'SCHEDULED')) setTimeout(() => stop.abort(done()), 200); return true; }
    }), error => error.code === 'TEST_DONE' && error.stopConfirmed);
    assert.deepEqual(events.filter(event => event.type === 'TRACK_AUDIO_STARTED').map(event => event.phase), ['RANDOM', 'SCHEDULED', 'RANDOM']);
    assert.deepEqual(refused, ['spot']); assert.deepEqual(finished.map(item => item.trackId), ['programme']);
    assert.equal(events.filter(event => event.type === 'SCHEDULE_FALLBACK').length, 1);
    data.clean();
  } finally { clearTimeout(timer); stop.abort(); await data.cleanup(); }
});

test('late commercial preparation fills only one scheduled item and rejoins the same programme', { timeout: 17000 }, async () => {
  const data = await fixture(), stop = new AbortController(), events = [], refused = [];
  const start = Date.now() + 4500, adStart = start + 2000, end = start + 6000;
  let selected = 0;
  const schedule = {
    musicStarted: () => {}, musicFinished: () => {}, refuse: id => refused.push(id),
    planAt(at) {
      if (at < start) return { phase: 'RANDOM', nextBoundaryAtMs: start };
      if (at >= end) return { phase: 'RANDOM', nextBoundaryAtMs: null };
      if (at >= adStart && at < adStart + 1000 && !refused.includes('spot')) return planned(data.tracks.spot, adStart, adStart + 1000, at, { contentKind: 'COMMERCIAL' });
      const index = Math.floor((at - start) / 2000), itemStart = start + index * 2000;
      return planned(data.tracks.programme, itemStart, itemStart + 2000, at, { key: `programme-${index}`, occurrenceId: 'whole-programme' });
    },
    prepareTrack: async ({ plan }) => {
      if (plan.contentKind === 'COMMERCIAL') { await new Promise(resolve => setTimeout(resolve, Math.max(0, adStart + 300 - Date.now()))); return data.descriptor(data.tracks.spot); }
      return data.descriptor(data.tracks.programme);
    }
  };
  const timer = setTimeout(() => stop.abort(done()), 13500);
  try {
    await assert.rejects(runSubscriberStreamAudio({ ffmpegPath, signal: stop.signal, registerResource: data.registerResource, schedule,
      nextTrack: async () => data.descriptor(data.tracks[selected++ % 2 ? 'music' : 'next']),
      connection: { authenticated: true, write: async () => {} },
      emit: event => { events.push(event); if (event.type === 'TRACK_AUDIO_STARTED' && event.phase === 'RANDOM' && Date.now() >= end) setTimeout(() => stop.abort(done()), 200); return true; }
    }), error => error.code === 'TEST_DONE' && error.stopConfirmed);
    const starts = events.filter(event => event.type === 'TRACK_AUDIO_STARTED');
    assert.deepEqual(starts.map(event => event.phase), ['RANDOM', 'SCHEDULED', 'RANDOM', 'SCHEDULED', 'RANDOM']);
    assert.equal(starts[1].occurrenceId, starts[3].occurrenceId);
    assert.ok(Math.abs(Date.parse(starts[3].presentationAt) - (start + 4000)) <= 24);
    assert.ok(events.some(event => event.reasonCode === 'SUBSCRIBER_AUDIO_COMMERCIAL_RECOVERY_MUSIC_PREFETCH'));
    assert.deepEqual(refused, ['spot']); data.clean();
  } finally { clearTimeout(timer); stop.abort(); await data.cleanup(); }
});

test('actual Retail commercial controller inserts approved ordered spots into continuous decoded music', { timeout: 16000 }, async () => {
  const data = await fixture(), stop = new AbortController(), events = [], output = [], controller = createRetailCommercialTimeline();
  const second = { ...data.tracks.spot, id: 'spot-two', mediaAssetId: 'spot-two' };
  const revision = 'a'.repeat(64), fingerprint = 'b'.repeat(64), fingerprintTwo = 'c'.repeat(64), now = Date.now();
  controller.update({ enabled: true, revisionFingerprint: revision, effectiveAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 15000).toISOString(), timezone: 'Europe/Malta',
    rules: [{ name: 'Shop offers', mode: 'EVERY_SONGS', spotIds: ['spot', 'spot-two'], weekdays: [0, 1, 2, 3, 4, 5, 6], everySongs: 1 }],
    spots: [{ id: 'spot', fingerprint, track: data.tracks.spot }, { id: 'spot-two', fingerprint: fingerprintTwo, track: second }]
  }, new Map([[fingerprint, RATE], [fingerprintTwo, RATE]]));
  let selected = 0;
  const timer = setTimeout(() => stop.abort(done()), 13000);
  try {
    await assert.rejects(runSubscriberStreamAudio({ ffmpegPath, signal: stop.signal, registerResource: data.registerResource,
      nextTrack: async () => data.descriptor(data.tracks[selected++ === 0 ? 'music' : 'next']),
      schedule: { musicStarted: controller.musicStarted, musicFinished: controller.musicFinished, refuse: controller.refuse,
        planAt: at => controller.planAt(at, { phase: 'RANDOM', nextBoundaryAtMs: null }),
        prepareTrack: async ({ plan }) => data.descriptor(plan.trackId === 'spot-two' ? second : data.tracks.spot) },
      connection: { authenticated: true, write: async bytes => { output.push(Buffer.from(bytes)); } },
      emit: event => { events.push(event); if (event.type === 'TRACK_AUDIO_STARTED' && event.trackId === 'next') setTimeout(() => stop.abort(done()), 300); return true; }
    }), error => error.code === 'TEST_DONE' && error.stopConfirmed);
    const starts = events.filter(event => event.type === 'TRACK_AUDIO_STARTED');
    assert.deepEqual(starts.map(event => event.trackId), ['music', 'spot', 'spot-two', 'next']);
    assert.deepEqual(starts.map(event => event.contentKind), ['MUSIC', 'COMMERCIAL', 'COMMERCIAL', 'MUSIC']);
    assert.equal(starts[1].ruleName, 'Shop offers'); assert.equal(starts[2].commercialRevision, revision);
    assert.equal(starts[1].occurrenceId, starts[2].occurrenceId);
    assert.equal(events.filter(event => event.type === 'SCHEDULE_FALLBACK').length, 0);
    assert.deepEqual(events.filter(event => event.type === 'TRACK_ENDED' && event.contentKind === 'COMMERCIAL').map(event => event.completed), [true, true]);
    const decoded = spawnSync(ffmpegPath, ['-v', 'error', '-f', 'mp3', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
      { input: Buffer.concat(output), maxBuffer: 5 * 1024 * 1024, windowsHide: true });
    assert.equal(decoded.status, 0);
    assert.ok(energy(decoded.stdout, 2.8, 220) > 4000); assert.ok(energy(decoded.stdout, 3.2, 880) > 4000);
    assert.ok(energy(decoded.stdout, 4.2, 880) > 4000); assert.ok(energy(decoded.stdout, 5.1, 330) > 4000);
    data.clean();
  } finally { clearTimeout(timer); stop.abort(); await data.cleanup(); }
});

test('null optional commercial descriptor is refused once without a prefetch retry loop', { timeout: 10000 }, async () => {
  const data = await fixture(), stop = new AbortController(), refused = new Set(), events = [];
  const start = Date.now() + 4500; let preparations = 0, writes = 0;
  const timer = setTimeout(() => stop.abort(done()), 6000);
  try {
    await assert.rejects(runSubscriberStreamAudio({ ffmpegPath, signal: stop.signal, registerResource: data.registerResource,
      nextTrack: async () => data.descriptor(data.tracks.next),
      schedule: { refuse: id => refused.add(id),
        planAt: at => refused.has('spot') || at >= start + 1000 ? { phase: 'RANDOM', nextBoundaryAtMs: null }
          : at < start ? { phase: 'RANDOM', nextBoundaryAtMs: start }
            : planned(data.tracks.spot, start, start + 1000, at, { contentKind: 'COMMERCIAL' }),
        prepareTrack: async () => { preparations++; return null; } },
      connection: { authenticated: true, write: async () => { writes++; } }, emit: event => { events.push(event); return true; }
    }), error => error.code === 'TEST_DONE' && error.stopConfirmed);
    assert.equal(preparations, 1); assert.ok(writes > 50);
    assert.equal(events.filter(event => event.type === 'SCHEDULE_FALLBACK').length, 1);
    assert.ok(events.filter(event => event.type === 'TRACK_AUDIO_STARTED').every(event => event.contentKind === 'MUSIC'));
    data.clean();
  } finally { clearTimeout(timer); stop.abort(); await data.cleanup(); }
});

test('late-joined partial scheduled music never counts as a completed song for commercial frequency', { timeout: 12000 }, async () => {
  const data = await fixture(), stop = new AbortController(), starts = [], finished = [], events = [];
  const start = Date.now() - 4000, end = start + 10000;
  const timer = setTimeout(() => stop.abort(done()), 8500);
  try {
    await assert.rejects(runSubscriberStreamAudio({ ffmpegPath, signal: stop.signal, registerResource: data.registerResource,
      nextTrack: async () => data.descriptor(data.tracks.next),
      schedule: { musicStarted: event => starts.push(event), musicFinished: event => finished.push(event),
        planAt: at => at < end ? planned(data.tracks.next, start, end, at) : { phase: 'RANDOM', nextBoundaryAtMs: null },
        prepareTrack: async () => data.descriptor(data.tracks.next) },
      connection: { authenticated: true, write: async () => {} },
      emit: event => { events.push(event); if (event.type === 'TRACK_AUDIO_STARTED' && event.phase === 'RANDOM') setTimeout(() => stop.abort(done()), 200); return true; }
    }), error => error.code === 'TEST_DONE' && error.stopConfirmed);
    assert.deepEqual(events.filter(event => event.type === 'TRACK_AUDIO_STARTED').map(event => event.phase), ['SCHEDULED', 'RANDOM']);
    assert.ok(starts[0].offsetFrames > 0); assert.equal(finished.length, 0); data.clean();
  } finally { clearTimeout(timer); stop.abort(); await data.cleanup(); }
});

test('mid-commercial revocation rejoins the next music track without blocking its programme', { timeout: 15000 }, async () => {
  const data = await fixture(), stop = new AbortController(), events = [], refused = [];
  const start = Date.now() + 4500, adStart = start + 500, end = start + 4000;
  const spot = { ...data.tracks.programme, id: 'long-spot', mediaAssetId: 'long-spot' };
  let revoked = false, revokeTimer;
  const timer = setTimeout(() => stop.abort(done()), 11000);
  try {
    await assert.rejects(runSubscriberStreamAudio({ ffmpegPath, signal: stop.signal, registerResource: data.registerResource,
      nextTrack: async () => data.descriptor(data.tracks.next),
      schedule: { musicStarted: () => {}, musicFinished: () => {}, refuse: id => refused.push(id),
        planAt(at) {
          if (at < start) return { phase: 'RANDOM', nextBoundaryAtMs: start };
          if (at >= end) return { phase: 'RANDOM', nextBoundaryAtMs: null };
          if (!revoked && at >= adStart && at < adStart + 2000) return planned(spot, adStart, adStart + 2000, at, { contentKind: 'COMMERCIAL' });
          const index = Math.floor((at - start) / 2000), itemStart = start + index * 2000;
          return planned(data.tracks.programme, itemStart, itemStart + 2000, at, { key: `music-${index}`, occurrenceId: 'programme-all',
            nextBoundaryAtMs: !revoked && at < adStart ? adStart : itemStart + 2000 });
        },
        prepareTrack: async ({ plan }) => data.descriptor(plan.contentKind === 'COMMERCIAL' ? spot : data.tracks.programme) },
      connection: { authenticated: true, write: async () => {} },
      emit: event => {
        events.push(event);
        if (event.type === 'TRACK_AUDIO_STARTED' && event.contentKind === 'COMMERCIAL') revokeTimer = setTimeout(() => { revoked = true; }, 250);
        if (event.type === 'TRACK_AUDIO_STARTED' && event.phase === 'RANDOM' && Date.now() >= end) setTimeout(() => stop.abort(done()), 200);
        return true;
      }
    }), error => error.code === 'TEST_DONE' && error.stopConfirmed);
    const starts = events.filter(event => event.type === 'TRACK_AUDIO_STARTED');
    assert.deepEqual(starts.map(event => event.contentKind === 'COMMERCIAL' ? 'COMMERCIAL' : event.phase), ['RANDOM', 'SCHEDULED', 'COMMERCIAL', 'RANDOM', 'SCHEDULED', 'RANDOM']);
    assert.equal(starts[1].occurrenceId, starts[4].occurrenceId);
    assert.ok(Math.abs(Date.parse(starts[4].presentationAt) - (start + 2000)) <= 24);
    assert.ok(events.some(event => event.reasonCode === 'SUBSCRIBER_AUDIO_COMMERCIAL_RECOVERY_MUSIC_PREFETCH'));
    assert.deepEqual(refused, []); data.clean();
  } finally { clearTimeout(timer); clearTimeout(revokeTimer); stop.abort(); await data.cleanup(); }
});
