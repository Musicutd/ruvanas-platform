import { onlineRadioSourceScope } from "./online-radio-output.mjs";
import { PLAYOUT_SOURCE_PRIORITIES, resolveUnifiedPlayout } from "./playout-resolver.mjs";
import { studioQueueReadiness } from "./studio-playout.mjs";

const PROTECTED_SOURCES = new Set(["EMERGENCY_OVERRIDE", "LIVE_SESSION", "SCHOOL_PROGRAMMING", "PROGRAMME_SCHEDULE"]);
const AUTHORITY_MAX_AGE_MS = 10_000;

function denied(reason) {
  return { ready: false, reason, decision: null, itemId: null };
}

function validInstant(value) {
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.valueOf()) ? null : instant;
}

// A dry-run output decision, not an instruction to the encoder and not proof of
// a public play. Only the station worker may use it after loading authoritative
// channel, session, rights and insertion state from the same tenant.
export function planStudioOnlineOutput({ rotation, entitlements, session, item, asset, authority, workerOwner, configuredGenres = [], instant = new Date() }) {
  const now = validInstant(instant);
  if (!now) return denied("INVALID_INSTANT");
  if (!rotation?.ready || !rotation.station?.id || !rotation.station?.organisationId ||
      !rotation.channel?.id || !rotation.policy?.id || !rotation.mode?.id) return denied("AUTODJ_FALLBACK_UNAVAILABLE");
  const { station, channel, policy } = rotation;
  if (station.productFamily !== "ONLINE" || !entitlements?.onlineRadioEnabled || !entitlements?.studioProEnabled) return denied("SERVICE_OR_STUDIO_PRO_INACTIVE");
  if (policy.rightsUse !== "ONLINE_RADIO") return denied("WRONG_PRODUCT_RIGHTS_USE");
  const leaseUntil = validInstant(station.streamConfig?.encoderLeaseUntil);
  if (!workerOwner || station.streamConfig?.encoderLeaseOwner !== workerOwner || !leaseUntil || leaseUntil <= now) return denied("ENCODER_LEASE_UNAVAILABLE");
  if (channel.stationId && channel.stationId !== station.id) return denied("CHANNEL_STATION_MISMATCH");
  if (channel.organisationId && channel.organisationId !== station.organisationId) return denied("CHANNEL_TENANT_MISMATCH");
  if (!session || session.organisationId !== station.organisationId || session.channelId !== channel.id ||
      session.productFamily !== "ONLINE" || session.status !== "ACTIVE" || session.mode !== "MANUAL" ||
      session.fallbackAutoDjId !== policy.id) return denied("MANUAL_SESSION_NOT_ACTIVE");
  if (!item || item.sessionId !== session.id || item.organisationId !== station.organisationId ||
      item.area !== "LIVE" || item.status !== "READY" || !item.rightsReady || !asset || item.mediaAssetId !== asset.id ||
      !asset.storageKey) return denied("STUDIO_ITEM_NOT_READY");
  if (item.cueInMs || item.cueOutMs || item.fadeInMs || item.fadeOutMs || item.gainDb) return denied("STUDIO_MIX_NOT_SUPPORTED_BY_ENCODER");
  const durationMs = Math.max(Number(item.durationMs || 0), Number(asset.durationSeconds) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 12 * 60 * 60 * 1000) return denied("INVALID_AUDIO_DURATION");
  const end = new Date(now.getTime() + durationMs);
  if (asset.track?.licenceExpiresAt && new Date(asset.track.licenceExpiresAt) < end) return denied("RIGHTS_EXPIRE_DURING_AUDIO");
  const readiness = studioQueueReadiness(asset, {
    organisationId: station.organisationId, productFamily: "ONLINE", rightsUse: policy.rightsUse,
    territory: policy.territory || null, licensedMusicCatalogueLevel: entitlements.licensedMusicCatalogueLevel,
    configuredGenres, instant: now
  });
  if (!readiness.ready) return denied("RIGHTS_NOT_CURRENT");
  if (asset.mediaType === "MUSIC" || asset.track) {
    const scope = onlineRadioSourceScope({ track: { mediaAsset: asset } });
    if (scope === "LICENSED_CATALOGUE") return denied("LICENSED_OUTPUT_PROOF_UNAVAILABLE");
    if (!scope || !policy.sourceScopes?.includes(scope)) return denied("SOURCE_SCOPE_NOT_ALLOWED");
  }
  const capturedAt = validInstant(authority?.capturedAt);
  if (!authority?.complete || authority.organisationId !== station.organisationId || authority.channelId !== channel.id ||
      !capturedAt || now - capturedAt < 0 || now - capturedAt > AUTHORITY_MAX_AGE_MS ||
      !Array.isArray(authority.candidates) || !Array.isArray(authority.requiredInsertions) ||
      authority.candidates.some((candidate) => !PROTECTED_SOURCES.has(candidate?.sourceType) ||
        (candidate.priority != null && candidate.priority < PLAYOUT_SOURCE_PRIORITIES[candidate.sourceType]))) {
    return denied("AUTHORITATIVE_SCHEDULE_UNAVAILABLE");
  }
  if (authority.requiredInsertions.some((insertion) => {
    const start = validInstant(insertion?.plannedStart);
    return !start || start < end;
  })) return denied("REQUIRED_INSERTION_PENDING");
  if (authority.candidates.some((candidate) => {
    const start = validInstant(candidate.validFrom);
    return start && start > now && start < end;
  })) return denied("PROTECTED_SOURCE_DURING_AUDIO");
  let decision;
  try {
    decision = resolveUnifiedPlayout({
      organisationId: station.organisationId, channelId: channel.id, targetId: station.id,
      instant: now, decisionTtlSeconds: 30,
      candidates: [
        ...authority.candidates,
        {
          sourceType: "STUDIO_MANUAL", sourceId: item.id, sourceRevision: `${session.id}:${session.revision}:${item.updatedAt || "unknown"}`,
          organisationId: station.organisationId, channelId: channel.id, label: "Studio Manual Playout",
          available: true, validFrom: now, validUntil: end, proofClassification: "LIVE",
          payload: { sessionId: session.id, itemId: item.id, mediaAssetId: asset.id }
        },
        {
          sourceType: "DEFAULT_AUTODJ", sourceId: rotation.mode.id, sourceRevision: rotation.fingerprint || "current",
          organisationId: station.organisationId, channelId: channel.id, label: "Continuous AutoDJ",
          available: true, validFrom: now, validUntil: end, proofClassification: "AUTODJ"
        }
      ]
    });
  } catch {
    return denied("AUTHORITATIVE_SCHEDULE_INVALID");
  }
  if (decision.sourceType !== "STUDIO_MANUAL") return { ready: false, reason: "HIGHER_PRIORITY_SOURCE", decision, itemId: null };
  if (decision.priority !== PLAYOUT_SOURCE_PRIORITIES.STUDIO_MANUAL) return denied("MANUAL_PRIORITY_MISMATCH");
  return { ready: true, reason: "MANUAL_MAY_BE_PREPARED", decision, itemId: item.id };
}
