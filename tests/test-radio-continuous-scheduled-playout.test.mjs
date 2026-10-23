import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runScheduledContinuousPlayout, measureContinuousAudioFrames } from '../lib/test-radio-continuous-scheduled-playout.mjs';
import { buildContinuousScheduleTimeline } from '../lib/test-radio-continuous-schedule-timeline.mjs';
const require = createRequire(import.meta.url), ffmpegPath = require('ffmpeg-static'), RATE = 48000;
function wav(frequency, seconds) {
  const frames = Math.round(seconds * RATE), bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let n = 0; n < frames; n++) { const value = Math.round(12000 * Math.sin(2 * Math.PI * frequency * n / RATE)); bytes.writeInt16LE(value, 44 + n * 4); bytes.writeInt16LE(value, 46 + n * 4); }
  return bytes;
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ruvanas-clocked-audio-'));
  const tracks = [];
  for (const [id, frequency, seconds] of [['random-a', 220, 12], ['random-b', 330, 12], ['programme-a', 660, 2.137], ['programme-b', 880, 2.263]]) {
    const filePath = path.join(directory, `${id}.wav`); await writeFile(filePath, wav(frequency, seconds));
    tracks.push({ id, mediaAssetId: id, filePath, durationSeconds: seconds, frames: Math.round(seconds * RATE), fingerprint: id, genreCodes: ['pop'] });
  }
  return { directory, tracks, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
function snapshot(start, end, tracks) {
  return { enabled: true, revisionFingerprint: 'revision', effectiveAt: new Date(start - 10000).toISOString(), validUntil: new Date(end + 60000).toISOString(),
    occurrences: [{ id: 'programme', label: 'Test programme', priority: 1, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
      config: { buildMode: 'RANDOM_GENRE_POOL', genreCodes: ['pop'] }, tracks: tracks.map(track => ({ trackId: track.id, mediaAssetId: track.id, fingerprint: track.id, genreCodes: track.genreCodes })) }] };
}
function resources() {
  const items = new Set(); let peak = 0;
  return { items, get peak() { return peak; }, registerResource: item => { items.add(item); peak = Math.max(peak, items.size); return () => items.delete(item); } };
}
function energy(pcm, second, frequency) {
  const offset = Math.floor(second * RATE), count = 2400; let re = 0, im = 0;
  for (let n = 0; n < count; n++) { const value = pcm.readInt16LE((offset + n) * 4), angle = 2 * Math.PI * frequency * n / RATE; re += value * Math.cos(angle); im += value * Math.sin(angle); }
  return Math.hypot(re, im) / count;
}

test('deterministic exact frame timeline preserves fractional durations, priority and late joins', () => {
  const tracks = [{ id: 'a', frames: 102576, genreCodes: ['pop'] }, { id: 'b', frames: 108624, genreCodes: ['pop'] }];
  const snap = snapshot(100000, 120000, tracks), lengths = new Map(tracks.map(track => [track.id, track.frames]));
  const first = buildContinuousScheduleTimeline(snap, lengths), second = buildContinuousScheduleTimeline(snap, lengths);
  for (let frame = 0; frame < 960000; frame += 137) assert.deepEqual(first.planAt(100000 + frame * 1000 / RATE), second.planAt(100000 + frame * 1000 / RATE));
  const initial = first.planAt(100000), boundary = initial.nextBoundaryAtMs;
  assert.equal(initial.offsetFrames, 0); assert.equal(first.planAt(boundary).offsetFrames, 0);
  assert.equal(first.planAt(boundary + 12345 * 1000 / RATE).offsetFrames, 12345);
  assert.equal(first.planAt(120000).phase, 'RANDOM');
  assert.equal(buildContinuousScheduleTimeline(snap, new Map()).planAt(101000).phase, 'RANDOM');
  const epoch = 1792750000000, fractional = [{ id: 'a', frames: 48101, genreCodes: ['pop'] }, { id: 'b', frames: 49999, genreCodes: ['pop'] }];
  const precise = buildContinuousScheduleTimeline(snapshot(epoch, epoch + 20000, fractional), new Map(fractional.map(track => [track.id, track.frames])));
  let instant = epoch;
  for (let index = 0; index < 12; index++) { const plan = precise.planAt(instant); assert.equal(plan.offsetFrames, 0); instant = plan.nextBoundaryAtMs; }
});

test('frame measurement counts decoded samples rather than rounded catalogue duration', { timeout: 10000 }, async () => {
  const data = await fixture(), registry = resources();
  try {
    const track = data.tracks[2];
    assert.equal(await measureContinuousAudioFrames({ ffmpegPath, track: { ...track, durationSeconds: 2.137, dispose: async () => {} },
      signal: new AbortController().signal, registerResource: registry.registerResource }), track.frames);
    assert.equal(registry.items.size, 0);
  } finally { await data.cleanup(); }
});

test('real UTC-paced encoder hard-cuts to programme and back to random on the same source', { timeout: 25000 }, async () => {
  const data = await fixture(), registry = resources(), stop = new AbortController(), output = [], events = [], writeTimes = [];
  const start = Date.now() + 5500, end = start + 4500;
  const timeline = buildContinuousScheduleTimeline(snapshot(start, end, data.tracks.slice(2)), new Map(data.tracks.map(track => [track.id, track.frames])));
  let randomIndex = 0, active = 0, peak = 0;
  const descriptor = track => { active++; peak = Math.max(peak, active); return { ...track, dispose: async () => { active--; } }; };
  const task = runScheduledContinuousPlayout({ ffmpegPath, signal: stop.signal, registerResource: registry.registerResource,
    nextTrack: async () => descriptor(data.tracks[randomIndex++ % 2]),
    schedule: { planAt: timeline.planAt, prepareTrack: async ({ plan }) => descriptor(data.tracks.find(track => track.id === plan.trackId)) },
    connection: { authenticated: true, write: async bytes => { output.push(Buffer.from(bytes)); writeTimes.push(Date.now()); } },
    emit: event => { events.push({ ...event, actualAt: Date.now() }); if (event.type === 'TRACK_AUDIO_STARTED' && event.phase === 'RANDOM' && events.some(item => item.phase === 'SCHEDULED')) setTimeout(() => stop.abort(Object.assign(new Error('done'), { code: 'TEST_DONE' })), 500); return true; }
  });
  try {
    await assert.rejects(task, error => { assert.equal(error.code, 'TEST_DONE'); assert.equal(error.stopConfirmed, true); return true; });
    const starts = events.filter(event => event.type === 'TRACK_AUDIO_STARTED');
    assert.deepEqual(starts.map(event => event.phase), ['RANDOM', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'RANDOM']);
    assert.ok(Math.abs(starts[1].actualAt - start) < 100, `start timing ${starts[1].actualAt - start} ms`);
    assert.ok(Math.abs(starts.at(-1).actualAt - end) < 100, `end timing ${starts.at(-1).actualAt - end} ms`);
    assert.ok(Math.max(...writeTimes.slice(1).map((time, index) => time - writeTimes[index])) < 150);
    assert.ok(peak <= 3); assert.ok(registry.peak <= 4); assert.equal(registry.items.size, 0); assert.equal(active, 0);
    const decoded = spawnSync(ffmpegPath, ['-v', 'error', '-f', 'mp3', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { input: Buffer.concat(output), maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    assert.equal(decoded.status, 0);
    const origin = Date.parse(starts[0].presentationAt), programmeFrequency = starts[1].trackId === 'programme-a' ? 660 : 880;
    assert.ok(energy(decoded.stdout, (start - origin) / 1000 + .1, programmeFrequency) > 4000);
    const resumedFrequency = starts.at(-1).trackId === 'random-a' ? 220 : 330;
    assert.ok(energy(decoded.stdout, (end - origin) / 1000 + .1, resumedFrequency) > 4000);
  } finally { stop.abort(); await task.catch(() => {}); await data.cleanup(); }
});

test('mid-programme restart seeks the correct decoded frame instead of replaying the first track', { timeout: 15000 }, async () => {
  const data = await fixture(), registry = resources(), stop = new AbortController(), output = [], events = [];
  const song = data.tracks[2], first = wav(660, 3), last = wav(880, 3);
  const merged = Buffer.concat([first, last.subarray(44)]); merged.writeUInt32LE(merged.length - 8, 4); merged.writeUInt32LE(merged.length - 44, 40);
  await writeFile(song.filePath, merged); song.durationSeconds = 6; song.frames = 6 * RATE;
  const start = Date.now() - 1000, timeline = buildContinuousScheduleTimeline(snapshot(start, start + 30000, [song]), new Map([[song.id, song.frames]]));
  let random = 0, active = 0;
  const descriptor = track => { active++; return { ...track, dispose: async () => { active--; } }; };
  const task = runScheduledContinuousPlayout({ ffmpegPath, signal: stop.signal, registerResource: registry.registerResource,
    nextTrack: async () => descriptor(data.tracks[random++ % 2]), schedule: { planAt: timeline.planAt, prepareTrack: async () => descriptor(song) },
    connection: { authenticated: true, write: async bytes => { output.push(Buffer.from(bytes)); } },
    emit: event => { events.push(event); if (event.type === 'TRACK_AUDIO_STARTED') setTimeout(() => stop.abort(Object.assign(new Error('done'), { code: 'TEST_DONE' })), 500); return true; }
  });
  try {
    await assert.rejects(task, error => error.code === 'TEST_DONE' && error.stopConfirmed === true);
    const firstStart = events.find(event => event.type === 'TRACK_AUDIO_STARTED'); assert.equal(firstStart.phase, 'SCHEDULED');
    const position = timeline.planAt(Date.parse(firstStart.presentationAt)); assert.ok(position.offsetFrames > 3 * RATE && position.offsetFrames < 5 * RATE);
    const decoded = spawnSync(ffmpegPath, ['-v', 'error', '-f', 'mp3', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { input: Buffer.concat(output), maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    assert.equal(decoded.status, 0); assert.ok(energy(decoded.stdout, .1, 880) > 4000); assert.ok(energy(decoded.stdout, .1, 660) < 200);
    assert.equal(active, 0); assert.equal(registry.items.size, 0);
  } finally { stop.abort(); await task.catch(() => {}); await data.cleanup(); }
});

test('missing scheduled audio falls back to approved random without a reconnect or source stall', { timeout: 12000 }, async () => {
  const data = await fixture(), registry = resources(), stop = new AbortController(), events = [], times = [];
  const start = Date.now() + 4000, timeline = buildContinuousScheduleTimeline(snapshot(start, start + 3000, data.tracks.slice(2)), new Map(data.tracks.map(track => [track.id, track.frames])));
  let index = 0, active = 0;
  const timer = setTimeout(() => stop.abort(Object.assign(new Error('done'), { code: 'TEST_DONE' })), 6500);
  try {
    await assert.rejects(runScheduledContinuousPlayout({ ffmpegPath, signal: stop.signal, registerResource: registry.registerResource,
      nextTrack: async () => { active++; return { ...data.tracks[index++ % 2], dispose: async () => { active--; } }; },
      schedule: { planAt: timeline.planAt, prepareTrack: async () => { throw new Error('storage unavailable'); } },
      connection: { authenticated: true, write: async () => { times.push(Date.now()); } }, emit: event => { events.push(event); return true; }
    }), error => error.code === 'TEST_DONE' && error.stopConfirmed === true);
    assert.equal(events.filter(event => event.type === 'SCHEDULE_FALLBACK').length, 1);
    assert.ok(events.filter(event => event.type === 'TRACK_AUDIO_STARTED').every(event => event.phase === 'RANDOM'));
    assert.ok(Math.max(...times.slice(1).map((time, index) => time - times[index])) < 150);
    assert.equal(active, 0); assert.equal(registry.items.size, 0);
  } finally { clearTimeout(timer); stop.abort(); await data.cleanup(); }
});

test('a seriously delayed source fails closed rather than sending stale scheduled audio', { timeout: 12000 }, async () => {
  const data = await fixture(), registry = resources(); let index = 0, writes = 0, active = 0;
  try {
    await assert.rejects(runScheduledContinuousPlayout({ ffmpegPath, signal: new AbortController().signal, registerResource: registry.registerResource,
      nextTrack: async () => { active++; return { ...data.tracks[index++ % 2], dispose: async () => { active--; } }; },
      schedule: { planAt: () => ({ phase: 'RANDOM', nextBoundaryAtMs: null }), prepareTrack: async () => assert.fail('no programme') },
      connection: { authenticated: true, write: async () => { if (++writes === 10) await new Promise(resolve => setTimeout(resolve, 700)); } }, emit: () => true
    }), error => { assert.equal(error.code, 'CONTINUOUS_CLOCK_OVERRUN'); assert.equal(error.stopConfirmed, true); return true; });
    assert.ok(writes <= 11); assert.equal(active, 0); assert.equal(registry.items.size, 0);
  } finally { await data.cleanup(); }
});

test('15-second snapshot renewal preserves a warmed boundary and hot disable returns to random', { timeout: 30000 }, async () => {
  const data = await fixture(), registry = resources(), stop = new AbortController(), events = [];
  const start = Date.now() + 17000, end = start + 5000, lengths = new Map(data.tracks.map(track => [track.id, track.frames]));
  let timeline, enabled = true, disabledAt = null, prepared = 0, random = 0, active = 0, peak = 0;
  const refresh = () => { const snap = snapshot(start, end, data.tracks.slice(2)); snap.enabled = enabled; snap.validUntil = new Date(Date.now() + 15000).toISOString(); timeline = buildContinuousScheduleTimeline(snap, lengths); };
  refresh(); const refreshTimer = setInterval(refresh, 3000);
  const descriptor = track => { active++; peak = Math.max(peak, active); return { ...track, dispose: async () => { active--; } }; };
  const task = runScheduledContinuousPlayout({ ffmpegPath, signal: stop.signal, registerResource: registry.registerResource,
    nextTrack: async () => descriptor(data.tracks[random++ % 2]),
    schedule: { planAt: instant => timeline.planAt(instant), prepareTrack: async ({ plan }) => { prepared++; return descriptor(data.tracks.find(track => track.id === plan.trackId)); } },
    connection: { authenticated: true, write: async () => {} },
    emit: event => {
      events.push({ ...event, actualAt: Date.now() });
      if (event.type === 'TRACK_AUDIO_STARTED' && event.phase === 'SCHEDULED') { enabled = false; disabledAt = Date.now(); refresh(); }
      if (event.type === 'TRACK_AUDIO_STARTED' && event.phase === 'RANDOM' && disabledAt) setTimeout(() => stop.abort(Object.assign(new Error('done'), { code: 'TEST_DONE' })), 100);
      return true;
    }
  });
  try {
    await assert.rejects(task, error => { assert.equal(error.code, 'TEST_DONE'); assert.equal(error.stopConfirmed, true); return true; });
    const starts = events.filter(event => event.type === 'TRACK_AUDIO_STARTED'), scheduled = starts.find(event => event.phase === 'SCHEDULED');
    assert.ok(Math.abs(scheduled.actualAt - start) < 100);
    assert.equal(starts.at(-1).phase, 'RANDOM'); assert.ok(starts.at(-1).actualAt - disabledAt < 500);
    assert.equal(events.filter(event => event.type === 'SCHEDULE_FALLBACK').length, 0);
    assert.ok(prepared <= 2, `unexpected repeated download count ${prepared}`); assert.ok(peak <= 3);
    assert.equal(active, 0); assert.equal(registry.items.size, 0);
  } finally { clearInterval(refreshTimer); stop.abort(); await task.catch(() => {}); await data.cleanup(); }
});

test('clocked random-only mode repeats two identities across five joins and ends cleanly', { timeout: 25000 }, async () => {
  const data = await fixture(), registry = resources(), activeIds = new Set(), starts = [], ends = [];
  for (let index = 0; index < 2; index++) { await writeFile(data.tracks[index].filePath, wav(index ? 330 : 220, 2)); data.tracks[index].durationSeconds = 2; }
  let selected = 0, disposed = 0;
  try {
    const result = await runScheduledContinuousPlayout({ ffmpegPath, signal: new AbortController().signal, registerResource: registry.registerResource,
      nextTrack: async () => {
        if (selected === 6) return null;
        const track = data.tracks[selected++ % 2]; assert.equal(activeIds.has(track.id), false, 'release the old identity before reselecting it'); activeIds.add(track.id);
        return { ...track, dispose: async () => { await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(activeIds.delete(track.id), true); disposed++; } };
      },
      schedule: { planAt: () => ({ phase: 'RANDOM', nextBoundaryAtMs: null }), prepareTrack: async () => assert.fail('no programme') },
      connection: { authenticated: true, write: async () => {} },
      emit: event => { if (event.type === 'TRACK_AUDIO_STARTED') starts.push(event.trackId); if (event.type === 'TRACK_ENDED') ends.push(event.trackId); return true; }
    });
    assert.equal(result.completed, true); assert.equal(result.stopConfirmed, true);
    const expected = Array.from({ length: 6 }, (_, index) => data.tracks[index % 2].id);
    assert.deepEqual(starts, expected); assert.deepEqual(ends, expected); assert.equal(disposed, 6); assert.equal(activeIds.size, 0); assert.equal(registry.items.size, 0);
  } finally { await data.cleanup(); }
});

test('uncertain scheduled preparation cleanup is never downgraded to harmless random fallback', { timeout: 10000 }, async () => {
  const data = await fixture(), registry = resources(); let random = 0, active = 0, writes = 0;
  const start = Date.now() - 1000, timeline = buildContinuousScheduleTimeline(snapshot(start, start + 30000, data.tracks.slice(2)), new Map(data.tracks.map(track => [track.id, track.frames])));
  try {
    await assert.rejects(runScheduledContinuousPlayout({ ffmpegPath, signal: new AbortController().signal, registerResource: registry.registerResource,
      nextTrack: async () => { active++; return { ...data.tracks[random++ % 2], dispose: async () => { active--; } }; },
      schedule: { planAt: timeline.planAt, prepareTrack: async () => { throw Object.assign(new Error('uncertain'), { code: 'CONTINUOUS_CHILD_STOP_UNCONFIRMED', stopConfirmed: false }); } },
      connection: { authenticated: true, write: async () => { writes++; } }, emit: () => true
    }), error => { assert.equal(error.code, 'CONTINUOUS_CHILD_STOP_UNCONFIRMED'); assert.equal(error.stopConfirmed, false); return true; });
    assert.equal(writes, 0); assert.equal(active, 0); assert.equal(registry.items.size, 0);
  } finally { await data.cleanup(); }
});

test('manual, rights and lease aborts stop clocked source writes and all decoder resources', { timeout: 18000 }, async () => {
  const data = await fixture();
  try {
    for (const code of ['MANUAL_STOP', 'RIGHTS_REVOKED', 'LEASE_LOST']) {
      const registry = resources(), stop = new AbortController(); let selected = 0, active = 0, writes = 0;
      await assert.rejects(runScheduledContinuousPlayout({ ffmpegPath, signal: stop.signal, registerResource: registry.registerResource,
        nextTrack: async () => { active++; return { ...data.tracks[selected++ % 2], dispose: async () => { active--; } }; },
        schedule: { planAt: () => ({ phase: 'RANDOM', nextBoundaryAtMs: null }), prepareTrack: async () => assert.fail('no programme') },
        connection: { authenticated: true, write: async () => { if (++writes === 10) stop.abort(Object.assign(new Error(code), { code })); } }, emit: () => true
      }), error => { assert.equal(error.code, code); assert.equal(error.stopConfirmed, true); return true; });
      assert.equal(writes, 10); assert.equal(active, 0); assert.equal(registry.items.size, 0);
    }
  } finally { await data.cleanup(); }
});
