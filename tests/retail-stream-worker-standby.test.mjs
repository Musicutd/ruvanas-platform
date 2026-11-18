import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { retailWorkerMode } from '../lib/retail-stream-worker.mjs';
import { standbyRetailStreams } from '../scripts/retail-stream-worker.mjs';

const scriptUrl = new URL('../scripts/retail-stream-worker.mjs', import.meta.url);
const syntheticEnv = { ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
  RUVANAS_RETAIL_PLAYOUT_ENABLED: 'true', RENDER_SERVICE_ID: 'srv-damhnbv40ujc73b00lgg',
  DATABASE_URL: 'synthetic-invalid-database', R2_ENDPOINT: 'synthetic-invalid-storage',
  R2_SECRET_ACCESS_KEY: 'synthetic-must-not-log', RUVANAS_RETAIL_POOL: 'invalid-json' };

test('standby is explicit and cannot fall through to serving when live configuration is present', () => {
  assert.deepEqual(retailWorkerMode(['--standby'], syntheticEnv), { mode: 'STANDBY', assignments: [] });
  assert.equal(retailWorkerMode([], syntheticEnv).mode, 'CHECK_ONLY');
  assert.equal(retailWorkerMode(['--check'], syntheticEnv).mode, 'CHECK_ONLY');
  for (const args of [['--standby', '--serve'], ['--serve', '--standby'], ['standby'], ['--standby=true']])
    assert.throws(() => retailWorkerMode(args, syntheticEnv), /NOT_ENABLED/);
});

test('standby remains alive, emits only fixed off-state evidence, and releases shutdown listeners', async () => {
  const controller = new AbortController(), events = [];
  const sigtermBefore = process.listenerCount('SIGTERM'), sigintBefore = process.listenerCount('SIGINT');
  let settled = false;
  const task = standbyRetailStreams({ signal: controller.signal, heartbeatMs: 10,
    log: event => { events.push(event); if (events.filter(row => row.event === 'standby_heartbeat').length === 2) controller.abort(); }
  }).then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore + 1);
  assert.deepEqual(await task, { mode: 'STANDBY', streamingStarted: false, cloudAccessed: false, stopped: true });
  assert.deepEqual(events.map(event => event.event), ['standby_ready', 'standby_heartbeat', 'standby_heartbeat', 'standby_stopped']);
  for (const event of events) assert.deepEqual(Object.keys(event).sort(), ['cloudAccessed', 'event', 'mode', 'service', 'streamingStarted']);
  assert.ok(events.every(event => event.streamingStarted === false && event.cloudAccessed === false));
  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore);
});

test('an already stopped standby does not announce readiness or wait for a heartbeat', async () => {
  const controller = new AbortController(), events = []; controller.abort();
  const result = await standbyRetailStreams({ signal: controller.signal, log: event => events.push(event) });
  assert.equal(result.stopped, true);
  assert.deepEqual(events.map(event => event.event), ['standby_stopped']);
});

test('a failed standby reporter cannot leave process signal handlers attached', async () => {
  const before = process.listenerCount('SIGTERM');
  await assert.rejects(standbyRetailStreams({ log: () => { throw new Error('synthetic logger failure'); } }), /synthetic logger failure/);
  assert.equal(process.listenerCount('SIGTERM'), before);
  await assert.rejects(standbyRetailStreams({ heartbeatMs: 0 }), /STANDBY_OPTIONS_INVALID/);
  await assert.rejects(standbyRetailStreams({ heartbeatMs: 60001 }), /STANDBY_OPTIONS_INVALID/);
});

test('the actual standby command stays alive with unusable cloud settings and never prints them', { timeout: 6000 }, async () => {
  const child = spawn(process.execPath, [fileURLToPath(scriptUrl), '--standby'],
    { env: syntheticEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
  let stdout = '', stderr = '', exited = false;
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = once(child, 'close').then(() => { exited = true; });
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { cleanup(); reject(new Error('standby ready not observed')); }, 3000);
      const cleanup = () => { clearTimeout(deadline); child.stdout.off('data', check); child.off('error', failed); };
      const check = () => { if (stdout.includes('standby_ready')) { cleanup(); resolve(); } };
      const failed = error => { cleanup(); reject(error); };
      child.stdout.on('data', check); child.once('error', failed); check();
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(exited, false);
    assert.equal(stderr, '');
    assert.deepEqual(JSON.parse(stdout.trim()), { service: 'RETAIL_SHARED_AUDIO', mode: 'STANDBY', event: 'standby_ready',
      streamingStarted: false, cloudAccessed: false });
    assert.ok(!stdout.includes('synthetic-must-not-log'));
  } finally { child.kill('SIGTERM'); await closed; }
});

test('SIGTERM leaves standby cleanly with a final stopped report', { timeout: 5000 }, async () => {
  const program = `import { standbyRetailStreams } from ${JSON.stringify(scriptUrl.href)};
    const task = standbyRetailStreams({ heartbeatMs: 10 });
    setTimeout(() => process.emit('SIGTERM'), 25);
    await task;`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program],
    { env: syntheticEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0); assert.equal(stderr, '');
  const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].event, 'standby_ready');
  assert.equal(events.at(-1).event, 'standby_stopped');
  assert.ok(events.every(event => event.mode === 'STANDBY' && event.cloudAccessed === false && event.streamingStarted === false));
});
