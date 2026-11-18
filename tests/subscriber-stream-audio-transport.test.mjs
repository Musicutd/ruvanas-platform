import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { validateSubscriberStreamTarget, resolveSubscriberStreamTarget, connectSubscriberStreamSource,
  subscriberMediaIdentity, downloadSubscriberMedia } from '../lib/subscriber-stream-transport.mjs';
import { createSubscriberByteGuard, createSubscriberWatchdog, createSubscriberObservationQueue } from '../lib/subscriber-stream-audio-runtime.mjs';

const source = () => ({ providerKey: 'CENTOVA_CAST', outputCodec: 'MP3', serverHost: 'stream.example.com', sourcePort: 8330,
  bitrateKbps: 128, centovaUsername: 'retailone', sourceUsername: null, sourcePasswordEncrypted: 'synthetic-only' });
const signal = () => new AbortController().signal;
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('source validation reserves Test Radio regardless of alias and rejects unsupported/unsafe settings', () => {
  assert.equal(validateSubscriberStreamTarget(source()), true);
  for (const delta of [{ sourcePort: 8282, serverHost: 'different.example.com' }, { centovaUsername: 'RuVaNaSTestRadio' },
    { centovaUsername: 'ruvanas_test_radio' }, { centovaUsername: 'ruvanas_studio_test' }])
    assert.throws(() => validateSubscriberStreamTarget({ ...source(), ...delta }), /TARGET_RESERVED/);
  for (const delta of [{ serverHost: '127.0.0.1' }, { serverHost: '169.254.169.254' }, { serverHost: 'localhost' },
    { serverHost: 'example.local' }, { serverHost: 'public.com/path' }, { serverHost: 'user@public.com' },
    { sourcePort: 0 }, { sourcePort: 65536 }, { sourceUsername: 'source' }, { bitrateKbps: 320 }, { outputCodec: 'AAC' }])
    assert.throws(() => validateSubscriberStreamTarget({ ...source(), ...delta }), /SUBSCRIBER_AUDIO_/);
});

test('DNS is checked on every connection, rejects mixed private answers, and pins the numeric address', async () => {
  assert.deepEqual(await resolveSubscriberStreamTarget(source(), { signal: signal(), lookupImpl: publicLookup }), { address: '93.184.216.34', port: 8330 });
  for (const addresses of [[], [{ address: '127.0.0.1' }], [{ address: '93.184.216.34' }, { address: '10.2.3.4' }], [{ address: '::ffff:127.0.0.1' }],
    [{ address: '192.0.2.1' }], [{ address: '198.51.100.1' }], [{ address: '203.0.113.1' }]])
    await assert.rejects(resolveSubscriberStreamTarget(source(), { signal: signal(), lookupImpl: async () => addresses }), /SOURCE_ADDRESS_INVALID/);
  await assert.rejects(resolveSubscriberStreamTarget(source(), { signal: signal(), lookupImpl: async () => { throw new Error('private DNS details'); } }), error => {
    assert.equal(error.message, 'SUBSCRIBER_AUDIO_DNS_UNAVAILABLE'); return true;
  });
});

class Socket extends EventEmitter {
  constructor(reply) { super(); this.reply = reply; this.destroyed = false; this.writes = []; setImmediate(() => this.emit('connect')); }
  write(bytes, callback) {
    this.writes.push(bytes); callback?.();
    if (this.writes.length === 1) queueMicrotask(() => this.emit('data', Buffer.from(this.reply)));
    return true;
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; queueMicrotask(() => this.emit('close')); }
}
function registry() { const items = new Set(); return { items, registerResource: item => { items.add(item); return () => items.delete(item); } }; }

test('source handshake sends to pinned target, redacts failures, and abort remains attached after authentication', async () => {
  const stop = new AbortController(), resources = registry(); let socket, options;
  const connection = await connectSubscriberStreamSource({ source: source(), password: 'synthetic-password', signal: stop.signal,
    registerResource: resources.registerResource, stationName: 'Retail\r\nicy-pub:1' }, {
    lookupImpl: publicLookup, createConnection: value => { options = value; return socket = new Socket('OK2\n'); }
  });
  assert.deepEqual(options, { host: '93.184.216.34', port: 8330 }); assert.equal(connection.authenticated, true);
  assert.equal(socket.writes[0], 'synthetic-password\n'); assert.equal(socket.writes[1].includes('\nicy-pub:1\n'), false);
  await connection.write(Buffer.from([1, 2]));
  stop.abort(); await connection.close(); assert.equal(socket.destroyed, true); assert.equal(resources.items.size, 0);
  await assert.rejects(connection.write(Buffer.from([1])), /SUBSCRIBER_AUDIO_/);
  const denied = registry(); let rejected;
  await assert.rejects(connectSubscriberStreamSource({ source: source(), password: 'never-log-this', signal: signal(), registerResource: denied.registerResource }, {
    lookupImpl: publicLookup, createConnection: () => rejected = new Socket('ERROR never-log-this\n')
  }), error => { assert.equal(error.message, 'SUBSCRIBER_AUDIO_SOURCE_CONNECTION_FAILED'); assert.equal(error.message.includes('never-log-this'), false); return true; });
  assert.equal(rejected.destroyed, true); assert.equal(denied.items.size, 0);
});

test('catalogue download checks private content-address identity and exact byte checksum', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'retail-media-test-')), bytes = Buffer.from('synthetic audio fixture');
  const asset = { storageKey: `catalogue/music/${createHash('sha256').update(bytes).digest('hex')}.mp3`, sizeBytes: bytes.length,
    libraryType: 'RUVANAS_CATALOGUE', organisationId: null };
  try {
    assert.equal(subscriberMediaIdentity(asset).sizeBytes, bytes.length);
    const file = path.join(directory, 'first.mp3');
    assert.equal(await downloadSubscriberMedia(Readable.from([bytes]), file, asset, { signal: signal() }), bytes.length);
    assert.deepEqual(await readFile(file), bytes);
    await assert.rejects(downloadSubscriberMedia(Readable.from([Buffer.alloc(bytes.length)]), path.join(directory, 'wrong.mp3'), asset, { signal: signal() }), /CHECKSUM_MISMATCH/);
    for (const delta of [{ storageKey: '../../secret.mp3' }, { organisationId: 'other-org' }, { sizeBytes: 60 * 1024 * 1024 }])
      assert.throws(() => subscriberMediaIdentity({ ...asset, ...delta }), /MEDIA_IDENTITY_INVALID/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('byte reservations precede output and renew when the month changes', async () => {
  let instant = new Date('2026-10-31T23:59:59Z'), total = 0; const reserved = [];
  const guard = createSubscriberByteGuard({ signal: signal(), now: () => instant, allocationBytes: 65536,
    reserve: async ({ bytes, now }) => { reserved.push(now.toISOString().slice(0, 7)); return { reservedBytes: bytes, monthKey: reserved.at(-1) }; },
    write: async () => { assert.ok(reserved.length); total++; } });
  await guard.write(Buffer.alloc(100)); instant = new Date('2026-11-01T00:00:00Z'); await guard.write(Buffer.alloc(100));
  assert.deepEqual(reserved, ['2026-10', '2026-11']); assert.equal(total, 2); assert.equal(guard.totalBytes, 200);
  let writes = 0;
  await assert.rejects(createSubscriberByteGuard({ signal: signal(), reserve: async () => { throw new Error('budget'); }, write: async () => writes++ }).write(Buffer.from([1])), /budget/);
  assert.equal(writes, 0);
});

test('expired authority closes registered resources; observations coalesce and propagate failures', async () => {
  let closed = 0;
  const watchdog = createSubscriberWatchdog({ signal: signal(), authorityMs: 20 });
  watchdog.registerResource({ forceClose: () => closed++, close: async () => {} });
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(watchdog.signal.aborted, true); assert.ok(closed > 0); assert.equal(await watchdog.close(), true);
  let release, failed = false; const values = [];
  const queue = createSubscriberObservationQueue({ write: async value => { values.push(value); if (value === 1) await new Promise(resolve => release = resolve); else throw new Error('observation'); }, onError: () => failed = true });
  queue.push(1); queue.push(2); queue.push(3); release(); assert.equal(await queue.flush(), false);
  assert.deepEqual(values, [1, 3]); assert.equal(failed, true); assert.equal(queue.push(4), false);
});
