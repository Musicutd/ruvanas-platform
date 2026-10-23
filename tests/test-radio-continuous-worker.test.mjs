import test from 'node:test';
import assert from 'node:assert/strict';
import { continuousWorkerMode, continuousDatabaseRoute, continuousObservationReasonCode, CONTINUOUS_STATION_ID, CONTINUOUS_WORKER_ID, continuousBounded,
  createContinuousByteGuard, createContinuousWatchdog, createContinuousObservationQueue } from '../lib/test-radio-continuous-worker.mjs';

test('continuous worker remains inert by default and requires exact host/station and fixed budget', () => {
  assert.equal(continuousWorkerMode(), 'CHECK_ONLY');
  const args = ['--serve', `--station=${CONTINUOUS_STATION_ID}`, '--monthly-budget-usd=15'];
  assert.throws(() => continuousWorkerMode(args, {}), { code: 'CONTINUOUS_WRONG_WORKER' });
  assert.equal(continuousWorkerMode(args, { RENDER_SERVICE_ID: CONTINUOUS_WORKER_ID }), 'SERVE_OWNER_CONTINUOUS_GRANT');
  for (const wrong of [['--serve'], [...args, '--force'], ['--serve', '--station=other', args[2]], [args[0],args[1],'--monthly-budget-usd=20']]) assert.throws(() => continuousWorkerMode(wrong), { code: 'CONTINUOUS_ARGUMENTS_INVALID' });
});

test('database classification accepts only the private Render hostname and no routing override', () => {
  for (const value of ['postgresql://user:opaque@dpg-abcdefgh-a/database', 'postgres://user:opaque@dpg-abcdefgh-a:5432/database?sslmode=require&connection_limit=4']) {
    assert.equal(continuousDatabaseRoute(value), 'PRIVATE_RENDER_DATABASE');
  }
  for (const value of [undefined, '', 'bad', 'https://dpg-abcdefgh-a/database',
    'postgres://user:opaque@dpg-abcdefgh-a.frankfurt-postgres.render.com/database',
    'postgres://user:opaque@dpg-abcdefgh-a.attacker.invalid/database', 'postgres://localhost/database',
    'postgres://127.0.0.1/database', 'postgres://[::1]/database', 'postgres://dpg-abcdefgh-a:5433/database',
    'postgres://dpg-abcdefgh-a/database?host=external.invalid', 'postgres://dpg-abcdefgh-a/database?hostaddr=1.2.3.4',
    'postgres://dpg-abcdefgh-a/database?port=6432', 'postgres://dpg-abcdefgh-a/database?service=public',
    'postgres://dpg-abcdefgh-a/database#ignored']) assert.equal(continuousDatabaseRoute(value), 'REVIEW_REQUIRED');
});

test('durable ERROR observations always use the accepted continuous reason namespace', () => {
  for (const code of ['CONTINUOUS_BUDGET_EXHAUSTED', 'CONTINUOUS_DECODE_FAILED', 'CONTINUOUS_SOURCE_CHANGED']) {
    assert.equal(continuousObservationReasonCode({ code }), code);
  }
  for (const error of [undefined, {}, new Error('secret should not leak'), { code: 'TEST_SOURCE_REJECTED' },
    { code: 'CATALOGUE_TEST_DOWNLOAD_FAILED' }, { code: 'ECONNRESET' }, { code: 'CONTINUOUS_x' },
    { code: 'CONTINUOUS_SECRET\nvalue' }, { code: `CONTINUOUS_${'A'.repeat(81)}` }]) {
    assert.equal(continuousObservationReasonCode(error), 'CONTINUOUS_STREAM_FAILED');
  }
});
test('budget reservations precede source writes and are renewed after month rollover', async () => {
  const events = [], signal = new AbortController().signal;
  let instant = new Date('2026-10-31T23:59:59Z');
  const guard = createContinuousByteGuard({ signal, now: () => instant, allocationBytes: 65536,
    reserve: async ({ bytes, now }) => { events.push('reserve'); return { reservedBytes: bytes, monthKey: now.toISOString().slice(0,7) }; },
    write: async () => { events.push('write'); } });
  await guard.write(Buffer.alloc(384)); await guard.write(Buffer.alloc(384));
  instant = new Date('2026-11-01T00:00:00Z'); await guard.write(Buffer.alloc(384));
  assert.deepEqual(events, ['reserve','write','write','reserve','write']); assert.equal(guard.totalBytes, 1152);
});
test('exhausted or malformed durable reservation sends no audio', async () => {
  for (const reserve of [async () => { throw Object.assign(new Error(), { code: 'CONTINUOUS_BUDGET_EXHAUSTED' }); }, async () => ({ reservedBytes: 1, monthKey: '2026-10' })]) {
    let writes = 0;
    const guard = createContinuousByteGuard({ signal: new AbortController().signal, reserve, write: async () => writes++ });
    await assert.rejects(guard.write(Buffer.alloc(384))); assert.equal(writes,0);
  }
});

test('proactive byte allocation remains pending without blocking already-reserved audio', async () => {
  const stop = new AbortController(), now = () => new Date('2026-10-23T12:00:00Z');
  let reservations = 0, accepted = 0, release;
  const guard = createContinuousByteGuard({ signal: stop.signal, now, allocationBytes: 65536,
    reserve: async ({ bytes }) => {
      reservations++;
      if (reservations === 2) await new Promise(resolve => { release = resolve; });
      return { reservedBytes: bytes, monthKey: '2026-10' };
    }, write: async chunk => { accepted += chunk.length; } });
  try {
    // The first reservation covers these writes. The second reservation starts
    // at the low-water mark but is deliberately held open.
    await guard.write(Buffer.alloc(48 * 1024));
    assert.equal(reservations, 2); assert.equal(accepted, 48 * 1024);
    await guard.write(Buffer.alloc(8 * 1024));
    assert.equal(accepted, 56 * 1024); assert.equal(reservations, 2);
    let completed = false;
    const awaitingAllowance = guard.write(Buffer.alloc(16 * 1024)).then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false); assert.equal(accepted, 56 * 1024);
    release(); await awaitingAllowance;
    assert.equal(accepted, 72 * 1024); assert.equal(guard.totalBytes, accepted);
  } finally { release?.(); stop.abort(); }
});

test('a proactive allocation failure prevents any subsequent source write', async () => {
  const stop = new AbortController(); let reservations = 0, writes = 0, deny;
  const guard = createContinuousByteGuard({ signal: stop.signal, now: () => new Date('2026-10-23T12:00:00Z'), allocationBytes: 65536,
    reserve: async ({ bytes }) => {
      if (++reservations === 2) await new Promise((resolve, reject) => { deny = reject; });
      return { reservedBytes: bytes, monthKey: '2026-10' };
    }, write: async () => { writes++; } });
  try {
    await guard.write(Buffer.alloc(48 * 1024)); assert.equal(writes, 1);
    deny(Object.assign(new Error(), { code: 'CONTINUOUS_BUDGET_EXHAUSTED' }));
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(guard.write(Buffer.alloc(384)), { code: 'CONTINUOUS_BUDGET_EXHAUSTED' });
    assert.equal(writes, 1);
  } finally { stop.abort(); }
});
test('watchdog independently closes source and child when database authority expires', async () => {
  let kills = 0, closes = 0;
  const watch = createContinuousWatchdog({ signal: new AbortController().signal, authorityMs: 30 });
  watch.registerResource({ forceClose: () => kills++, close: async () => closes++ });
  await new Promise(resolve => watch.signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(watch.signal.reason.code, 'CONTINUOUS_AUTHORITY_EXPIRED'); assert.ok(kills > 0);
  assert.equal(await watch.close(), true); assert.equal(closes,1); assert.equal(watch.resourceCount,0);
});
test('manual stop kills immediately and resource registrations stay bounded', async () => {
  const parent = new AbortController(), watch = createContinuousWatchdog({ signal: parent.signal });
  let kills = 0;
  for (let i=0;i<1000;i++) { const unregister = watch.registerResource({ forceClose() {}, async close() {} }); unregister(); }
  watch.registerResource({ forceClose: () => kills++, async close() {} });
  assert.equal(watch.resourceCount,1); parent.abort(new Error('manual stop'));
  assert.equal(kills,1); assert.equal(watch.signal.aborted,true); assert.equal(await watch.close(),true);
});
test('bounded operation times out, and coalescing observations cannot grow unbounded', async () => {
  await assert.rejects(continuousBounded(() => new Promise(() => {}), new AbortController().signal, 10), { code: 'CONTINUOUS_OPERATION_TIMEOUT' });
  let release, writes=[];
  const first = new Promise(resolve => { release = resolve; });
  const queue = createContinuousObservationQueue({ write: async value => { writes.push(value); if(value===0)await first; }, onError: assert.fail });
  queue.push(0); for(let i=1;i<1000;i++) queue.push(i); release(); await queue.flush();
  assert.deepEqual(writes,[0,999]);
});
