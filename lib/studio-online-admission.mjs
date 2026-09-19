import { resolveEntitlements } from "./entitlements.mjs";
import { eligibleOnlineRadioRotation, rotationFingerprint } from "./online-radio-output.mjs";
import { readStudioOnlineAuthority } from "./studio-online-authority.mjs";
import { planStudioOnlineOutput } from "./studio-online-output-plan.mjs";
import { validateStudioIsolatedTestTarget } from "./studio-isolated-test-target.mjs";

const MAX_AUDIO_MS = 12 * 60 * 60 * 1000;

function result(ready, reason) {
  // This is an eligibility diagnostic, never a source-switch command or
  // evidence that the protected audio reached a listener.
  return { ready, reason };
}

const modeInclude = {
  tracks: { include: { track: { include: {
    mediaAsset: { include: { genres: { include: { mediaGenre: true } } } }
  } } } }
};

// Read the lease, AutoDJ fallback, Manual queue, current rights and protected
// programming in one repeatable-read snapshot. A live output adapter would
// still need to recheck at the moment of switching and on every preemption.
async function inspectStudioOnlineAdmission(database, {
  stationId, workerOwner, clock = () => new Date()
}) {
  if (!stationId || !workerOwner) return result(false, "ADMISSION_SCOPE_MISSING");
  try {
    const capturedAt = clock();
    if (!(capturedAt instanceof Date) || Number.isNaN(capturedAt.valueOf())) return result(false, "ADMISSION_CLOCK_INVALID");
    const snapshot = await database.$transaction(async (tx) => {
      const station = await tx.station.findUnique({
        where: { id: stationId },
        include: {
          streamConfig: true,
          organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } },
          channels: {
            where: { status: "ACTIVE" }, take: 2,
            include: { autoDjPolicy: { include: {
              defaultMusicMode: { include: modeInclude },
              backupMusicMode: { include: modeInclude }
            } } }
          }
        }
      });
      if (!station) return { reason: "ADMISSION_STATION_UNAVAILABLE" };
      if (station.channels.length !== 1) return { reason: "ADMISSION_CHANNEL_AMBIGUOUS" };
      if (station.channels[0].organisationId !== station.organisationId || station.channels[0].stationId !== station.id) {
        return { reason: "ADMISSION_CHANNEL_MISMATCH" };
      }
      const entitlements = resolveEntitlements(station.organisation?.subscription, capturedAt);
      const configuredGenres = await tx.mediaGenre.findMany({
        where: { active: true },
        select: { name: true, slug: true, active: true, minimumCatalogueLevel: true }, take: 250
      });
      const rotation = eligibleOnlineRadioRotation(station, entitlements, capturedAt, configuredGenres);
      if (!rotation.ready) return { reason: rotation.reason };
      const bitrateKbps = station.streamConfig.bitrateKbps || Math.min(128, station.maxBitrateKbps, entitlements.maxBitrateKbps || 128);
      if (!Number.isInteger(bitrateKbps) || bitrateKbps < 32 || bitrateKbps > 320 ||
          bitrateKbps > station.maxBitrateKbps || bitrateKbps > (entitlements.maxBitrateKbps || 0)) {
        return { reason: "BITRATE_NOT_ALLOWED" };
      }
      if (!Number.isInteger(station.streamConfig.sourcePort) ||
          station.streamConfig.sourcePort < 1 || station.streamConfig.sourcePort > 65535) {
        return { reason: "ADMISSION_SOURCE_PORT_INVALID" };
      }
      if (station.streamConfig.encoderLeaseOwner !== workerOwner ||
          !station.streamConfig.encoderLeaseUntil || new Date(station.streamConfig.encoderLeaseUntil) <= capturedAt) {
        return { reason: "ADMISSION_LEASE_UNAVAILABLE" };
      }
      const sessions = await tx.studioPlayoutSession.findMany({
        where: { organisationId: station.organisationId, channelId: rotation.channel.id, productFamily: "ONLINE", status: "ACTIVE", mode: "MANUAL" },
        take: 2
      });
      if (sessions.length !== 1) return { reason: sessions.length ? "ADMISSION_SESSIONS_AMBIGUOUS" : "ADMISSION_NO_MANUAL_SESSION" };
      const session = sessions[0];
      const items = await tx.studioPlayoutItem.findMany({
        where: { sessionId: session.id, organisationId: station.organisationId, area: "LIVE", status: "READY" },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 1
      });
      const item = items[0];
      if (!item) return { reason: "ADMISSION_QUEUE_EMPTY" };
      const asset = await tx.mediaAsset.findFirst({
        where: { id: item.mediaAssetId, OR: [
          { organisationId: station.organisationId },
          { organisationId: null, libraryType: "RUVANAS_CATALOGUE" }
        ] },
        include: { track: true, genres: { include: { mediaGenre: true } } }
      });
      if (!asset) return { reason: "ADMISSION_ASSET_UNAVAILABLE" };
      const durationMs = Math.max(Number(item.durationMs || 0), Number(asset.durationSeconds) * 1000);
      if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_AUDIO_MS) {
        return { reason: "ADMISSION_DURATION_INVALID" };
      }
      const authority = await readStudioOnlineAuthority(tx, {
        organisationId: station.organisationId, stationId: station.id,
        channelId: rotation.channel.id, durationMs, instant: capturedAt
      });
      return { station, entitlements, configuredGenres, session, item, asset, authority };
    }, { isolationLevel: "RepeatableRead" });
    if (snapshot.reason) return result(false, snapshot.reason);
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf()) || now < capturedAt || now - capturedAt > 10_000) {
      return result(false, "ADMISSION_SNAPSHOT_STALE");
    }
    const entitlements = resolveEntitlements(snapshot.station.organisation?.subscription, now);
    const rotation = eligibleOnlineRadioRotation(snapshot.station, entitlements, now, snapshot.configuredGenres);
    if (!rotation.ready) return result(false, rotation.reason);
    const plan = planStudioOnlineOutput({
      rotation: { ...rotation, fingerprint: rotationFingerprint(rotation) }, entitlements,
      session: snapshot.session, item: snapshot.item, asset: snapshot.asset, authority: snapshot.authority,
      workerOwner, configuredGenres: snapshot.configuredGenres, instant: now
    });
    return plan.ready
      ? { ...result(true, "ADMISSION_ELIGIBLE_NOT_ON_AIR"), snapshot, fingerprint: rotationFingerprint(rotation), checkedAt: now }
      : result(false, plan.reason);
  } catch {
    return result(false, "ADMISSION_SNAPSHOT_FAILED");
  }
}

// Diagnostic-only public shape: no media key, source credential or candidate
// identity can reach the existing shadow log.
export async function loadStudioOnlineAdmission(database, options) {
  const inspected = await inspectStudioOnlineAdmission(database, options);
  return result(inspected.ready, inspected.reason);
}

// A private, short-lived preparation decision for the dedicated isolated test
// adapter. This is not a queue command or an output-time rights check. The
// worker must obtain a fresh decision immediately before any future handoff.
export async function loadStudioIsolatedHandoffCandidate(database, { isolation, ...options } = {}) {
  if (!isolation) return { ...result(false, "ADMISSION_ISOLATION_REQUIRED"), candidate: null, sourceCommandAllowed: false, listenerVerified: false };
  const inspected = await inspectStudioOnlineAdmission(database, options);
  if (!inspected.ready) return { ...result(false, inspected.reason), candidate: null, sourceCommandAllowed: false, listenerVerified: false };
  let expected;
  let actual;
  try {
    expected = validateStudioIsolatedTestTarget(isolation);
    actual = validateStudioIsolatedTestTarget({
      ...isolation,
      testListenerUrl: inspected.snapshot.station.streamConfig.streamUrl,
      testSourceHost: inspected.snapshot.station.streamConfig.serverHost,
      testSourcePort: inspected.snapshot.station.streamConfig.sourcePort
    });
  } catch {
    return { ...result(false, "ADMISSION_ISOLATED_TARGET_MISMATCH"), candidate: null, sourceCommandAllowed: false, listenerVerified: false };
  }
  if (actual.listener !== expected.listener || actual.source !== expected.source) {
    return { ...result(false, "ADMISSION_ISOLATED_TARGET_MISMATCH"), candidate: null, sourceCommandAllowed: false, listenerVerified: false };
  }
  const { station, session, item, asset } = inspected.snapshot;
  const validUntil = new Date(Math.min(inspected.checkedAt.getTime() + 5_000, new Date(station.streamConfig.encoderLeaseUntil).getTime()));
  if (validUntil <= inspected.checkedAt) return { ...result(false, "ADMISSION_LEASE_UNAVAILABLE"), candidate: null, sourceCommandAllowed: false, listenerVerified: false };
  return {
    ...result(true, "ADMISSION_CANDIDATE_NOT_ON_AIR"),
    candidate: Object.freeze({
      stationId: station.id, organisationId: station.organisationId, channelId: station.channels[0].id,
      sessionId: session.id, sessionRevision: session.revision, itemId: item.id,
      itemUpdatedAt: item.updatedAt, mediaAssetId: asset.id,
      rotationFingerprint: inspected.fingerprint, listener: actual.listener, source: actual.source,
      checkedAt: inspected.checkedAt, validUntil
    }),
    sourceCommandAllowed: false, listenerVerified: false
  };
}

// Check again after preparation/download and before a future encoder command.
// A changed item, fallback, lease, source or rights decision invalidates the
// earlier candidate. Even a consistent recheck remains diagnostic-only here.
export async function recheckStudioIsolatedHandoffCandidate(database, {
  candidate, isolation, workerOwner, clock = () => new Date()
} = {}) {
  const denied = (reason) => ({ ...result(false, reason), candidate: null, sourceCommandAllowed: false, listenerVerified: false });
  const now = clock();
  const checkedAt = new Date(candidate?.checkedAt);
  const validUntil = new Date(candidate?.validUntil);
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()) ||
      Number.isNaN(checkedAt.valueOf()) || Number.isNaN(validUntil.valueOf()) ||
      validUntil <= checkedAt || validUntil - checkedAt > 5_000 || now <= checkedAt || now >= validUntil ||
      !candidate?.stationId || !candidate?.itemId || !workerOwner) {
    return denied("ADMISSION_CANDIDATE_EXPIRED_OR_INVALID");
  }
  const fresh = await loadStudioIsolatedHandoffCandidate(database, {
    stationId: candidate.stationId, workerOwner, isolation, clock
  });
  const after = clock();
  if (!(after instanceof Date) || Number.isNaN(after.valueOf()) || after < now || after >= validUntil) {
    return denied("ADMISSION_CANDIDATE_EXPIRED_OR_INVALID");
  }
  if (!fresh.ready) return denied(fresh.reason);
  if (fresh.candidate.checkedAt >= validUntil) return denied("ADMISSION_CANDIDATE_EXPIRED_OR_INVALID");
  const same = ["stationId", "organisationId", "channelId", "sessionId", "sessionRevision", "itemId",
    "mediaAssetId", "rotationFingerprint", "listener", "source"].every((key) => fresh.candidate[key] === candidate[key]) &&
    new Date(fresh.candidate.itemUpdatedAt).getTime() === new Date(candidate.itemUpdatedAt).getTime();
  return same
    ? { ...result(true, "ADMISSION_RECHECK_CONSISTENT_NOT_ON_AIR"), candidate: fresh.candidate, sourceCommandAllowed: false, listenerVerified: false }
    : denied("ADMISSION_CANDIDATE_CHANGED");
}
