import test from 'node:test';
import assert from 'node:assert/strict';
import { retailWorkerMode, retailPrivateDatabase, retailWorkerCode, runRetailOutputSession } from '../lib/retail-stream-worker.mjs';

const failure = code => Object.assign(new Error(code), { code });
const assignment = suffix => ({ organisationId: `org-${suffix}`, stationId: `station-${suffix}`, workerId: 'srv-retail-pool', slot: suffix,
  monthlyBudgetUsd: 15, monthlyComputeUsd: 7, monthlyOtherReserveUsd: .5, bandwidthUsdPerGB: .15, maxBitrateKbps: 128 });
const abortWait = signal => new Promise((_, reject) => { if (signal.aborted) return reject(signal.reason); signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });

function fixture(suffix = 'a') {
  const assigned = assignment(suffix), stop = new AbortController();
  const calls = [], observations = [], logs = [], allocations = [], files = new Set(), sent = [];
  let opened = 0, connected = 0, closed = 0, revoked = false, sourceChanged = false, budgetDenied = false, uncertain = false, released;
  const tracks = [1, 2].map(n => ({ track: { id: `${suffix}-track-${n}`, mediaAsset: { id: `${suffix}-asset-${n}` } }, fingerprint: `${suffix}-${n}`, durationSeconds: 5 }));
  const grant = { id: `grant-${suffix}`, sourceFingerprint: `source-${suffix}` };
  const approval = { grant, station: { id: assigned.stationId, organisationId: assigned.organisationId, name: `Retail ${suffix}` },
    source: { serverHost: `retail-${suffix}.example.com`, sourcePort: 8330 }, tracks, assignment: assigned };
  function scoped(name, options) {
    assert.equal(options.organisationId, assigned.organisationId); assert.equal(options.stationId, assigned.stationId);
    assert.equal(options.workerId, assigned.workerId); calls.push(name);
  }
  const service = {
    async loadAuthorizedRetailPlayout(_db, options) { scoped('load', options); if (revoked) throw failure('RETAIL_PLAYOUT_OWNER_REVOKED'); return sourceChanged ? { ...approval, grant: { ...grant, sourceFingerprint: 'different' } } : approval; },
    async claimRetailPlayoutLease(_db, options) { scoped('claim', options); assert.equal(options.grantId, grant.id); return { leaseOwner: `lease-${suffix}` }; },
    async renewRetailPlayoutLease(_db, options) { scoped('renew', options); assert.equal(options.leaseOwner, `lease-${suffix}`); return true; },
    async releaseRetailPlayoutLease(_db, options) { scoped('release', options); released = options; return true; },
    async reserveRetailPlayoutBytes(_db, options) { scoped('reserve', options); if (budgetDenied) throw failure('RETAIL_PLAYOUT_BUDGET_EXHAUSTED'); allocations.push(options); return { reservedBytes: options.bytes, monthKey: options.now.toISOString().slice(0, 7) }; },
    async recordRetailPlayoutObservation(_db, options) { scoped('observe', options); observations.push(options); }
  };
  const options = { db: {}, service, assignment: assigned, workerId: assigned.workerId, env: {}, signal: stop.signal, ffmpegPath: '/synthetic/ffmpeg',
    openMediaSession: async () => {
      opened++;
      return {
        async prepare(row, signal) {
          signal.throwIfAborted(); assert.ok(tracks.includes(row));
          const filePath = `/synthetic/${row.track.id}-${files.size}.wav`; files.add(filePath);
          return { id: row.track.id, mediaAssetId: row.track.mediaAsset.id, durationSeconds: row.durationSeconds, filePath,
            dispose: async () => { files.delete(filePath); } };
        },
        async disposeAll() { files.clear(); }
      };
    },
    connect: async ({ source, signal, registerResource }) => {
      connected++; assert.equal(source.serverHost, `retail-${suffix}.example.com`);
      let unregister;
      const connection = { authenticated: true, forceClose: () => { closed++; }, async close() { closed++; unregister?.(); if (uncertain) throw failure('SUBSCRIBER_AUDIO_SOURCE_STOP_UNCONFIRMED'); },
        async write(bytes) { signal.throwIfAborted(); assert.ok(allocations.length); sent.push(bytes.length); } };
      unregister = registerResource(connection); return connection;
    },
    loadSchedule: async (_db, { authorized }) => { assert.equal(authorized.station.organisationId, assigned.organisationId); return { enabled: false }; },
    log: (event, details) => logs.push({ event, ...details })
  };
  return { options, stop, calls, observations, logs, allocations, files, sent, tracks,
    revoke: () => { revoked = true; }, changeSource: () => { sourceChanged = true; }, denyBudget: () => { budgetDenied = true; }, uncertainStop: () => { uncertain = true; },
    get opened() { return opened; }, get connected() { return connected; }, get closed() { return closed; }, get released() { return released; } };
}
async function basicAudio({ nextTrack, connection, emit, signal }) {
  const first = await nextTrack({ signal }), second = await nextTrack({ signal });
  try {
    await connection.write(Buffer.alloc(384));
    emit({ type: 'TRACK_AUDIO_STARTED', trackId: first.id, audioBytesSent: 384, phase: 'RANDOM', presentationAt: new Date().toISOString(), sourceLatenessMs: 0 });
    await new Promise(resolve => setImmediate(resolve));
    return { stopConfirmed: true };
  } finally { await first.dispose(); await second.dispose(); }
}

test('worker default is no audio and explicit capacity never accepts the Test Radio worker', () => {
  assert.equal(retailWorkerMode([], {}).mode, 'CHECK_ONLY');
  assert.equal(retailWorkerMode(['--check'], { RUVANAS_RETAIL_PLAYOUT_ENABLED: 'true' }).mode, 'CHECK_ONLY');
  assert.throws(() => retailWorkerMode(['--serve'], {}), /NOT_ENABLED/);
  const env = { RUVANAS_RETAIL_PLAYOUT_ENABLED: 'true', RENDER_SERVICE_ID: 'srv-retail-pool', RUVANAS_RETAIL_CAPACITY: JSON.stringify([assignment('a')]) };
  assert.equal(retailWorkerMode(['--serve'], env).assignments.length, 1);
  assert.throws(() => retailWorkerMode(['--serve'], { ...env, RENDER_SERVICE_ID: 'srv-damhnbv40ujc73b00lgg' }), /ID_INVALID/);
  assert.throws(() => retailWorkerMode(['--serve'], { ...env, RUVANAS_RETAIL_CAPACITY: JSON.stringify([assignment('a'), assignment('b')]) }), /CAPACITY_INVALID/);
  assert.equal(retailWorkerMode(['--serve'], { ...env, RUVANAS_RETAIL_MAX_SLOTS: '2', RUVANAS_RETAIL_CAPACITY: JSON.stringify([assignment('a'), assignment('b')]) }).assignments.length, 2);
  assert.equal(retailPrivateDatabase('postgresql://user:synthetic@dpg-private-id/database'), true);
  assert.equal(retailPrivateDatabase('postgresql://user:synthetic@localhost/database'), false);
  assert.equal(retailPrivateDatabase('postgresql://user:synthetic@dpg-private-id/database?host=remote.example.com'), false);
  assert.equal(retailWorkerCode(new Error('secret failure')), 'RETAIL_WORKER_OPERATION_FAILED');
});

test('complete scoped lifecycle prepares before connecting, reserves before sending, reports, stops and releases', async () => {
  const f = fixture();
  assert.deepEqual(await runRetailOutputSession({ ...f.options, runAudio: basicAudio }), { stopConfirmed: true });
  assert.equal(f.opened, 1); assert.equal(f.connected, 1); assert.ok(f.closed > 0); assert.equal(f.files.size, 0);
  assert.deepEqual(f.sent, [384]); assert.equal(f.released.stopConfirmed, true);
  assert.equal(f.observations[0].state, 'STARTING'); assert.ok(f.observations.some(row => row.state === 'STREAMING' && row.phase === 'RANDOM'));
  assert.ok(f.logs.some(row => row.event === 'source_authenticated' && row.listenerAudioVerified === false));
  assert.ok(f.logs.some(row => row.event === 'source_stopped' && row.stopConfirmed === true));
});

test('unapproved or revoked authority cannot open media or a source', async () => {
  const f = fixture(); f.revoke();
  await assert.rejects(runRetailOutputSession({ ...f.options, runAudio: basicAudio }), /OWNER_REVOKED/);
  assert.equal(f.opened, 0); assert.equal(f.connected, 0); assert.equal(f.calls.includes('claim'), false);
});

test('an exhausted allowance sends no source audio and releases the stopped lease', async () => {
  const f = fixture(); f.denyBudget();
  await assert.rejects(runRetailOutputSession({ ...f.options, runAudio: basicAudio }), /BUDGET_EXHAUSTED/);
  assert.equal(f.sent.length, 0); assert.equal(f.files.size, 0); assert.equal(f.released.stopConfirmed, true);
});

test('manual abort closes source and preparation without issuing more bytes', async () => {
  const f = fixture();
  await assert.rejects(runRetailOutputSession({ ...f.options, runAudio: async options => {
    const first = await options.nextTrack({ signal: options.signal });
    try { await options.connection.write(Buffer.alloc(384)); f.stop.abort(failure('MANUAL_STOP')); await abortWait(options.signal); }
    finally { await first.dispose(); }
  } }), /MANUAL_STOP/);
  assert.deepEqual(f.sent, [384]); assert.equal(f.files.size, 0); assert.equal(f.released.stopConfirmed, true); assert.ok(f.closed > 0);
});

test('live revocation and destination changes stop output on authority refresh', { timeout: 10000 }, async () => {
  for (const change of ['revoke', 'changeSource']) {
    const f = fixture(change); const deadline = setTimeout(() => f.stop.abort(failure('TEST_DEADLINE')), 4500);
    try {
      await assert.rejects(runRetailOutputSession({ ...f.options, runAudio: async options => {
        const first = await options.nextTrack({ signal: options.signal });
        try { await options.connection.write(Buffer.alloc(384)); f[change](); await abortWait(options.signal); }
        finally { await first.dispose(); }
      } }), error => error.code === (change === 'revoke' ? 'RETAIL_PLAYOUT_OWNER_REVOKED' : 'RETAIL_WORKER_SOURCE_CHANGED'));
      assert.deepEqual(f.sent, [384]); assert.equal(f.files.size, 0); assert.equal(f.released.stopConfirmed, true);
    } finally { clearTimeout(deadline); f.stop.abort(); }
  }
});

test('uncertain closure retains the lease quarantine instead of claiming a clean stop', async () => {
  const f = fixture(); f.uncertainStop();
  await assert.rejects(runRetailOutputSession({ ...f.options, runAudio: basicAudio }), /STOP_UNCONFIRMED/);
  assert.equal(f.released.stopConfirmed, false);
});

test('two assigned Retail outputs keep independent media, scope, reservations and observations', async () => {
  const first = fixture('first'), second = fixture('second');
  await Promise.all([runRetailOutputSession({ ...first.options, runAudio: basicAudio }), runRetailOutputSession({ ...second.options, runAudio: basicAudio })]);
  for (const f of [first, second]) { assert.equal(f.sent.length, 1); assert.equal(f.allocations.length, 1); assert.equal(f.released.stopConfirmed, true); assert.equal(f.files.size, 0); }
  assert.ok(first.observations.every(value => !value.trackId || value.trackId.startsWith('first-')));
  assert.ok(second.observations.every(value => !value.trackId || value.trackId.startsWith('second-')));
});

test('abort arriving as preparation resolves disposes that descriptor before any source connection', async () => {
  const f = fixture(); let descriptorDisposals = 0, allDisposed = false;
  await assert.rejects(runRetailOutputSession({ ...f.options,
    openMediaSession: async () => ({
      async prepare(row) {
        f.stop.abort(failure('MANUAL_STOP'));
        return { id: row.track.id, mediaAssetId: row.track.mediaAsset.id, durationSeconds: 5, filePath: '/synthetic/prepared.wav',
          dispose: async () => { descriptorDisposals++; } };
      },
      async disposeAll() { allDisposed = true; }
    }),
    runAudio: async () => assert.fail('audio must not start')
  }), /MANUAL_STOP/);
  assert.equal(descriptorDisposals, 1); assert.equal(f.connected, 0); assert.equal(f.sent.length, 0);
  assert.equal(allDisposed, true); assert.equal(f.released.stopConfirmed, true);
});

test('cache cleanup failure still quarantines the lease after confirming audio stopped', async () => {
  const f = fixture(); const original = f.options.openMediaSession;
  await assert.rejects(runRetailOutputSession({ ...f.options,
    openMediaSession: async options => ({ ...await original(options), disposeAll: async () => { throw new Error('synthetic cleanup refusal'); } }),
    runAudio: basicAudio
  }), /STOP_UNCONFIRMED/);
  assert.ok(f.closed > 0); assert.equal(f.released.stopConfirmed, false);
  const stopped = f.logs.find(row => row.event === 'source_stopped');
  assert.equal(stopped.audioStopConfirmed, true); assert.equal(stopped.cacheCleanupConfirmed, false);
});
