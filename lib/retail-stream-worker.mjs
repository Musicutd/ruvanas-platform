import { randomUUID, randomInt } from "node:crypto";
import { performance } from "node:perf_hooks";
import { retailCapacityAssignments, retailCapacityPools } from "./retail-stream-playout-policy.mjs";
import { subscriberAudioWait as wait, subscriberAudioBounded as bounded,
  createSubscriberWatchdog, createSubscriberByteGuard, createSubscriberObservationQueue } from "./subscriber-stream-audio-runtime.mjs";
import { runSubscriberStreamAudio, measureSubscriberAudioFrames } from "./subscriber-stream-audio.mjs";
import { buildSubscriberScheduleTimeline } from "./subscriber-stream-audio-timeline.mjs";
import { loadRetailStreamSchedule } from "./retail-stream-schedule.mjs";
import { loadRetailCommercialSchedule } from "./retail-commercial-approval.mjs";
import { createRetailCommercialTimeline } from "./retail-commercial-timeline.mjs";
import { RETAIL_METADATA_STATION_ID, retailTrackMetadata, createRetailMetadataQueue } from "./retail-stream-https-metadata.mjs";

const fail = code => Object.assign(new Error(code), { code });
export const retailWorkerCode = error => /^(RETAIL|SUBSCRIBER_AUDIO)_[A-Z_]{1,100}$/.test(error?.code || "") ? error.code : "RETAIL_WORKER_OPERATION_FAILED";

export function retailWorkerMode(args = [], env = {}) {
  if (!args.length || args.length === 1 && args[0] === "--check") return { mode: "CHECK_ONLY", assignments: [] };
  if (args.length === 1 && args[0] === "--standby") return { mode: "STANDBY", assignments: [] };
  if (args.length !== 1 || args[0] !== "--serve" || env.RUVANAS_RETAIL_PLAYOUT_ENABLED !== "true") throw fail("RETAIL_WORKER_NOT_ENABLED");
  const workerId = env.RENDER_SERVICE_ID;
  if (typeof workerId !== "string" || !/^srv-[a-zA-Z0-9_-]{5,90}$/.test(workerId) || workerId === "srv-damhnbv40ujc73b00lgg") throw fail("RETAIL_WORKER_ID_INVALID");
  const pool = retailCapacityPools(env).find(row => row.workerId === workerId);
  const maximum = env.RUVANAS_RETAIL_MAX_SLOTS === undefined ? (pool?.slots || 1) : Number(env.RUVANAS_RETAIL_MAX_SLOTS);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 4) throw fail("RETAIL_WORKER_CAPACITY_INVALID");
  const assignments = retailCapacityAssignments(env).filter(row => row.workerId === workerId);
  if (!assignments.length && !pool || assignments.length > maximum || pool && pool.slots > maximum) throw fail("RETAIL_WORKER_CAPACITY_INVALID");
  return { mode: "SERVE_APPROVED_RETAIL", workerId, assignments, maximumSlots: maximum };
}

export function retailPrivateDatabase(value) {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) && /^dpg-[a-z0-9-]+$/.test(url.hostname) &&
      (!url.port || url.port === "5432") && !url.hash && ![...url.searchParams.keys()].some(key => /^(?:host|hostaddr|port|service)$/i.test(key));
  } catch { return false; }
}

/** One independently leased programme, regardless of the number of shops.
 * Network/storage/process adapters are injected, so the complete lifecycle can
 * be exercised locally without credentials or any live station.
 */
export async function runRetailOutputSession({ db, service, assignment, workerId, env, signal: parentSignal,
  openMediaSession, connect, ffmpegPath, runAudio = runSubscriberStreamAudio, measureFrames = measureSubscriberAudioFrames,
  loadSchedule = loadRetailStreamSchedule, loadCommercials = loadRetailCommercialSchedule, createMetadataUpdater, log = () => {}, now = () => new Date() }) {
  const scope = { organisationId: assignment.organisationId, stationId: assignment.stationId, workerId, env };
  const approval = await bounded(() => service.loadAuthorizedRetailPlayout(db, { ...scope, now: now() }), parentSignal);
  const grantId = approval.grant.id;
  const lease = await bounded(() => service.claimRetailPlayoutLease(db, { ...scope, grantId, instanceId: randomUUID(), now: now() }), parentSignal);
  if (!lease?.leaseOwner) throw fail("RETAIL_WORKER_LEASE_UNAVAILABLE");
  const options = { ...scope, grantId, leaseOwner: lease.leaseOwner };
  const watchdog = createSubscriberWatchdog({ signal: parentSignal });
  const signal = watchdog.signal, registerResource = watchdog.registerResource;
  let latest = approval, media, connection, heartbeat, planner, measurement, result, failure, titleQueue;
  let lastWrite = null, currentTrack = null, currentFingerprint = null, currentKind = "MUSIC", audioBytes = 0, phase = { phase: "UNKNOWN" };
  let snapshot = { enabled: false }, timeline = buildSubscriberScheduleTimeline(snapshot, new Map());
  let commercialSnapshot = { enabled: false };
  const commercials = createRetailCommercialTimeline({ now: () => now().getTime() });
  let measurementAbort = null, commercialPrefetchUntil = 0;
  const measured = new Map(), prepared = new Map(), recentBag = new Set(), rejected = new Map(), fingerprints = new Map();
  const kindOf = entry => entry?.contentKind === "COMMERCIAL" ? "COMMERCIAL" : "MUSIC";
  const mediaKey = (kind, id) => `${kind}:${id}`;
  const commercialEntries = () => commercialSnapshot.enabled && Date.parse(commercialSnapshot.validUntil) > now().getTime() ? commercialSnapshot.spots : [];
  const entriesFor = kind => kind === "COMMERCIAL" ? commercialEntries() : latest.tracks;
  const observe = createSubscriberObservationQueue({
    write: data => bounded(() => service.recordRetailPlayoutObservation(db, { ...options, ...data, now: now() }), signal),
    onError: error => watchdog.abort(error)
  });
  function emit(event) {
    if (event.type === "TRACK_AUDIO_STARTED") {
      currentTrack = event.trackId; currentKind = event.contentKind === "COMMERCIAL" ? "COMMERCIAL" : "MUSIC";
      currentFingerprint = fingerprints.get(mediaKey(currentKind, currentTrack)); audioBytes = event.audioBytesSent;
      phase = { phase: currentKind === "COMMERCIAL" ? "COMMERCIAL" : event.phase, occurrenceId: event.occurrenceId || null, scheduleRevision: event.scheduleRevision || null,
        commercialRevision: event.commercialRevision || null, commercialRuleName: event.ruleName || null,
        presentationAt: event.presentationAt, sourceLatenessMs: event.sourceLatenessMs };
      observe.push({ state: "STREAMING", trackId: currentTrack, audioBytesSent: audioBytes, ...phase });
      log("track_audio_started", { trackId: currentTrack, ...phase, senderEvidenceOnly: true });
      const entry = entriesFor(currentKind).find(row => row.track.id === currentTrack && row.fingerprint === currentFingerprint);
      const title = entry && retailTrackMetadata(entry.track);
      // The audio engine emits this only after a successful MP3 source write.
      // Title networking is optional, serialized and never awaited by audio.
      if (titleQueue && title && lastWrite !== null && Number.isSafeInteger(audioBytes) && audioBytes > 0 && !signal.aborted) titleQueue.push(title);
    } else if (event.type === "AUDIO_PROGRESS" && event.trackId === currentTrack) audioBytes = event.audioBytesSent;
    else if (event.type === "SCHEDULE_FALLBACK") log(event.contentKind === "COMMERCIAL" ? "commercial_skipped" : "schedule_random_fallback", { code: retailWorkerCode({ code: event.reasonCode }) });
    return !signal.aborted;
  }
  async function fresh() {
    const value = await bounded(() => service.loadAuthorizedRetailPlayout(db, { ...scope, expectedGrantId: grantId, now: now() }), signal);
    if (value.grant.sourceFingerprint !== approval.grant.sourceFingerprint) throw fail("RETAIL_WORKER_SOURCE_CHANGED");
    // Commercial approval is refreshed independently. Revoked or missing spots
    // drop out of the timeline and return to music without taking the source down.
    for (const row of prepared.values()) if (kindOf(row) === "MUSIC" && !value.tracks.some(item => item.track.id === row.track.id && item.fingerprint === row.fingerprint)) throw fail("RETAIL_WORKER_TRACK_CHANGED");
    if (currentKind === "MUSIC" && currentTrack && !value.tracks.some(item => item.track.id === currentTrack && item.fingerprint === currentFingerprint)) throw fail("RETAIL_WORKER_TRACK_CHANGED");
    if (await bounded(() => service.renewRetailPlayoutLease(db, { ...options, now: now() }), signal) !== true) throw fail("RETAIL_WORKER_LEASE_LOST");
    latest = value; watchdog.approve();
    const eligible = new Set(value.tracks.map(row => row.track.id));
    for (const key of recentBag) if (!eligible.has(key)) recentBag.delete(key);
    for (const key of rejected.keys()) if (!eligible.has(key)) rejected.delete(key);
    const authorizedEntries = [...value.tracks, ...commercialEntries()];
    const eligibleKeys = new Set(authorizedEntries.map(row => mediaKey(kindOf(row), row.track.id)));
    for (const key of fingerprints.keys()) if (!eligibleKeys.has(key)) fingerprints.delete(key);
    const activeFingerprints = new Set(authorizedEntries.map(row => row.fingerprint));
    for (const key of measured.keys()) if (!activeFingerprints.has(key)) measured.delete(key);
    if (lastWrite !== null && performance.now() - lastWrite > 20000) throw fail("RETAIL_WORKER_AUDIO_STALLED");
    if (currentTrack && entriesFor(currentKind).some(row => row.track.id === currentTrack && row.fingerprint === currentFingerprint) && audioBytes && lastWrite !== null && performance.now() - lastWrite < 4000)
      observe.push({ state: "STREAMING", trackId: currentTrack, audioBytesSent: audioBytes, ...phase });
  }
  async function prepare(entry, operationSignal = signal) {
    const item = await media.prepare(entry, operationSignal);
    try {
      operationSignal.throwIfAborted();
      if (!entriesFor(kindOf(entry)).some(row => row.track.id === entry.track.id && row.fingerprint === entry.fingerprint)) throw fail("RETAIL_WORKER_TRACK_CHANGED");
      prepared.set(item.filePath, entry); fingerprints.set(mediaKey(kindOf(entry), entry.track.id), entry.fingerprint);
      return { ...item, dispose: async () => { prepared.delete(item.filePath); await item.dispose(); } };
    } catch (error) {
      await item.dispose(); throw error;
    }
  }
  async function nextTrack({ recentTrackIds = [], signal: engineSignal = signal } = {}) {
    const operationSignal = AbortSignal.any([signal, engineSignal]);
    for (let attempt = 0; attempt < 8; attempt++) {
      operationSignal.throwIfAborted();
      const available = latest.tracks.filter(entry => (rejected.get(entry.track.id) || 0) <= Date.now());
      let pool = available.filter(entry => !recentBag.has(entry.track.id));
      if (!pool.length) { recentBag.clear(); pool = available; }
      const lessRecent = pool.filter(entry => !recentTrackIds.includes(entry.track.id));
      if (lessRecent.length) pool = lessRecent;
      if (!pool.length) throw fail("RETAIL_WORKER_NO_AUDIO");
      const chosen = pool[randomInt(pool.length)];
      try { const item = await prepare(chosen, operationSignal); recentBag.add(chosen.track.id); return item; }
      catch (error) { operationSignal.throwIfAborted(); rejected.set(chosen.track.id, Date.now() + 600000); log("track_unavailable", { code: retailWorkerCode(error) }); }
    }
    throw fail("RETAIL_WORKER_NO_AUDIO");
  }
  const rebuild = () => { timeline = buildSubscriberScheduleTimeline(snapshot, measured); commercials.update(commercialSnapshot, measured); };
  const planAt = instant => {
    const plan = commercials.planAt(instant, timeline.planAt(instant)), boundary = plan.nextBoundaryAtMs;
    const upcoming = Number.isFinite(boundary) && boundary - instant <= 60000
      ? commercials.planAt(boundary, timeline.planAt(boundary)) : null;
    if (plan.contentKind === "COMMERCIAL" || upcoming?.contentKind === "COMMERCIAL") {
      commercialPrefetchUntil = Date.now() + 1000; measurementAbort?.abort();
    }
    return plan;
  };
  try {
    media = await openMediaSession({ signal });
    await bounded(() => service.recordRetailPlayoutObservation(db, { ...options, state: "STARTING", now: now() }), signal);
    heartbeat = (async () => { while (!signal.aborted) { try { await fresh(); } catch (error) { watchdog.abort(error); break; } await wait(3000, signal); } })();
    planner = (async () => { while (!signal.aborted) {
      try { snapshot = await bounded(() => loadSchedule(db, { authorized: latest, now: now() }), signal); rebuild(); }
      catch { snapshot = { enabled: false }; rebuild(); }
      try { commercialSnapshot = await bounded(() => loadCommercials(db, { authorized: latest, now: now() }), signal); rebuild(); }
      catch { commercialSnapshot = { enabled: false }; rebuild(); }
      // Prioritise prefetch of a ready imminent programme over background
      // duration measurement competing for the third compressed-file slot.
      if ((snapshot.occurrences || []).some(row => Date.parse(row.startsAt) > Date.now() && Date.parse(row.startsAt) - Date.now() < 15000)) measurementAbort?.abort();
      await wait(3000, signal);
    } })().catch(error => watchdog.abort(error));
    measurement = (async () => { while (!signal.aborted) {
      if (commercialPrefetchUntil > Date.now() || (snapshot.occurrences || []).some(row => Date.parse(row.startsAt) > Date.now() && Date.parse(row.startsAt) - Date.now() < 15000)) {
        await wait(1000, signal); continue;
      }
      const required = (snapshot.occurrences || []).filter(row => Date.parse(row.startsAt) < Date.now() + 3600000)
        .flatMap(row => row.tracks || []);
      const request = required.find(row => !measured.has(row.fingerprint));
      const selected = request ? latest.tracks.find(row => row.track.id === request.trackId && row.fingerprint === request.fingerprint)
        : commercialEntries().find(row => !measured.has(row.fingerprint));
      if (selected) {
        let item, retryMeasurement = false;
        measurementAbort = new AbortController();
        const measureSignal = AbortSignal.any([signal, measurementAbort.signal]);
        try { item = await prepare(selected, measureSignal); const frames = await measureFrames({ ffmpegPath, track: item, signal: measureSignal, registerResource });
          measured.set(selected.fingerprint, frames); rebuild(); }
        catch (error) { if (!signal.aborted && !measurementAbort.signal.aborted) { log(kindOf(selected) === "COMMERCIAL" ? "commercial_media_unavailable" : "schedule_media_unavailable", { code: retailWorkerCode(error) }); retryMeasurement = true; } }
        finally { await item?.dispose(); measurementAbort = null; }
        if (retryMeasurement) await wait(15000, signal);
      } else await wait(1000, signal);
    } })().catch(error => watchdog.abort(error));
    const startup = [await nextTrack(), await nextTrack()];
    await fresh();
    connection = await connect({ source: latest.source, signal, registerResource, stationName: latest.station.name });
    if (assignment.stationId === RETAIL_METADATA_STATION_ID && typeof createMetadataUpdater === "function") {
      try {
        const update = createMetadataUpdater({ stationId: assignment.stationId, source: latest.source, connection, registerResource });
        titleQueue = createRetailMetadataQueue({ update, signal, onResult: code => log("song_title", { code }) });
      } catch { log("song_title", { code: "RETAIL_METADATA_UNVERIFIED" }); }
    }
    const budget = createSubscriberByteGuard({ signal,
      reserve: data => service.reserveRetailPlayoutBytes(db, { ...options, ...data }),
      write: async bytes => { await connection.write(bytes); lastWrite = performance.now(); }
    });
    log("source_authenticated", { listenerAudioVerified: false });
    result = await runAudio({ ffmpegPath, signal, registerResource, connection: { authenticated: true, write: bytes => budget.write(bytes) },
      nextTrack: data => startup.length ? Promise.resolve(startup.shift()) : nextTrack(data), emit,
      schedule: { planAt,
        musicStarted: event => commercials.musicStarted(event), musicFinished: event => commercials.musicFinished(event),
        refuse: occurrenceId => commercials.refuse(occurrenceId),
        prepareTrack: async ({ plan, signal: engineSignal }) => {
        const entry = entriesFor(plan.contentKind).find(row => row.track.id === plan.trackId && row.fingerprint === plan.fingerprint);
        if (!entry) throw fail("RETAIL_WORKER_TRACK_CHANGED"); return prepare(entry, AbortSignal.any([signal, engineSignal]));
      } } });
  } catch (error) { failure = error; }
  finally {
    watchdog.abort(failure || fail("RETAIL_WORKER_STOPPED"));
    const metadataStopped = titleQueue?.close();
    await Promise.allSettled([heartbeat, planner, measurement]);
    await observe.flush();
    const resourcesClosed = await watchdog.close();
    const metadataCleanupConfirmed = !titleQueue || await bounded(() => metadataStopped, new AbortController().signal, 3000).then(() => true, () => false);
    const sourceClosed = !connection || await bounded(() => connection.close(), new AbortController().signal, 2500).then(() => true, () => false);
    const audioStopConfirmed = resourcesClosed && sourceClosed && result?.stopConfirmed !== false && failure?.stopConfirmed !== false;
    let cacheCleanupConfirmed = true;
    if (audioStopConfirmed) try { await media?.disposeAll(); } catch { cacheCleanupConfirmed = false; }
    const stopConfirmed = audioStopConfirmed && cacheCleanupConfirmed && metadataCleanupConfirmed;
    const released = await bounded(() => service.releaseRetailPlayoutLease(db, { ...scope, leaseOwner: lease.leaseOwner, now: now(), stopConfirmed }), new AbortController().signal)
      .then(value => value === true, () => false);
    log("source_stopped", { stopConfirmed, audioStopConfirmed, cacheCleanupConfirmed, metadataCleanupConfirmed, leaseReleaseConfirmed: released, code: failure ? retailWorkerCode(failure) : null });
    if (!stopConfirmed || !released) throw fail("RETAIL_WORKER_STOP_UNCONFIRMED");
  }
  if (failure) throw failure;
  return { stopConfirmed: true };
}
