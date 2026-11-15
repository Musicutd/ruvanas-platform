import test from 'node:test';
import assert from 'node:assert/strict';
import { runRetailOutputSession } from '../lib/retail-stream-worker.mjs';
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from '../lib/retail-subscriber-access.mjs';

const RATE = 48000, REVISION = 'a'.repeat(64), FP = 'b'.repeat(64);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate, maximum = 5000) {
  const deadline = Date.now() + maximum;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('worker did not reach the expected state'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function fixture() {
  const assignment = { organisationId: ORG, stationId: STATION, workerId: 'srv-retail-worker-test', slot: 'retail',
    monthlyBudgetUsd: 15.75, monthlyComputeUsd: 7, monthlyOtherReserveUsd: .5, bandwidthUsdPerGB: .15, maxBitrateKbps: 128 };
  let now = Date.now(), commercialLoads = 0, measurementCalls = 0, status = 'approved', missing = false, denied = false, sequence = 0;
  const files = new Set(), events = [], observations = [], reservations = [], bytes = [], metadata = [], prepared = [], stop = new AbortController();
  let released = null, opened = 0, connected = 0, closeCalls = 0, peakFiles = 0;
  const tracks = [1, 2].map(n => ({ contentKind: 'MUSIC', fingerprint: `${n}`.repeat(64), durationSeconds: 5,
    track: { id: `music-${n}`, title: `Song ${n}`, artist: 'Artist', mediaAsset: { id: `music-media-${n}` } } }));
  const spot = { id: 'spot-1', name: 'Shop offer', version: 1, contentKind: 'COMMERCIAL', fingerprint: FP, durationSeconds: 1,
    track: { id: 'spot-1', title: 'Shop offer', artist: '', mediaAssetId: 'promo-media', mediaAsset: { id: 'promo-media' } } };
  const approval = { station: { id: STATION, organisationId: ORG, productFamily: 'RETAIL', name: 'Test Retail' }, tracks, assignment,
    grant: { id: 'retail-grant', stationId: STATION, organisationId: ORG, action: 'START', sourceFingerprint: 'retail-source', issuedAt: new Date(now - 60000).toISOString() },
    source: { stationId: STATION, serverHost: 'pollux.shoutca.st', sourcePort: 8330 } };
  const scoped = options => { assert.equal(options.organisationId, ORG); assert.equal(options.stationId, STATION); assert.equal(options.workerId, assignment.workerId); };
  const service = {
    async loadAuthorizedRetailPlayout(_db, options) { scoped(options); return approval; },
    async claimRetailPlayoutLease(_db, options) { scoped(options); return { leaseOwner: 'retail-lease' }; },
    async renewRetailPlayoutLease(_db, options) { scoped(options); return true; },
    async releaseRetailPlayoutLease(_db, options) { scoped(options); released = options; return true; },
    async reserveRetailPlayoutBytes(_db, options) {
      scoped(options); assert.equal(options.grantId, approval.grant.id); assert.equal(options.leaseOwner, 'retail-lease');
      if (denied) throw Object.assign(new Error('budget exhausted'), { code: 'RETAIL_PLAYOUT_BUDGET_EXHAUSTED' });
      reservations.push(options); return { reservedBytes: options.bytes, monthKey: options.now.toISOString().slice(0, 7) };
    },
    async recordRetailPlayoutObservation(_db, options) { scoped(options); observations.push(options); }
  };
  const options = { db: {}, service, assignment, workerId: assignment.workerId, env: {}, signal: stop.signal, ffmpegPath: '/synthetic/ffmpeg', now: () => new Date(now),
    loadSchedule: async () => ({ enabled: false }),
    loadCommercials: async (_db, input) => {
      assert.equal(input.authorized, approval); commercialLoads++;
      if (status === 'error') throw new Error('temporary commercial lookup failure');
      if (status === 'revoked') return { enabled: false, spots: [], rules: [] };
      return { enabled: true, revisionFingerprint: REVISION, effectiveAt: new Date(now - 60000).toISOString(), validUntil: new Date(now + 15000).toISOString(), timezone: 'Europe/Malta', spots: [spot],
        rules: [{ name: 'Shop messages', mode: 'EVERY_SONGS', everySongs: 1, spotIds: [spot.id], weekdays: [0, 1, 2, 3, 4, 5, 6] }] };
    },
    measureFrames: async ({ track, signal }) => { signal.throwIfAborted(); assert.equal(track.id, spot.id); measurementCalls++; return RATE; },
    openMediaSession: async () => {
      opened++;
      return { async prepare(row, signal) {
        signal.throwIfAborted(); assert.ok(tracks.includes(row) || row === spot); prepared.push(row);
        if (row === spot && missing) throw Object.assign(new Error('commercial media missing'), { code: 'RETAIL_WORKER_TRACK_CHANGED' });
        const filePath = `/synthetic/${row.track.id}-${++sequence}.wav`; files.add(filePath); peakFiles = Math.max(peakFiles, files.size);
        return { id: row.track.id, mediaAssetId: row.track.mediaAsset.id, durationSeconds: row.durationSeconds, filePath, dispose: async () => { files.delete(filePath); } };
      }, async disposeAll() { files.clear(); } };
    },
    connect: async ({ source, signal, registerResource }) => {
      connected++; assert.equal(source.sourcePort, 8330); let unregister;
      const connection = { authenticated: true, forceClose() { closeCalls++; }, async close() { closeCalls++; unregister?.(); },
        async write(chunk) { signal.throwIfAborted(); assert.ok(reservations.length, 'budget reserved before audio'); bytes.push(chunk.length); } };
      unregister = registerResource(connection); return connection;
    },
    createMetadataUpdater: () => async ({ metadata: value, signal }) => { signal.throwIfAborted(); metadata.push(value); return true; },
    log: (event, details) => events.push({ event, ...details })
  };
  return { options, files, events, observations, reservations, bytes, metadata, prepared, spot, tracks, stop,
    get now() { return now; }, advance(ms) { now += ms; }, get commercialLoads() { return commercialLoads; }, get measurementCalls() { return measurementCalls; },
    get released() { return released; }, get peakFiles() { return peakFiles; }, get opened() { return opened; }, get connected() { return connected; }, get closeCalls() { return closeCalls; },
    revoke() { status = 'revoked'; }, failLookup() { status = 'error'; }, missingMedia() { missing = true; }, denyBudget() { denied = true; } };
}
async function emitted(options, track, kind = 'MUSIC', plan = {}) {
  await options.connection.write(Buffer.alloc(384));
  options.emit({ type: 'TRACK_AUDIO_STARTED', trackId: track.id, audioBytesSent: 384, phase: kind === 'COMMERCIAL' ? 'SCHEDULED' : 'RANDOM', contentKind: kind,
    ...plan, presentationAt: new Date().toISOString(), sourceLatenessMs: 0 });
  await tick();
}
async function readyBreak(f, audio) {
  await until(() => f.measurementCalls === 1);
  await tick();
  const start = f.now;
  audio.schedule.musicStarted({ trackId: 'music-1', atMs: start, expectedEndAtMs: start + 1000, phase: 'RANDOM', contentKind: 'MUSIC', offsetFrames: 0 });
  audio.schedule.musicFinished({ trackId: 'music-1', atMs: start + 1000, phase: 'RANDOM', contentKind: 'MUSIC', offsetFrames: 0 });
  const plan = audio.schedule.planAt(start + 1000);
  assert.equal(plan.contentKind, 'COMMERCIAL'); assert.equal(plan.trackId, f.spot.id);
  const item = await audio.schedule.prepareTrack({ plan, signal: audio.signal });
  return { plan, item, start };
}

test('Retail worker measures approved spot, reserves shared source bytes, reports commercial and returns to music', { timeout: 7000 }, async () => {
  const f = fixture();
  const result = await runRetailOutputSession({ ...f.options, runAudio: async audio => {
    const first = await audio.nextTrack({ signal: audio.signal }), second = await audio.nextTrack({ signal: audio.signal });
    let spot;
    try {
      await emitted(audio, first);
      const ready = await readyBreak(f, audio); spot = ready.item;
      assert.equal(f.metadata.length, 1, 'preparing an ad must not update the listener title');
      await emitted(audio, spot, 'COMMERCIAL', ready.plan);
      assert.equal(f.metadata[1].displayTitle, 'Shop offer');
      assert.equal(audio.schedule.planAt(ready.start + 2000).phase, 'RANDOM');
      await spot.dispose(); spot = null;
      await emitted(audio, second);
      assert.equal(audio.signal.aborted, false); return { stopConfirmed: true };
    } finally { await spot?.dispose(); await first.dispose(); await second.dispose(); }
  } });
  assert.equal(result.stopConfirmed, true); assert.equal(f.measurementCalls, 1); assert.equal(f.connected, 1);
  assert.deepEqual(f.bytes, [384, 384, 384]); assert.equal(f.reservations.length, 1);
  assert.deepEqual(f.observations.filter(row => row.state === 'STREAMING').map(row => row.phase), ['RANDOM', 'COMMERCIAL', 'RANDOM']);
  const commercial = f.observations.find(row => row.phase === 'COMMERCIAL');
  assert.equal(commercial.commercialRuleName, 'Shop messages'); assert.equal(commercial.commercialRevision, REVISION);
  assert.equal(f.files.size, 0); assert.ok(f.peakFiles <= 3); assert.equal(f.released.stopConfirmed, true);
});

for (const mode of ['revoke', 'failLookup']) test(`commercial ${mode} returns to music without stopping the Retail source`, { timeout: 7000 }, async () => {
  const f = fixture();
  await runRetailOutputSession({ ...f.options, runAudio: async audio => {
    const first = await audio.nextTrack({ signal: audio.signal }), second = await audio.nextTrack({ signal: audio.signal });
    let spot;
    try {
      const ready = await readyBreak(f, audio); spot = ready.item;
      await emitted(audio, spot, 'COMMERCIAL', ready.plan);
      f[mode](); const loads = f.commercialLoads;
      await until(() => f.commercialLoads > loads); await tick();
      assert.equal(audio.signal.aborted, false); assert.equal(audio.schedule.planAt(ready.start + 1100).phase, 'RANDOM');
      await assert.rejects(audio.schedule.prepareTrack({ plan: ready.plan, signal: audio.signal }), /TRACK_CHANGED/);
      await emitted(audio, second); return { stopConfirmed: true };
    } finally { await spot?.dispose(); await first.dispose(); await second.dispose(); }
  } });
  assert.equal(f.connected, 1); assert.equal(f.released.stopConfirmed, true); assert.equal(f.files.size, 0);
  assert.ok(f.observations.some(row => row.phase === 'COMMERCIAL')); assert.equal(f.observations.filter(row => row.state === 'STREAMING').at(-1).phase, 'RANDOM');
});

test('unavailable commercial file is skipped while approved music remains usable', { timeout: 6000 }, async () => {
  const f = fixture(); f.missingMedia();
  await runRetailOutputSession({ ...f.options, runAudio: async audio => {
    const first = await audio.nextTrack({ signal: audio.signal }), second = await audio.nextTrack({ signal: audio.signal });
    try {
      await until(() => f.events.some(row => row.event === 'commercial_media_unavailable'));
      audio.schedule.musicStarted({ trackId: first.id, atMs: f.now, expectedEndAtMs: f.now + 1000, phase: 'RANDOM', contentKind: 'MUSIC' });
      audio.schedule.musicFinished({ trackId: first.id, atMs: f.now + 1000, phase: 'RANDOM', contentKind: 'MUSIC' });
      assert.equal(audio.schedule.planAt(f.now + 1000).phase, 'RANDOM'); assert.equal(audio.signal.aborted, false);
      await emitted(audio, first); await emitted(audio, second); return { stopConfirmed: true };
    } finally { await first.dispose(); await second.dispose(); }
  } });
  assert.equal(f.measurementCalls, 0); assert.deepEqual(f.bytes, [384, 384]); assert.equal(f.connected, 1); assert.equal(f.files.size, 0);
});

test('commercial source bytes cannot bypass the existing monthly reservation guard', { timeout: 6000 }, async () => {
  const f = fixture(); f.denyBudget();
  await assert.rejects(runRetailOutputSession({ ...f.options, runAudio: async audio => {
    const first = await audio.nextTrack({ signal: audio.signal }), second = await audio.nextTrack({ signal: audio.signal }); let spot;
    try { const ready = await readyBreak(f, audio); spot = ready.item; await emitted(audio, spot, 'COMMERCIAL', ready.plan); return { stopConfirmed: true }; }
    finally { await spot?.dispose(); await first.dispose(); await second.dispose(); }
  } }), error => error.code === 'RETAIL_PLAYOUT_BUDGET_EXHAUSTED');
  assert.equal(f.bytes.length, 0); assert.equal(f.metadata.length, 0); assert.equal(f.released.stopConfirmed, true); assert.equal(f.files.size, 0);
});
