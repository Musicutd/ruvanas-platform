// Dedicated, explicitly opted-in continuous Test Radio worker. Never imported
// from the website startup or the normal multi-station encoder dispatcher.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { continuousWorkerMode, continuousDatabaseRoute, CONTINUOUS_STATION_ID, continuousSafeCode, continuousObservationReasonCode, continuousWait,
  continuousBounded, createContinuousByteGuard, createContinuousWatchdog,
  createContinuousObservationQueue } from '../lib/test-radio-continuous-worker.mjs';

export async function serveContinuousTestRadio({ env = process.env, signal: parentSignal } = {}) {
  continuousWorkerMode(['--serve', `--station=${CONTINUOUS_STATION_ID}`, '--monthly-budget-usd=15'], env);
  if (continuousDatabaseRoute(env.DATABASE_URL) !== 'PRIVATE_RENDER_DATABASE') throw Object.assign(new Error('CONTINUOUS_PRIVATE_DATABASE_REQUIRED'), { code: 'CONTINUOUS_PRIVATE_DATABASE_REQUIRED' });
  for (const name of ['DATABASE_URL', 'SECRET_ENCRYPTION_KEY', 'R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    if (typeof env[name] !== 'string' || !env[name].trim()) throw Object.assign(new Error('CONTINUOUS_CONFIGURATION_REQUIRED'), { code: 'CONTINUOUS_CONFIGURATION_REQUIRED' });
  }
  const endpoint = new URL(env.R2_ENDPOINT.trim());
  if (endpoint.protocol !== 'https:' || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) || endpoint.port || endpoint.username || endpoint.password || !['', '/'].includes(endpoint.pathname) || endpoint.search || endpoint.hash) throw Object.assign(new Error('CONTINUOUS_STORAGE_ENDPOINT_INVALID'), { code: 'CONTINUOUS_STORAGE_ENDPOINT_INVALID' });
  const [{ PrismaClient }, { S3Client, GetObjectCommand }, { decryptSecret }, service, transport, audio, metadata, scheduleService, scheduleTimeline] = await Promise.all([
    import('@prisma/client'), import('@aws-sdk/client-s3'), import('../lib/crypto.js'),
    import('../lib/test-radio-continuous-service.mjs'), import('../lib/catalogue-test-transport.mjs'),
    import('../lib/test-radio-continuous-scheduled-playout.mjs'), import('../lib/catalogue-test-https-metadata.mjs'),
    import('../lib/test-radio-continuous-schedule-service.mjs'), import('../lib/test-radio-continuous-schedule-timeline.mjs')
  ]);
  const { catalogueTestTrackMetadata } = await import('../lib/catalogue-test-metadata.mjs');
  const require = createRequire(import.meta.url);
  const ffmpegPath = path.join(path.dirname(require.resolve('ffmpeg-static/package.json')), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const db = new PrismaClient();
  const storage = new S3Client({ region: 'auto', endpoint: endpoint.href, forcePathStyle: true,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim() } });
  const workerId = `continuous-${randomUUID()}`;
  const shutdown = new AbortController();
  const stop = () => shutdown.abort(Object.assign(new Error('CONTINUOUS_STOPPED'), { code: 'CONTINUOUS_STOPPED' }));
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  parentSignal?.addEventListener('abort', stop, { once: true });
  if (parentSignal?.aborted) stop();
  const log = (event, code, details = {}) => console.log(JSON.stringify({ service: 'TEST_RADIO_CONTINUOUS', stationId: CONTINUOUS_STATION_ID, event, ...(code ? { code } : {}), ...details }));
  let lastCode = null, quarantined = false, retries = 0;
  const fail = code => Object.assign(new Error(code), { code });
  async function run(approval, lease) {
    const watchdog = createContinuousWatchdog({ signal: shutdown.signal });
    const signal = watchdog.signal, registerResource = watchdog.registerResource;
    const grantId = approval.grant.id, leaseOwner = lease.leaseOwner;
    let directory = null;
    const preparedTracks = new Map(), titleTracks = new Map(), preparedFiles = new Set(), rejectedTracks = new Map();
    const playedBag = new Set();
    let latest = approval, currentTrackId = null, currentFingerprint = null, currentAudioBytes = 0, lastSourceWrite = null;
    let currentPhase = { phase: 'RANDOM', occurrenceId: null, scheduleRevision: null };
    let heartbeatTask, scheduleTask, measurementTask, titleQueue = null, metadataAbort = null, connection = null, result = null, failure = null;
    let activeFiles = 0, activeFileBytes = 0, latestSchedule = { enabled: false }, measuredFrames = new Map();
    let timeline = scheduleTimeline.buildContinuousScheduleTimeline(latestSchedule, measuredFrames), scheduleWarning = null;
    const observe = createContinuousObservationQueue({
      write: data => continuousBounded(() => service.recordContinuousRadioObservation(db, { grantId, leaseOwner, ...data, now: new Date() }), signal),
      onError: error => watchdog.abort(error)
    });
    const checkFresh = async () => {
      const fresh = await continuousBounded(() => service.loadAuthorizedContinuousRadio(db, { now: new Date(), env, expectedGrantId: grantId }), signal);
      if (fresh.grant.sourceFingerprint !== approval.grant.sourceFingerprint) throw fail('CONTINUOUS_SOURCE_CHANGED');
      for (const track of preparedTracks.values()) {
        if (!fresh.tracks.some(candidate => candidate.track.id === track.track.id && candidate.fingerprint === track.fingerprint)) throw fail('CONTINUOUS_TRACK_APPROVAL_CHANGED');
      }
      if (currentTrackId && !fresh.tracks.some(candidate => candidate.track.id === currentTrackId && candidate.fingerprint === currentFingerprint)) throw fail('CONTINUOUS_TRACK_APPROVAL_CHANGED');
      const renewed = await continuousBounded(() => service.renewContinuousRadioLease(db, { grantId, workerId, leaseOwner, now: new Date(), env }), signal);
      if (renewed !== true) throw fail('CONTINUOUS_LEASE_LOST');
      latest = fresh; watchdog.approve();
      const eligibleIds = new Set(fresh.tracks.map(item => item.track.id));
      for (const id of playedBag) if (!eligibleIds.has(id)) playedBag.delete(id);
      for (const id of titleTracks.keys()) if (!eligibleIds.has(id)) titleTracks.delete(id);
      if (lastSourceWrite !== null && performance.now() - lastSourceWrite > 20000) throw fail('CONTINUOUS_AUDIO_STALLED');
      if (currentTrackId && currentAudioBytes > 0 && lastSourceWrite !== null && performance.now() - lastSourceWrite < 4000) observe.push({ state: 'STREAMING', trackId: currentTrackId, audioBytesSent: currentAudioBytes, ...currentPhase });
    };
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'ruvanas-continuous-'));
      await continuousBounded(() => service.recordContinuousRadioObservation(db, { grantId, leaseOwner, state: 'STARTING', now: new Date() }), signal);
      heartbeatTask = (async () => {
        while (!signal.aborted) {
          try { await checkFresh(); }
          catch (error) { watchdog.abort(error); break; }
          await continuousWait(3000, signal);
        }
      })();
      const rebuildTimeline = () => {
        try { timeline = scheduleTimeline.buildContinuousScheduleTimeline(latestSchedule, measuredFrames); }
        catch { timeline = scheduleTimeline.buildContinuousScheduleTimeline({ enabled: false }, measuredFrames); }
      };
      // Planner loading never blocks PCM or lease renewal. Bad/stale planner
      // data disables programmes, not the separately approved random catalogue.
      scheduleTask = (async () => {
        while (!signal.aborted) {
          try {
            const loaded = await continuousBounded(() => scheduleService.loadAuthorizedContinuousSchedule(db, { authorized: latest, now: new Date(), env }), signal, 3000);
            latestSchedule = loaded; rebuildTimeline();
            const code = loaded.enabled ? null : loaded.reasonCode || null;
            if (code && code !== scheduleWarning) log('schedule_random_fallback', code);
            scheduleWarning = code;
          } catch {
            latestSchedule = { enabled: false }; rebuildTimeline();
            if (!signal.aborted && scheduleWarning !== 'CONTINUOUS_SCHEDULE_UNAVAILABLE') log('schedule_random_fallback', 'CONTINUOUS_SCHEDULE_UNAVAILABLE');
            scheduleWarning = 'CONTINUOUS_SCHEDULE_UNAVAILABLE';
          }
          await continuousWait(3000, signal);
        }
      })();
      async function prepareSelected(selected, preparationSignal, { measurement = false } = {}) {
        const asset = selected.track.mediaAsset, identity = transport.catalogueTestMediaIdentity(asset);
        // Three compressed files maximum (each <=50 MiB): current, random
        // fallback, and scheduled prefetch OR the one precision measurement.
        while (activeFiles >= 3 || activeFileBytes + identity.sizeBytes > 150 * 1024 * 1024) {
          await continuousWait(25, preparationSignal); preparationSignal.throwIfAborted();
        }
        preparationSignal.throwIfAborted(); activeFiles++; activeFileBytes += identity.sizeBytes;
        const file = path.join(directory, `${randomUUID()}.${identity.extension}`); let released = false;
        preparedFiles.add(file);
        const dispose = async () => {
          if (released) return; released = true;
          preparedTracks.delete(file); await rm(file, { force: true }); preparedFiles.delete(file);
          activeFiles--; activeFileBytes -= identity.sizeBytes;
        };
        try {
          const fileSignal = AbortSignal.any([preparationSignal, AbortSignal.timeout(30000)]);
          const object = await storage.send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: asset.storageKey }), { abortSignal: fileSignal });
          if (!object.Body || Number(object.ContentLength) !== identity.sizeBytes) { object.Body?.destroy?.(); throw fail('CONTINUOUS_MEDIA_SIZE_MISMATCH'); }
          await transport.downloadCatalogueTestMedia(object.Body, file, asset, { signal: fileSignal });
          preparationSignal.throwIfAborted();
          if (!latest.tracks.some(item => item.track.id === selected.track.id && item.fingerprint === selected.fingerprint)) throw fail('CONTINUOUS_TRACK_APPROVAL_CHANGED');
          preparedTracks.set(file, { ...selected, measurement }); titleTracks.set(selected.track.id, selected);
          return { id: selected.track.id, mediaAssetId: asset.id, filePath: file, durationSeconds: selected.durationSeconds, dispose };
        } catch (error) { await dispose(); throw error; }
      }
      async function prepareScheduled({ plan, signal: engineSignal }) {
        const preparationSignal = AbortSignal.any([signal, engineSignal]);
        const selected = latest.tracks.find(item => item.track.id === plan.trackId && item.fingerprint === plan.fingerprint);
        if (!selected) throw fail('CONTINUOUS_TRACK_APPROVAL_CHANGED');
        return prepareSelected(selected, preparationSignal);
      }
      // Measure only programmes in the next hour, one decoder at a time, and
      // at most 64 unique candidates per recipe. Larger/unready recipes stay
      // random with a warning; we never scan an unbounded catalogue at startup.
      measurementTask = (async () => {
        const refused = new Map();
        while (!signal.aborted) {
          let candidate = null;
          const instant = Date.now();
          for (const occurrence of latestSchedule.enabled ? latestSchedule.occurrences || [] : []) {
            if (Date.parse(occurrence.endsAt) <= instant || Date.parse(occurrence.startsAt) > instant + 3600000) continue;
            if (occurrence.tracks.length > 64) continue;
            candidate = occurrence.tracks.find(track => !measuredFrames.has(track.fingerprint) && (refused.get(track.fingerprint) || 0) <= instant);
            if (candidate) break;
          }
          if (!candidate) { await continuousWait(1000, signal); continue; }
          let track;
          try {
            const selected = latest.tracks.find(item => item.track.id === candidate.trackId && item.fingerprint === candidate.fingerprint);
            if (!selected) throw fail('CONTINUOUS_TRACK_APPROVAL_CHANGED');
            track = await prepareSelected(selected, signal, { measurement: true });
            const frames = await audio.measureContinuousAudioFrames({ ffmpegPath, track, signal, registerResource });
            if (measuredFrames.size >= 256) measuredFrames.delete(measuredFrames.keys().next().value);
            measuredFrames.set(candidate.fingerprint, frames); rebuildTimeline();
          } catch (error) {
            if (error.stopConfirmed === false) { watchdog.abort(error); break; }
            if (!signal.aborted) { refused.set(candidate.fingerprint, Date.now() + 600000); log('schedule_media_unavailable', continuousSafeCode(error)); }
          } finally { if (track) await track.dispose().catch(error => watchdog.abort(error)); }
          if (refused.size > 256) refused.delete(refused.keys().next().value);
          await continuousWait(25, signal);
        }
      })();
      async function nextTrack({ recentTrackIds = [], signal: engineSignal } = {}) {
        const preparationSignal = engineSignal ? AbortSignal.any([signal, engineSignal]) : signal;
        preparationSignal.throwIfAborted();
        // Selection is fresh, rights-filtered and independent of the old test's
        // fixed plan. Play every currently eligible recording before reshuffle.
        for (let attempts = 0; attempts < Math.min(20, latest.tracks.length); attempts++) {
          const instant = Date.now();
          for (const [id, until] of rejectedTracks) if (until <= instant) rejectedTracks.delete(id);
          const occupiedIds = new Set([...preparedTracks.values()].filter(item => !item.measurement).map(item => item.track.id));
          const all = latest.tracks.filter(item => !occupiedIds.has(item.track.id) && (rejectedTracks.get(item.track.id) || 0) < instant);
          if (!all.length) throw fail('CONTINUOUS_NO_AVAILABLE_AUDIO');
          let candidates = all.filter(item => !playedBag.has(item.track.id));
          if (!candidates.length) { playedBag.clear(); candidates = all; }
          const nonRecent = candidates.filter(item => !recentTrackIds.slice(-2).includes(item.track.id));
          if (nonRecent.length) candidates = nonRecent;
          const selected = candidates[randomInt(candidates.length)];
          try {
            const prepared = await prepareSelected(selected, preparationSignal); playedBag.add(selected.track.id); return prepared;
          } catch (error) {
            if (preparationSignal.aborted) preparationSignal.throwIfAborted();
            rejectedTracks.set(selected.track.id, Date.now() + 10 * 60000);
            log('track_prepare_refused', continuousSafeCode(error));
          }
        }
        throw fail('CONTINUOUS_NO_AVAILABLE_AUDIO');
      }
      // A fresh authenticated connection is used only for initial startup or a
      // confirmed failure recovery, never for normal song-to-song changes.
      const startingTracks = [await nextTrack(), await nextTrack()];
      await checkFresh();
      connection = await transport.connectCatalogueTestSource({ source: latest.source, password: decryptSecret(latest.source.sourcePasswordEncrypted), signal, registerResource });
      const budget = createContinuousByteGuard({ signal,
        reserve: data => service.reserveContinuousRadioBytes(db, { grantId, leaseOwner, ...data, env }),
        write: async chunk => { await connection.write(chunk); lastSourceWrite = performance.now(); }
      });
      const source = { authenticated: true, hasError: () => connection.hasError(), write: chunk => budget.write(chunk) };
      const updateTitle = metadata.createCatalogueTestHttpsMetadataUpdater({ enabled: true, stationId: CONTINUOUS_STATION_ID,
        source: latest.source, password: decryptSecret(latest.source.sourcePasswordEncrypted), connection, registerResource });
      titleQueue = createContinuousObservationQueue({ write: async title => {
        if (signal.aborted) return;
        const titleStop = new AbortController(); metadataAbort = titleStop;
        const titleSignal = AbortSignal.any([signal, titleStop.signal, AbortSignal.timeout(2500)]);
        const verified = await updateTitle({ metadata: { ...title, stationId: CONTINUOUS_STATION_ID }, signal: titleSignal });
        log('song_title', verified ? 'CONTINUOUS_TITLE_VERIFIED' : 'CONTINUOUS_TITLE_UNVERIFIED');
      }, onError: () => log('song_title', 'CONTINUOUS_TITLE_UNVERIFIED') });
      log('source_authenticated');
      result = await audio.runScheduledContinuousPlayout({ ffmpegPath, connection: source, signal, registerResource,
        nextTrack: options => startingTracks.length ? Promise.resolve(startingTracks.shift()) : nextTrack(options),
        schedule: { planAt: instant => timeline.planAt(instant), prepareTrack: prepareScheduled },
        emit(event) {
          if (event.type === 'TRACK_AUDIO_STARTED') {
            currentTrackId = event.trackId; currentAudioBytes = event.audioBytesSent;
            currentFingerprint = titleTracks.get(currentTrackId)?.fingerprint || null;
            currentPhase = { phase: event.phase, occurrenceId: event.occurrenceId || null, scheduleRevision: event.scheduleRevision || null };
            observe.push({ state: 'STREAMING', trackId: currentTrackId, audioBytesSent: currentAudioBytes, ...currentPhase });
            log('track_audio_started', null, { trackId: currentTrackId, ...currentPhase, presentationAt: event.presentationAt, sourceLatenessMs: event.sourceLatenessMs, senderEvidenceOnly: true });
            const entry = titleTracks.get(currentTrackId);
            const title = entry && catalogueTestTrackMetadata({ id: currentTrackId, track: entry.track });
            metadataAbort?.abort();
            // Never overlap or block audio for a slow title request.
            if (title) titleQueue.push(title);
          }
          if (event.type === 'SCHEDULE_FALLBACK') log('schedule_random_fallback', event.reasonCode, { occurrenceId: event.occurrenceId });
          if (event.type === 'AUDIO_PROGRESS' && event.trackId === currentTrackId) currentAudioBytes = event.audioBytesSent;
          // Keep a bounded catalogue map: the same ID may already be prefetched
          // again when an older occurrence emits its final encoder frame.
          return !signal.aborted;
        }
      });
    } catch (error) { failure = error; }
    finally {
      metadataAbort?.abort(); watchdog.abort(failure || fail('CONTINUOUS_STOPPED'));
      await heartbeatTask;
      await Promise.all([scheduleTask, measurementTask]);
      await observe.flush();
      // Record source closure separately from metadata cleanup: a stalled title
      // request is not evidence that the music source is still connected.
      const [resourcesClosed, sourceClosed] = await Promise.all([
        watchdog.close(),
        connection ? continuousBounded(() => connection.close(), new AbortController().signal, 2500)
          .then(() => true, () => false) : Promise.resolve(true)
      ]);
      let metadataCleanupConfirmed = true;
      try { await continuousBounded(() => titleQueue?.flush(), new AbortController().signal, 3000); }
      catch { metadataCleanupConfirmed = false; failure ||= fail('CONTINUOUS_METADATA_STOP_UNCONFIRMED'); }
      const audioStopConfirmed = sourceClosed && result?.stopConfirmed !== false && failure?.stopConfirmed !== false;
      const stopConfirmed = resourcesClosed && audioStopConfirmed && metadataCleanupConfirmed;
      // Do not remove media or release a lease when a child/socket did not
      // confirm closure: hold the quarantine for explicit human inspection.
      if (stopConfirmed && directory) await rm(directory, { recursive: true, force: true });
      if (failure && stopConfirmed && !shutdown.signal.aborted) {
        await continuousBounded(() => service.recordContinuousRadioObservation(db, { grantId, leaseOwner, state: 'ERROR',
          reasonCode: continuousObservationReasonCode(failure), now: new Date(), env }), new AbortController().signal).catch(() => undefined);
      }
      const leaseReleaseConfirmed = await continuousBounded(() => service.releaseContinuousRadioLease(db,
        { leaseOwner, now: new Date(), stopConfirmed }), new AbortController().signal, 5000)
        .then(() => true, () => false);
      if (!leaseReleaseConfirmed) quarantined = true;
      if (!stopConfirmed) quarantined = true;
      log('source_stopped', failure ? continuousSafeCode(failure) : 'CONTINUOUS_STOPPED',
        { stopConfirmed, audioStopConfirmed, metadataCleanupConfirmed, leaseReleaseConfirmed });
      if (failure) throw failure;
    }
  }
  try {
    log('worker_ready', null, { streamingStarted: false, monthlyBudgetUsd: 15, bitrateKbps: 128 });
    while (!shutdown.signal.aborted && !quarantined) {
      try {
        const approval = await continuousBounded(() => service.loadAuthorizedContinuousRadio(db, { now: new Date(), env }), shutdown.signal);
        const lease = await continuousBounded(() => service.claimContinuousRadioLease(db, { grantId: approval.grant.id, workerId, now: new Date(), env }), shutdown.signal);
        if (!lease?.leaseOwner) throw fail('CONTINUOUS_LEASE_BUSY');
        lastCode = null; await run(approval, lease); retries = 0;
      } catch (error) {
        const code = continuousSafeCode(error);
        if (lastCode !== code) log('waiting_or_recovering', code);
        lastCode = code; retries = Math.min(5, retries + 1);
      }
      await continuousWait(Math.min(60000, 5000 * Math.max(1, retries)), shutdown.signal);
    }
    if (quarantined) {
      log('manual_review_required', 'CONTINUOUS_STOP_UNCONFIRMED');
      while (!shutdown.signal.aborted) await continuousWait(60000, shutdown.signal);
    }
  } finally {
    stop(); storage.destroy(); await db.$disconnect();
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    parentSignal?.removeEventListener('abort', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const mode = continuousWorkerMode(process.argv.slice(2), process.env);
    if (mode === 'CHECK_ONLY') console.log(JSON.stringify({ service: 'TEST_RADIO_CONTINUOUS', mode, streamingStarted: false, cloudAccessed: false }));
    else await serveContinuousTestRadio();
  } catch (error) { console.error(JSON.stringify({ service: 'TEST_RADIO_CONTINUOUS', code: continuousSafeCode(error) })); process.exitCode = 1; }
}
