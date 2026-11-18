// Generated tones only. No network client, database, music catalogue or secret
// is read. Audio stays in memory or a temporary directory removed on completion.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runSubscriberStreamAudio, measureSubscriberAudioFrames } from '../lib/subscriber-stream-audio.mjs';
import { buildSubscriberScheduleTimeline } from '../lib/subscriber-stream-audio-timeline.mjs';
const RATE = 48000;
function wav(frequency, seconds) {
  const frames = Math.round(RATE * seconds), output = Buffer.alloc(44 + frames * 4);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8); output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20); output.writeUInt16LE(2, 22); output.writeUInt32LE(RATE, 24); output.writeUInt32LE(RATE * 4, 28);
  output.writeUInt16LE(4, 32); output.writeUInt16LE(16, 34); output.write('data', 36); output.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { const n = Math.round(12000 * Math.sin(2 * Math.PI * frequency * i / RATE)); output.writeInt16LE(n, 44 + i * 4); output.writeInt16LE(n, 46 + i * 4); }
  return output;
}
function energy(pcm, at, frequency) {
  const offset = Math.floor(at * RATE), count = 2400; let re = 0, im = 0;
  for (let i = 0; i < count; i++) { const value = pcm.readInt16LE((offset + i) * 4), angle = 2 * Math.PI * frequency * i / RATE; re += value * Math.cos(angle); im += value * Math.sin(angle); }
  return Math.hypot(re, im) / count;
}
export async function checkRetailOffAir() {
  const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static'), directory = await mkdtemp(path.join(os.tmpdir(), 'retail-off-air-'));
  const resources = new Set(), stop = new AbortController(), tracks = [], events = [], audio = [], times = [];
  let active = 0, peak = 0, childPeak = 0, task, timer;
  const registerResource = item => { resources.add(item); childPeak = Math.max(childPeak, resources.size); return () => resources.delete(item); };
  try {
    for (const [id, frequency, seconds] of [['random-a', 220, 12], ['random-b', 330, 12], ['programme', 660, 3.137]]) {
      const filePath = path.join(directory, `${id}.wav`); await writeFile(filePath, wav(frequency, seconds));
      tracks.push({ id, mediaAssetId: id, fingerprint: id, filePath, frequency, durationSeconds: seconds, genreCodes: ['pop'] });
    }
    const programmeFrames = await measureSubscriberAudioFrames({ ffmpegPath, track: { ...tracks[2], dispose: async () => {} }, signal: stop.signal, registerResource });
    assert.equal(programmeFrames, Math.round(3.137 * RATE));
    const begins = Date.now() + 5500, ends = begins + 3500;
    const timeline = buildSubscriberScheduleTimeline({ enabled: true, revisionFingerprint: 'local-retail-fixture',
      effectiveAt: new Date(begins - 10000).toISOString(), validUntil: new Date(ends + 60000).toISOString(),
      occurrences: [{ id: 'local-programme', label: 'Synthetic Retail programme', priority: 1, startsAt: new Date(begins).toISOString(), endsAt: new Date(ends).toISOString(),
        config: { buildMode: 'RANDOM_GENRE_POOL', genreCodes: ['pop'] }, tracks: [{ trackId: tracks[2].id, mediaAssetId: tracks[2].id, fingerprint: tracks[2].id, genreCodes: ['pop'] }] }]
    }, new Map([[tracks[2].id, programmeFrames]]));
    let randomIndex = 0;
    const descriptor = track => { active++; peak = Math.max(peak, active); return { ...track, dispose: async () => { active--; } }; };
    timer = setTimeout(() => stop.abort(Object.assign(new Error('LOCAL_DEADLINE'), { code: 'LOCAL_DEADLINE' })), 15000);
    task = runSubscriberStreamAudio({ ffmpegPath, signal: stop.signal, registerResource,
      nextTrack: async () => descriptor(tracks[randomIndex++ % 2]),
      schedule: { planAt: timeline.planAt, prepareTrack: async ({ plan }) => descriptor(tracks.find(track => track.id === plan.trackId)) },
      connection: { authenticated: true, write: async bytes => { audio.push(Buffer.from(bytes)); times.push(Date.now()); } },
      emit: event => {
        events.push({ ...event, observedAt: Date.now() });
        if (event.type === 'TRACK_AUDIO_STARTED' && event.phase === 'RANDOM' && events.some(value => value.phase === 'SCHEDULED'))
          setTimeout(() => stop.abort(Object.assign(new Error('LOCAL_COMPLETE'), { code: 'LOCAL_COMPLETE' })), 500);
        return true;
      }
    });
    await assert.rejects(task, error => error.code === 'LOCAL_COMPLETE' && error.stopConfirmed === true);
    const starts = events.filter(event => event.type === 'TRACK_AUDIO_STARTED'), scheduled = starts.find(event => event.phase === 'SCHEDULED'), returned = starts.at(-1);
    assert.equal(starts[0].phase, 'RANDOM'); assert.equal(returned.phase, 'RANDOM'); assert.ok(scheduled);
    assert.equal(events.filter(event => event.type === 'SCHEDULE_FALLBACK').length, 0);
    const anchor = Date.parse(starts[0].presentationAt), startPcmErrorMs = Math.abs(anchor + scheduled.startFrame / RATE * 1000 - begins), endPcmErrorMs = Math.abs(anchor + returned.startFrame / RATE * 1000 - ends);
    assert.ok(startPcmErrorMs <= 1000 / RATE); assert.ok(endPcmErrorMs <= 1000 / RATE);
    assert.ok(Math.abs(scheduled.observedAt - begins) < 150); assert.ok(Math.abs(returned.observedAt - ends) < 150);
    const maxWriteGapMs = Math.max(...times.slice(1).map((value, index) => value - times[index])); assert.ok(maxWriteGapMs < 200);
    const decoded = spawnSync(ffmpegPath, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mp3', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
      { input: Buffer.concat(audio), maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    assert.equal(decoded.status, 0); assert.ok(energy(decoded.stdout, (begins - anchor) / 1000 + .15, 660) > 4000);
    assert.ok(energy(decoded.stdout, (ends - anchor) / 1000 + .15, tracks.find(track => track.id === returned.trackId).frequency) > 4000);
    let minimumWindowRms = Infinity;
    for (const boundary of [(begins - anchor) / 1000, (ends - anchor) / 1000]) {
      for (let offset = Math.round((boundary - .15) * RATE); offset < (boundary + .15) * RATE; offset += 960) {
        let sum = 0; for (let i = 0; i < 960; i++) sum += (decoded.stdout.readInt16LE((offset + i) * 4) / 32768) ** 2;
        minimumWindowRms = Math.min(minimumWindowRms, Math.sqrt(sum / 960));
      }
    }
    assert.ok(minimumWindowRms > .1); assert.equal(resources.size, 0); assert.equal(active, 0); assert.ok(peak <= 3); assert.ok(childPeak <= 4);
    return { checkedAt: new Date().toISOString(), scope: 'LOCAL_GENERATED_TONES_ONLY', networkConnections: 0, realMusicRead: false,
      bitrateKbps: 128, startPcmErrorMs, endPcmErrorMs, scheduledSourceLatenessMs: scheduled.observedAt - begins,
      randomResumeSourceLatenessMs: returned.observedAt - ends, maxWriteGapMs, minimumBoundaryWindowRms: minimumWindowRms,
      encodedBytes: audio.reduce((n, value) => n + value.length, 0), peakFiles: peak, peakChildren: childPeak,
      stopConfirmed: true, phaseEvents: starts.map(event => ({ phase: event.phase, trackId: event.trackId, presentationAt: event.presentationAt, sourceLatenessMs: event.sourceLatenessMs })), passed: true };
  } finally { clearTimeout(timer); stop.abort(); if (task) await task.catch(() => {}); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') { console.error('Use --run for a local generated-tone check; this script never opens a network connection.'); process.exitCode = 2; }
  else { try { console.log(JSON.stringify(await checkRetailOffAir(), null, 2)); } catch (error) { console.error(JSON.stringify({ passed: false, error: /^[A-Z_]{1,100}$/.test(error?.code || '') ? error.code : 'LOCAL_AUDIO_CHECK_FAILED' })); process.exitCode = 1; } }
}
