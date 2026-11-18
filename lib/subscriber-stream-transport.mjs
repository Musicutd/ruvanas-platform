// Reusable source transport. It confers no catalogue, output or budget authority.
// The scoped worker supplies an approved source and owns the short-lived lease.
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { retailPublicAddress } from './retail-stream-connection-check.mjs';

const fail = code => Object.assign(new Error(code), { code });
const safeHost = value => typeof value === 'string' && value.length <= 253 && value === value.toLowerCase() &&
  !value.endsWith('.') && /^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.includes('.') &&
  value.split('.').every(label => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-')) &&
  !/(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test)$/.test(value);

export function subscriberMediaIdentity(asset) {
  const match = typeof asset?.storageKey === 'string' && asset.storageKey.match(/^catalogue\/music\/([a-f0-9]{64})\.(mp3|wav|ogg|m4a)$/);
  const size = Number(asset?.sizeBytes);
  if (!match || asset.libraryType !== 'RUVANAS_CATALOGUE' || asset.organisationId !== null ||
      !Number.isSafeInteger(size) || size < 1 || size > 50 * 1024 * 1024) throw fail('SUBSCRIBER_AUDIO_MEDIA_IDENTITY_INVALID');
  return { checksum: match[1], extension: match[2], sizeBytes: size };
}

export async function downloadSubscriberMedia(body, filePath, asset, { signal }) {
  const identity = subscriberMediaIdentity(asset), digest = createHash('sha256'); let bytes = 0;
  const checked = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > identity.sizeBytes) return callback(fail('SUBSCRIBER_AUDIO_MEDIA_SIZE_MISMATCH'));
    digest.update(chunk); callback(null, chunk);
  } });
  await pipeline(body, checked, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }), { signal });
  if (bytes !== identity.sizeBytes || digest.digest('hex') !== identity.checksum) throw fail('SUBSCRIBER_AUDIO_MEDIA_CHECKSUM_MISMATCH');
  return bytes;
}

export function validateSubscriberStreamTarget(source) {
  if (!source || source.providerKey !== 'CENTOVA_CAST' || source.outputCodec !== 'MP3' ||
      !safeHost(source.serverHost) || !Number.isInteger(source.sourcePort) || source.sourcePort < 1 || source.sourcePort > 65535 ||
      source.bitrateKbps !== 128 || source.sourceUsername || !/^[a-zA-Z0-9_-]{1,80}$/.test(source.centovaUsername || '') ||
      !source.sourcePasswordEncrypted || /STOP_UNCONFIRMED$/.test(source.lastError || '')) throw fail('SUBSCRIBER_AUDIO_SOURCE_NOT_READY');
  // Test Radio is excluded even if a caller supplies a host alias or different
  // case. The worker also checks destination ownership against fresh inventory.
  if (source.sourcePort === 8282 || ['ruvanastestradio', 'ruvanas_test_radio', 'ruvanas_studio_test'].includes(source.centovaUsername.toLowerCase()))
    throw fail('SUBSCRIBER_AUDIO_TARGET_RESERVED');
  if (net.isIP(source.serverHost) && (net.isIP(source.serverHost) !== 4 || !retailPublicAddress(source.serverHost))) throw fail('SUBSCRIBER_AUDIO_SOURCE_ADDRESS_INVALID');
  return true;
}

function bounded(operation, signal, milliseconds, code) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, fail('SUBSCRIBER_AUDIO_ABORTED'));
    const timer = setTimeout(() => finish(reject, fail(code)), milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(operation).then(value => finish(resolve, value), () => finish(reject, fail(code)));
    if (signal.aborted) abort();
  });
}

export async function resolveSubscriberStreamTarget(source, { signal, lookupImpl = lookup } = {}) {
  validateSubscriberStreamTarget(source);
  if (typeof signal?.throwIfAborted !== 'function') throw fail('SUBSCRIBER_AUDIO_ABORT_SIGNAL_REQUIRED');
  const addresses = await bounded(() => lookupImpl(source.serverHost, { all: true, family: 4, verbatim: true }), signal, 8000, 'SUBSCRIBER_AUDIO_DNS_UNAVAILABLE');
  if (!Array.isArray(addresses) || !addresses.length || addresses.length > 32 || addresses.some(item => net.isIP(item?.address) !== 4 || !retailPublicAddress(item.address)))
    throw fail('SUBSCRIBER_AUDIO_SOURCE_ADDRESS_INVALID');
  signal.throwIfAborted();
  return Object.freeze({ address: addresses[0].address, port: source.sourcePort });
}

export function subscriberSourceResponseAccepted(value) { return /^OK2\r?\n/.test(String(value)); }

export async function connectSubscriberStreamSource({ source, password, signal, registerResource, stationName = 'Ruvanas Retail' },
  { lookupImpl = lookup, createConnection = options => net.createConnection(options) } = {}) {
  validateSubscriberStreamTarget(source);
  if (typeof password !== 'string' || password.length < 1 || password.length > 512 || /[\r\n\0]/.test(password)) throw fail('SUBSCRIBER_AUDIO_CREDENTIAL_INVALID');
  if (typeof registerResource !== 'function' || typeof signal?.throwIfAborted !== 'function') throw fail('SUBSCRIBER_AUDIO_WATCHDOG_REQUIRED');
  const name = String(stationName).replace(/[^\x20-\x7e]/g, ' ').slice(0, 120);
  const target = await resolveSubscriberStreamTarget(source, { signal, lookupImpl });
  signal.throwIfAborted();
  // The socket receives the validated numeric address, never a second DNS lookup.
  let socket;
  try { socket = createConnection({ host: target.address, port: target.port }); }
  catch { throw fail('SUBSCRIBER_AUDIO_SOURCE_CONNECTION_FAILED'); }
  let socketError = false, isClosed = false, unregister;
  socket.on('error', () => { socketError = true; });
  const aborted = () => socket.destroy();
  const closed = new Promise(resolve => socket.once('close', () => {
    isClosed = true; signal.removeEventListener('abort', aborted); unregister?.(); resolve();
  }));
  const resource = { forceClose: () => socket.destroy(), close: async () => {
    socket.destroy();
    if (!isClosed) await bounded(() => closed, new AbortController().signal, 2500, 'SUBSCRIBER_AUDIO_SOURCE_STOP_UNCONFIRMED');
  } };
  try { unregister = registerResource(resource); }
  catch { socket.destroy(); throw fail('SUBSCRIBER_AUDIO_WATCHDOG_REQUIRED'); }
  signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted();
  function write(bytes) {
    return bounded(() => new Promise((resolve, reject) => {
      if (signal.aborted || socketError || socket.destroyed) return reject(fail('SUBSCRIBER_AUDIO_SOURCE_DISCONNECTED'));
      let finished = false;
      const done = error => { if (finished) return; finished = true; socket.off('close', onClose); error ? reject(fail('SUBSCRIBER_AUDIO_SOURCE_DISCONNECTED')) : resolve(); };
      const onClose = () => done(true); socket.once('close', onClose);
      socket.write(bytes, error => done(Boolean(error)));
    }), signal, 3000, 'SUBSCRIBER_AUDIO_SOURCE_DISCONNECTED').catch(error => { socket.destroy(); throw error; });
  }
  try {
    await bounded(() => new Promise((resolve, reject) => {
      let response = '';
      const cleanup = () => { socket.off('data', data); socket.off('error', error); socket.off('close', error); socket.off('connect', connected); };
      const error = () => { cleanup(); reject(fail('SUBSCRIBER_AUDIO_SOURCE_CONNECTION_FAILED')); };
      const data = chunk => {
        response += chunk.toString('ascii');
        if (response.length > 4096) return error();
        if (!response.includes('\n')) return;
        if (!subscriberSourceResponseAccepted(response)) return error();
        cleanup(); resolve();
      };
      const connected = () => { if (signal.aborted) return socket.destroy(); socket.write(`${password}\n`, err => { if (err) socket.destroy(); }); };
      socket.on('data', data); socket.once('error', error); socket.once('close', error); socket.once('connect', connected);
      if (signal.aborted) socket.destroy();
    }), signal, 8000, 'SUBSCRIBER_AUDIO_SOURCE_CONNECTION_FAILED');
    signal.throwIfAborted();
    await write(`icy-name:${name}\nicy-pub:0\nicy-br:128\ncontent-type:audio/mpeg\n\n`);
    return { ...resource, authenticated: true, hasError: () => Boolean(socketError || socket.destroyed),
      write(chunk) {
        if (signal.aborted || socketError || socket.destroyed) return Promise.reject(fail('SUBSCRIBER_AUDIO_SOURCE_DISCONNECTED'));
        if (!Buffer.isBuffer(chunk) || chunk.length < 1 || chunk.length > 65536) return Promise.reject(fail('SUBSCRIBER_AUDIO_SOURCE_CHUNK_INVALID'));
        return write(chunk);
      } };
  } catch (error) {
    await resource.close().catch(() => { error.stopConfirmed = false; }); throw error;
  }
}
