// UTC-clocked, bounded local PCM switching. The caller alone owns catalogue,
// schedule, rights, lease, transport and budget authority. This file has no I/O
// beyond caller-approved local files and child pipes.
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { testRadioContinuousDecodeArguments, testRadioContinuousEncoderArguments,
  createTestRadioContinuousMp3Parser } from './test-radio-continuous-playout.mjs';

const RATE = 48000, FRAME_BYTES = 4, BLOCK_FRAMES = 960, LEAD_MS = 200, LATE_MS = 350, START_LEAD_MS = 3000;
const fail = code => Object.assign(new Error(code), { code });
const independent = () => new AbortController().signal;
function bounded(promise, signal, ms = 3000, code = 'CONTINUOUS_OPERATION_TIMEOUT') {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, signal.reason || fail('CONTINUOUS_STOPPED'));
    const timer = setTimeout(() => finish(reject, fail(code)), ms);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}
function wait(ms, signal) {
  if (ms <= 0) { signal.throwIfAborted(); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const done = error => { clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const abort = () => done(signal.reason || fail('CONTINUOUS_STOPPED'));
    const timer = setTimeout(done, ms); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
function childOptions(stdin) {
  return { stdio: [stdin, 'pipe', 'ignore'], shell: false, windowsHide: true,
    env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {} };
}
function ownChild(child, signal, registerResource, children) {
  let closed = false, errored = false, unregister;
  child.on('error', () => { errored = true; });
  const kill = () => { if (!closed) { try { child.kill('SIGKILL'); } catch {} child.stdin?.destroy(); child.stdout?.destroy(); } };
  const exit = new Promise(resolve => child.once('close', code => { closed = true; unregister?.(); children.delete(guard); signal.removeEventListener('abort', kill); resolve(errored ? -1 : code); }));
  const guard = { child, exit, kill, async close() { kill(); await bounded(exit, independent(), 2500).catch(() => {}); return closed; } };
  children.add(guard);
  try { unregister = registerResource({ forceClose: kill, async close() { if (!await guard.close()) throw fail('CONTINUOUS_CHILD_STOP_UNCONFIRMED'); } }); }
  catch (error) { kill(); throw error; }
  signal.addEventListener('abort', kill, { once: true }); if (signal.aborted) kill(); return guard;
}
async function checkedFile(track) {
  const args = testRadioContinuousDecodeArguments(track.filePath, track.durationSeconds);
  if (!track.id || !track.mediaAssetId || typeof track.dispose !== 'function') throw fail('CONTINUOUS_TRACK_INVALID');
  const info = await lstat(track.filePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 50 * 1024 * 1024) throw fail('CONTINUOUS_FILE_INVALID');
  return args;
}
function decoderArguments(args, offsetFrames) {
  if (!offsetFrames) return args;
  // Decode from the beginning, then trim at exact *resampled* PCM frames. An
  // input -ss can vary with MP3 seek tables and cannot prove a sample offset.
  const index = args.indexOf('-c:a');
  return [...args.slice(0, index), '-af', `aresample=${RATE},atrim=start_sample=${offsetFrames},asetpts=PTS-STARTPTS`, ...args.slice(index)];
}
export function scheduledContinuousEncoderArguments() {
  const args = testRadioContinuousEncoderArguments().filter(value => value !== '-re');
  const input = args.indexOf('-i');
  // The worker paces both PCM and accepted MP3 frames; a second -re clock or
  // raw-input probing would add an unknown queue before exact-time handovers.
  return [...args.slice(0, input), '-probesize', '32', '-analyzeduration', '0', ...args.slice(input, -1), '-flush_packets', '1', args.at(-1)];
}

// One bounded decoder, no full PCM retention. The result matches the decoder
// used for playout, including gapless MP3 trimming and sample-rate conversion.
export async function measureContinuousAudioFrames({ ffmpegPath, track, signal, registerResource }, { spawnProcess = spawn } = {}) {
  const children = new Set(); let decoder;
  try {
    const args = await checkedFile(track); signal.throwIfAborted();
    decoder = ownChild(spawnProcess(ffmpegPath, args, childOptions('ignore')), signal, registerResource, children);
    let bytes = 0;
    const read = (async () => {
      for await (const chunk of decoder.child.stdout) {
        signal.throwIfAborted(); bytes += chunk.length;
        if (chunk.length > 256 * 1024 || bytes > (track.durationSeconds + 2) * RATE * FRAME_BYTES) throw fail('CONTINUOUS_DURATION_MISMATCH');
      }
      const code = await decoder.exit, seconds = bytes / RATE / FRAME_BYTES;
      if (code !== 0 || !bytes || bytes % FRAME_BYTES || Math.abs(seconds - track.durationSeconds) > Math.min(2, Math.max(.1, track.durationSeconds * .01))) throw fail('CONTINUOUS_DURATION_MISMATCH');
      return bytes / FRAME_BYTES;
    })();
    return await bounded(read, signal, 30000, 'CONTINUOUS_MEASUREMENT_TIMEOUT');
  } finally {
    if (decoder && !await decoder.close()) throw Object.assign(fail('CONTINUOUS_CHILD_STOP_UNCONFIRMED'), { stopConfirmed: false });
  }
}

/** schedule.planAt(utcMs) is synchronous and returns an approved ready plan.
 * schedule.prepareTrack({plan,signal}) returns an owned local descriptor.
 * A warmed scheduled decoder is never fetched at a boundary. If unavailable,
 * approved random continues for that occurrence; a warning is emitted.
 * PCM handover is sample-exact; MP3 source timing has one 24 ms frame granularity
 * plus a measured bounded process allowance. Listener buffering is independent.
 */
export async function runScheduledContinuousPlayout(options, { spawnProcess = spawn, now = Date.now, monotonicNow = () => performance.now() } = {}) {
  const { ffmpegPath, signal: externalSignal, registerResource, connection, nextTrack, emit, schedule } = options;
  if (typeof schedule?.planAt !== 'function' || typeof schedule?.prepareTrack !== 'function' || connection?.authenticated !== true ||
      typeof connection.write !== 'function' || typeof nextTrack !== 'function' || typeof emit !== 'function' || typeof registerResource !== 'function') throw fail('CONTINUOUS_OPTIONS_INVALID');
  externalSignal.throwIfAborted();
  const controller = new AbortController(), signal = controller.signal;
  const parentStop = () => controller.abort(externalSignal.reason || fail('CONTINUOUS_STOPPED'));
  externalSignal.addEventListener('abort', parentStop, { once: true }); if (externalSignal.aborted) parentStop();
  const children = new Set(), owned = new Set(), jobs = new Set(), disposals = new Set(), blocked = new Map(), recent = [], timeline = [];
  let encoder, feeder, current, randomReady, scheduledReady, anchor, originMono, fedFrames = 0, acceptedFrames = 0;
  let bytesSent = 0, tracksStarted = 0, tracksEnded = 0, lastOutput = null, lastProgress = 0, failure;
  const report = event => {
    const value = emit({ ...event, attribution: 'ACCEPTED_ENCODER_FRAMES' });
    if (value?.then) Promise.resolve(value).catch(() => {});
    if (value === false || value?.then) throw fail('CONTINUOUS_EVENT_FAILED');
  };
  const utcNow = () => {
    const elapsed = monotonicNow() - originMono, estimated = anchor - START_LEAD_MS + elapsed;
    if (Math.abs(now() - estimated) > 250) throw fail('CONTINUOUS_CLOCK_CHANGED');
    return estimated;
  };
  const planAt = atMs => {
    // Looking ahead must not expire a refusal in the *current* occurrence.
    // Only the actual clock may retire it, otherwise every PCM block retries
    // the unavailable future programme and floods storage/logging.
    for (const [id, end] of blocked) if (end <= now()) blocked.delete(id);
    const value = schedule.planAt(atMs);
    if (!value || !['RANDOM', 'SCHEDULED'].includes(value.phase)) throw fail('CONTINUOUS_SCHEDULE_INVALID');
    if (value.phase === 'SCHEDULED' && (blocked.get(value.occurrenceId) || 0) > atMs) return { phase: 'RANDOM',
      nextBoundaryAtMs: Math.min(value.nextBoundaryAtMs ?? Infinity, value.occurrenceEndsAtMs) };
    return value;
  };
  const refuse = (plan, code) => {
    if (plan?.occurrenceId && !blocked.has(plan.occurrenceId)) {
      if (blocked.size >= 400) throw fail('CONTINUOUS_SCHEDULE_INVALID');
      blocked.set(plan.occurrenceId, plan.occurrenceEndsAtMs);
      report({ type: 'SCHEDULE_FALLBACK', phase: 'RANDOM', occurrenceId: plan.occurrenceId, reasonCode: code });
    }
  };
  const dispose = async item => {
    if (!item || !owned.has(item)) return;
    if (item.disposing) return item.disposing;
    item.disposing = (async () => {
      if (item.decoder && !await item.decoder.close()) throw Object.assign(fail('CONTINUOUS_CHILD_STOP_UNCONFIRMED'), { stopConfirmed: false });
      try { await bounded(Promise.resolve().then(() => item.track.dispose()), independent()); }
      catch (error) { error.stopConfirmed = false; throw error; }
      owned.delete(item);
    })();
    return item.disposing;
  };
  const disposeLater = item => {
    const task = dispose(item); disposals.add(task);
    task.then(() => disposals.delete(task), error => { disposals.delete(task); controller.abort(error); });
  };
  const openDecoder = async (item, plan) => {
    const args = await checkedFile(item.track);
    if (plan && (item.track.id !== plan.trackId || item.track.mediaAssetId !== plan.mediaAssetId || !Number.isSafeInteger(plan.offsetFrames) || plan.offsetFrames < 0 || plan.offsetFrames >= plan.totalFrames)) throw fail('CONTINUOUS_TRACK_INVALID');
    if (item.decoder && !await item.decoder.close()) throw Object.assign(fail('CONTINUOUS_CHILD_STOP_UNCONFIRMED'), { stopConfirmed: false });
    item.plan = plan; item.offsetFrames = plan?.offsetFrames || 0;
    item.decoder = ownChild(spawnProcess(ffmpegPath, decoderArguments(args, item.offsetFrames), childOptions('ignore')), signal, registerResource, children);
    item.iterator = item.decoder.child.stdout[Symbol.asyncIterator]();
    const first = await bounded(item.iterator.next(), signal, 10000, 'CONTINUOUS_DECODE_TIMEOUT');
    if (first.done || !Buffer.isBuffer(first.value) || first.value.length < FRAME_BYTES || first.value.length > 256 * 1024) throw fail('CONTINUOUS_DECODE_FAILED');
    item.pending = first.value; item.bytesRead = first.value.length;
    return item;
  };
  const prepare = async (plan = null) => {
    // Disposal is allowed to wait here, never on the PCM feeder.
    // A catalogue with only two eligible recordings must be able to select the
    // just-finished ID again. Release its descriptor before invoking selection,
    // even when the global three-file limit has not yet been reached.
    if (disposals.size) await Promise.all([...disposals]);
    signal.throwIfAborted();
    if (owned.size >= 3) throw fail('CONTINUOUS_RESOURCE_LIMIT');
    const requested = Promise.resolve().then(() => plan ? schedule.prepareTrack({ plan, signal }) : nextTrack({ recentTrackIds: [...recent], signal })).then(async track => {
      if (!track) return null;
      const item = { track, plan, decoder: null, pending: Buffer.alloc(0), bytesRead: 0, offsetFrames: plan?.offsetFrames || 0 };
      owned.add(item); if (signal.aborted) await dispose(item); return item;
    });
    jobs.add(requested); requested.then(() => jobs.delete(requested), () => jobs.delete(requested));
    const item = await bounded(requested, signal, 30000, 'CONTINUOUS_PREPARE_TIMEOUT').catch(error => {
      // A timed-out caller callback may still own an in-flight file/socket.
      // That uncertainty cannot be treated as a harmless missing programme.
      if (error.code === 'CONTINUOUS_PREPARE_TIMEOUT') error.stopConfirmed = false;
      throw error;
    });
    signal.throwIfAborted(); if (!item) return null;
    try {
      if (owned.size > 3) throw fail('CONTINUOUS_RESOURCE_LIMIT');
      await openDecoder(item, plan);
      if (!plan) { recent.push(item.track.id); if (recent.length > 32) recent.shift(); }
      return item;
    } catch (error) { await dispose(item); throw error; }
  };
  const warm = plan => {
    const state = { plan, done: false, item: null, task: null, error: null };
    state.task = prepare(plan).then(item => { state.done = true; state.item = item; }, error => {
      state.done = true; state.error = error;
      if (plan && error.stopConfirmed !== false && !signal.aborted) {
        try { refuse(plan, 'CONTINUOUS_SCHEDULE_MEDIA_UNAVAILABLE'); } catch (emitError) { controller.abort(emitError); }
      }
      else if (!signal.aborted) controller.abort(error);
    });
    jobs.add(state.task); state.task.then(() => jobs.delete(state.task), () => jobs.delete(state.task));
    return state;
  };
  const switchTo = item => {
    const previous = current;
    if (previous?.entry) { previous.entry.endFrame = fedFrames; previous.entry.completed = previous.finished === true; }
    current = item;
    const phase = item.plan ? 'SCHEDULED' : 'RANDOM';
    item.entry = { trackId: item.track.id, mediaAssetId: item.track.mediaAssetId, startFrame: fedFrames, endFrame: Infinity, audioBytesSent: 0, phase,
      occurrenceId: item.plan?.occurrenceId || null, scheduleRevision: item.plan?.scheduleRevision || null, programmeLabel: item.plan?.programmeLabel || null };
    timeline.push(item.entry);
    if (timeline.length > 8) throw fail('CONTINUOUS_TIMELINE_LIMIT');
    if (previous) disposeLater(previous);
  };
  const prepareUpcoming = (atMs, plan) => {
    if (scheduledReady?.done && (scheduledReady.error || !scheduledReady.item)) scheduledReady = null;
    const boundary = plan.nextBoundaryAtMs;
    const upcoming = Number.isFinite(boundary) && boundary - atMs <= 60000 ? planAt(boundary) : null;
    if (scheduledReady?.done && scheduledReady.item && (!upcoming || upcoming.phase !== 'SCHEDULED' || upcoming.key !== scheduledReady.plan.key)) {
      disposeLater(scheduledReady.item); scheduledReady = null;
    }
    if (!scheduledReady && upcoming?.phase === 'SCHEDULED' && upcoming.key !== current?.plan?.key) scheduledReady = warm(upcoming);
  };
  try {
    current = await prepare(); if (!current) throw fail('CONTINUOUS_CATALOGUE_EMPTY');
    randomReady = warm(null); await randomReady.task; signal.throwIfAborted();
    // Prepare a currently active programme before fixing the presentation
    // anchor. Startup is the only time late joining is permitted.
    let initial = planAt(now() + START_LEAD_MS), initialItem = null;
    if (initial.phase === 'SCHEDULED') {
      try { initialItem = await prepare(initial); }
      catch (error) { if (error.stopConfirmed === false || signal.aborted) throw error; refuse(initial, 'CONTINUOUS_SCHEDULE_MEDIA_UNAVAILABLE'); }
    }
    // Warm at the precise future anchor. A slow startup preparation misses the
    // bounded window and uses random; it must not replay a programme from zero.
    anchor = now() + START_LEAD_MS; originMono = monotonicNow();
    initial = planAt(anchor);
    if (initial.phase === 'SCHEDULED') {
      try {
        if (initialItem && initialItem.plan.key === initial.key) await openDecoder(initialItem, initial);
        else { if (initialItem) await dispose(initialItem); initialItem = await prepare(initial); }
      } catch (error) {
        if (error.stopConfirmed === false || signal.aborted) throw error;
        if (initialItem) await dispose(initialItem); initialItem = null;
      }
      if (initialItem && now() < anchor - 100) {
        const random = current; current = null; switchTo(initialItem); initialItem = null; disposeLater(random);
      } else {
        refuse(initial, 'CONTINUOUS_SCHEDULE_START_NOT_READY');
        if (initialItem) disposeLater(initialItem); initialItem = null;
        anchor = now() + START_LEAD_MS; originMono = monotonicNow();
      }
    } else if (initialItem) disposeLater(initialItem);
    if (!current.entry) { const first = current; current = null; switchTo(first); }
    encoder = ownChild(spawnProcess(ffmpegPath, scheduledContinuousEncoderArguments(), childOptions('pipe')), signal, registerResource, children);
    encoder.child.stdin.on('error', () => {});
    feeder = (async () => {
      while (current) {
        signal.throwIfAborted();
        const atMs = anchor + fedFrames * 1000 / RATE;
        let plan = planAt(atMs);
        if (plan.phase === 'SCHEDULED' && current.plan?.key !== plan.key) {
          if (scheduledReady?.done && scheduledReady.item && scheduledReady.plan.key === plan.key && scheduledReady.plan.offsetFrames === plan.offsetFrames) {
            const next = scheduledReady.item; scheduledReady = null; switchTo(next);
          } else { refuse(plan, 'CONTINUOUS_SCHEDULE_START_NOT_READY'); plan = planAt(atMs); }
        }
        if (plan.phase === 'RANDOM' && current.plan) {
          if (!randomReady?.done || !randomReady.item) throw fail('CONTINUOUS_PREFETCH_NOT_READY');
          const next = randomReady.item; randomReady = null; switchTo(next);
        }
        if (!randomReady && !current.plan) randomReady = warm(null);
        prepareUpcoming(atMs, plan);
        if (current.pending.length < FRAME_BYTES) {
          const read = await bounded(current.iterator.next(), signal, 10000, 'CONTINUOUS_DECODE_TIMEOUT');
          if (read.done) {
            const exitCode = await bounded(current.decoder.exit, signal, 2000);
            const expected = current.plan ? current.plan.totalFrames - current.offsetFrames : null;
            const seconds = current.bytesRead / FRAME_BYTES / RATE;
            if (exitCode !== 0 || current.pending.length || !current.bytesRead || expected !== null && current.bytesRead !== expected * FRAME_BYTES ||
                expected === null && Math.abs(seconds - current.track.durationSeconds) > Math.min(2, Math.max(.1, current.track.durationSeconds * .01))) throw fail('CONTINUOUS_DURATION_MISMATCH');
            current.finished = true;
            if (current.plan) {
              // A valid exact-frame plan changes at this EOF on the next pass.
              const nextPlan = planAt(atMs);
              if (nextPlan.phase === 'SCHEDULED' && nextPlan.key === current.plan.key) throw fail('CONTINUOUS_SCHEDULE_TIMELINE_MISMATCH');
              continue;
            }
            if (!randomReady?.done) throw fail('CONTINUOUS_PREFETCH_NOT_READY');
            if (randomReady.error) throw randomReady.error;
            if (!randomReady.item) {
              current.entry.endFrame = fedFrames; current.entry.completed = true; disposeLater(current); current = null; break;
            }
            const next = randomReady.item; randomReady = null; switchTo(next); continue;
          }
          if (!Buffer.isBuffer(read.value) || read.value.length > 256 * 1024) throw fail('CONTINUOUS_PCM_INVALID');
          current.bytesRead += read.value.length;
          if (current.bytesRead > (current.track.durationSeconds + 2) * RATE * FRAME_BYTES) throw fail('CONTINUOUS_DURATION_MISMATCH');
          current.pending = current.pending.length ? Buffer.concat([current.pending, read.value]) : read.value;
          continue;
        }
        let count = Math.min(BLOCK_FRAMES, Math.floor(current.pending.length / FRAME_BYTES));
        if (Number.isFinite(plan.nextBoundaryAtMs)) {
          const boundaryFrame = Math.ceil((plan.nextBoundaryAtMs - anchor) * RATE / 1000 - .02);
          if (boundaryFrame > fedFrames) count = Math.min(count, boundaryFrame - fedFrames);
        }
        // Bound the pipe queue independently of OS writable buffering and -re.
        await wait(atMs - LEAD_MS - utcNow(), signal);
        if (utcNow() - atMs > LATE_MS) throw fail('CONTINUOUS_CLOCK_OVERRUN');
        while (fedFrames - acceptedFrames > RATE * LEAD_MS / 1000) { await wait(4, signal); if (utcNow() - atMs > LATE_MS) throw fail('CONTINUOUS_CLOCK_OVERRUN'); }
        const chunk = current.pending.subarray(0, count * FRAME_BYTES); current.pending = current.pending.subarray(chunk.length);
        await bounded(new Promise((resolve, reject) => encoder.child.stdin.write(chunk, error => error ? reject(fail('CONTINUOUS_ENCODER_FAILED')) : resolve())), signal);
        fedFrames += count;
      }
      encoder.child.stdin.end();
    })().catch(error => { if (!signal.aborted) controller.abort(error); encoder.kill(); });
    const parser = createTestRadioContinuousMp3Parser();
    for await (const chunk of encoder.child.stdout) for (const frame of parser.push(chunk)) {
      signal.throwIfAborted(); const target = anchor + frame.startFrame * 1000 / RATE;
      await wait(target - utcNow(), signal);
      if (utcNow() - target > LATE_MS) throw fail('CONTINUOUS_CLOCK_OVERRUN');
      while (timeline.length > 1 && frame.startFrame >= timeline[0].endFrame) {
        const ended = timeline.shift(); if (ended.audioBytesSent > 0) { tracksEnded++; report({ type: 'TRACK_ENDED', ...ended, totalAudioBytesSent: bytesSent }); }
      }
      const entry = timeline[0]; if (!entry) throw fail('CONTINUOUS_TIMELINE_INVALID');
      await bounded(Promise.resolve().then(() => { signal.throwIfAborted(); return connection.write(frame.bytes); }), signal);
      signal.throwIfAborted(); acceptedFrames = frame.startFrame + 1152; bytesSent += frame.bytes.length; entry.audioBytesSent += frame.bytes.length;
      if (lastOutput !== entry) {
        lastOutput = entry; tracksStarted++;
        report({ type: 'TRACK_AUDIO_STARTED', ...entry, totalAudioBytesSent: bytesSent, presentationAt: new Date(target).toISOString(), sourceLatenessMs: Math.max(0, utcNow() - target) });
      }
      if (bytesSent - lastProgress >= 16000) { lastProgress = bytesSent; report({ type: 'AUDIO_PROGRESS', ...entry, totalAudioBytesSent: bytesSent }); }
    }
    await feeder; signal.throwIfAborted();
    if (await encoder.exit !== 0) throw fail('CONTINUOUS_ENCODER_FAILED'); parser.finish();
    if (timeline.length !== 1 || !Number.isFinite(timeline[0].endFrame)) throw fail('CONTINUOUS_TIMELINE_INVALID');
    tracksEnded++; report({ type: 'TRACK_ENDED', ...timeline[0], totalAudioBytesSent: bytesSent });
  } catch (error) { failure = externalSignal.aborted ? externalSignal.reason : signal.aborted ? signal.reason : error; }
  finally {
    controller.abort(failure || fail('CONTINUOUS_FINISHED'));
    for (const child of children) child.kill();
    if (feeder) await bounded(feeder, independent()).catch(error => { failure ||= error; });
    if (jobs.size) await bounded(Promise.allSettled([...jobs]), independent()).catch(error => { failure ||= error; });
    const closed = await Promise.all([...children].map(child => child.close()));
    if (closed.every(Boolean)) await Promise.allSettled([...owned].map(dispose));
    externalSignal.removeEventListener('abort', parentStop);
    const stopConfirmed = failure?.stopConfirmed !== false && children.size === 0 && owned.size === 0 && jobs.size === 0 && closed.every(Boolean);
    if (!stopConfirmed) failure ||= fail('CONTINUOUS_STOP_UNCONFIRMED');
    if (failure) { if (!(failure instanceof Error)) failure = fail('CONTINUOUS_STOPPED'); failure.stopConfirmed = stopConfirmed; }
  }
  if (failure) throw failure;
  return { stopConfirmed: true, totalAudioBytesSent: bytesSent, tracksStarted, tracksEnded, completed: true };
}
