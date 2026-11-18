// This pure planner grants no ordinary playback authority. Its authorization
// argument must come from an authenticated, unrevoked server-side owner-test
// session, never from request JSON, catalogue metadata or a tester plan.
import { createHash } from "node:crypto";
import { musicTrackEligibility } from "./media-library-pro.mjs";
import { genreCodesForTrack, licensedGenresForLevel } from "./autodj-genre-entitlements.mjs";
import { getCatalogueTestProfile, catalogueTestProfileForAuthorization } from "./catalogue-test-profiles.mjs";
import { catalogueTestMode, HANDOVER_TEST_MODE } from "./catalogue-test-modes.mjs";

export const TEST_RADIO_CATALOGUE_TEST = Object.freeze({
  stationId: "cmvcnbwi20008hr23sd76psi8",
  origin: "https://www.ruvanas.com",
  kind: "OWNER_CATALOGUE_TEST",
  territory: "MT",
  catalogueLevel: "FOCUSED",
  maximumSeconds: 300,
  maximumAuthorizationSeconds: 600,
  maximumCandidates: 2000,
  maximumItems: 8,
  maximumFileBytes: 50 * 1024 * 1024,
  maximumUniqueFileBytes: 100 * 1024 * 1024,
});

export const CATALOGUE_TEST_REASON_LABELS = Object.freeze({
  READY: "Ready for a separately started, time-limited Test Radio test.",
  INVALID_TIME: "A valid current server time is required.",
  TEST_STATION_REQUIRED: "This test is available only for the isolated Test Radio station.",
  STATION_NOT_PRIVATE: "The station must keep its Ruvanas public player and website off.",
  SERVICE_INACTIVE: "Active Online Radio service is required.",
  ORIGIN_NOT_ALLOWED: "Use the canonical signed-in Ruvanas origin.",
  OWNER_AUTHORIZATION_REQUIRED: "A separate server-issued owner test authorization is required.",
  AUTHORIZATION_SCOPE_INVALID: "The owner authorization does not match this test and organisation.",
  AUTHORIZATION_EXPIRED: "The owner test authorization is not currently valid.",
  SERVICE_EXPIRY_REQUIRED: "The private test service expiry must be verified.",
  SERVICE_EXPIRED: "The verified service window has ended.",
  INVALID_DURATION: "Choose a duration within the approved test profile.",
  TEST_PROFILE_INVALID: "Choose the five-minute or separately approved one-hour test profile.",
  TEST_MODE_INVALID: "Choose a supported test type. The 90-second handover diagnostic uses the five-minute maximum only.",
  HANDOVER_AUDIO_REQUIRED: "The handover diagnostic needs three distinct approved recordings of at least 30 seconds each.",
  INVALID_SEED: "A bounded server-selected random seed is required.",
  INVALID_TRACKS: "Supply a bounded catalogue candidate list.",
  INVALID_GENRES: "Supply a bounded configured-genre list.",
  DUPLICATE_TRACK_ID: "Conflicting duplicate catalogue identities require review.",
  NO_RIGHTS_APPROVED_AUDIO: "No catalogue recordings satisfy the complete test rights checks.",
  INSUFFICIENT_AUDIO: "Not enough unique approved music is available for this test duration.",
  PLAN_TOO_LARGE: "The selected private audio exceeds the test preparation limit.",
  TRACK_IDENTITY_INVALID: "The track or private catalogue media identity is invalid.",
  PROVIDER_OUTPUT_UNAVAILABLE: "Supplier and distributor output is not enabled by this test.",
  RIGHTS_DECLARATION_REQUIRED: "The recording needs an approved, confirmed rights declaration.",
  RIGHTS_WINDOW_INACTIVE: "The recording is not licensed for the complete test window.",
  CATALOGUE_TIER_REQUIRED: "Only the existing FOCUSED catalogue scope is available in this test.",
  CATALOGUE_GENRE_LOCKED: "The recording needs an active, approved FOCUSED genre.",
  TRACK_NOT_READY: "The recording is not ready.",
  MEDIA_NOT_READY: "The private music file is not ready.",
  USE_NOT_PERMITTED: "The recording is not approved for Online Radio.",
  RIGHTS_NOT_APPROVED: "The recording is not approved for Malta playback.",
  TERRITORY_REQUIRED: "A valid recorded music territory is required.",
  CATALOGUE_OWNERSHIP_INVALID: "The recording is not a platform-owned catalogue asset.",
});

const LIMITS = TEST_RADIO_CATALOGUE_TEST;
const VALID_STATES = new Set(["PENDING_SETUP", "DRAFT", "ACTIVE"]);
const ID = /^[a-zA-Z0-9_-]{8,80}$/;
const STORAGE_KEY = /^catalogue\/music\/([a-f0-9]{64})\.(mp3|wav|m4a|ogg)$/;

function refusal(reason) {
  return { ready: false, reason, label: CATALOGUE_TEST_REASON_LABELS[reason] || CATALOGUE_TEST_REASON_LABELS.NO_RIGHTS_APPROVED_AUDIO };
}

function millis(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date.getTime() : null;
}

function dateIdentity(value) {
  if (value === null || value === undefined) return null;
  const time = millis(value);
  return time === null ? "INVALID_DATE" : new Date(time).toISOString();
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function safeBytes(value) {
  if (typeof value === "bigint") return value > 0n && value <= BigInt(LIMITS.maximumFileBytes) ? Number(value) : null;
  if (typeof value === "string" && /^[1-9]\d{0,8}$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= LIMITS.maximumFileBytes ? value : null;
}

function genreIdentities(genres) {
  return (Array.isArray(genres) ? genres : []).map((item) => {
    const genre = item?.mediaGenre || item;
    return [genre?.id ?? null, genre?.slug ?? null, genre?.name ?? null, genre?.active ?? null,
      genre?.providerReviewStatus ?? null, genre?.minimumCatalogueLevel ?? null];
  }).sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
}

/** Fingerprint only server-loaded identity/rights inputs; never log this projection. */
export function catalogueTestTrackFingerprint(track) {
  const asset = track?.mediaAsset;
  return hash({
    id: track?.id ?? null, mediaAssetId: track?.mediaAssetId ?? null, updatedAt: dateIdentity(track?.updatedAt),
    title: track?.title ?? null, artist: track?.artist ?? null, status: track?.status ?? null,
    catalogueProvider: track?.catalogueProvider ?? null, minimumCatalogueLevel: track?.minimumCatalogueLevel ?? null,
    rightsHolder: track?.rightsHolder ?? null, rightsReference: track?.rightsReference ?? null, rightsBasis: track?.rightsBasis ?? null,
    rightsReviewStatus: track?.rightsReviewStatus ?? null, rightsReviewedAt: dateIdentity(track?.rightsReviewedAt),
    rightsReviewedById: track?.rightsReviewedById ?? null, rightsConfirmedAt: dateIdentity(track?.rightsConfirmedAt),
    rightsConfirmedById: track?.rightsConfirmedById ?? null,
    permittedTerritories: track?.permittedTerritories ?? null,
    permittedUses: Array.isArray(track?.permittedUses) ? [...track.permittedUses].sort() : null,
    licenceStartsAt: dateIdentity(track?.licenceStartsAt), licenceExpiresAt: dateIdentity(track?.licenceExpiresAt),
    distributorItems: Array.isArray(track?.distributorItems) ? track.distributorItems.map((item) => [item?.id ?? null, item?.status ?? null]).sort() : null,
    asset: { id: asset?.id ?? null, organisationId: asset?.organisationId ?? null,
      libraryType: asset?.libraryType ?? null, mediaType: asset?.mediaType ?? null, status: asset?.status ?? null,
      licensedCatalogue: asset?.licensedCatalogue ?? null, storageKey: asset?.storageKey ?? null,
      sizeBytes: String(asset?.sizeBytes ?? ""), durationSeconds: asset?.durationSeconds ?? null,
      mimeType: asset?.mimeType ?? null, updatedAt: dateIdentity(asset?.updatedAt), genres: genreIdentities(asset?.genres) },
  });
}

/** Validate the independent server owner-test grant, not normal broadcast access. */
export function validateCatalogueTestAuthorization({ station, entitlements, authorization, instant = new Date(), origin, serviceExpiresAt = null } = {}) {
  const now = millis(instant);
  if (now === null) return refusal("INVALID_TIME");
  if (!station || station.id !== LIMITS.stationId || !ID.test(station.organisationId || "") ||
      station.productFamily !== "ONLINE" || !VALID_STATES.has(station.status)) return refusal("TEST_STATION_REQUIRED");
  if (station.publicPlayerEnabled !== false || station.stationWebsiteEnabled !== false) return refusal("STATION_NOT_PRIVATE");
  if (entitlements?.serviceEnabled !== true || entitlements?.onlineRadioEnabled !== true) return refusal("SERVICE_INACTIVE");
  if (origin !== LIMITS.origin) return refusal("ORIGIN_NOT_ALLOWED");
  if (!authorization || authorization.kind !== LIMITS.kind || authorization.actorRole !== "SUPER_ADMIN" ||
      !ID.test(authorization.actorUserId || "") || authorization.revokedAt != null || authorization.enabled === false) {
    return refusal("OWNER_AUTHORIZATION_REQUIRED");
  }
  const profile = catalogueTestProfileForAuthorization(authorization);
  const testMode = profile && catalogueTestMode(authorization.testMode, profile.id);
  if (authorization.stationId !== station.id || authorization.organisationId !== station.organisationId ||
      authorization.origin !== LIMITS.origin || authorization.catalogueLevel !== LIMITS.catalogueLevel ||
      authorization.actorSessionId !== undefined && !ID.test(authorization.actorSessionId || "") ||
      authorization.territory !== undefined && authorization.territory !== LIMITS.territory ||
      !profile || !testMode || testMode.id === HANDOVER_TEST_MODE &&
        (authorization.profileId !== "FIVE_MINUTES" || authorization.maximumSeconds !== 300)) {
    return refusal("AUTHORIZATION_SCOPE_INVALID");
  }
  const issued = millis(authorization.issuedAt), expires = millis(authorization.expiresAt);
  if (issued === null || expires === null || issued > now || expires <= now || expires <= issued ||
      expires - issued > profile.maximumAuthorizationSeconds * 1000) return refusal("AUTHORIZATION_EXPIRED");
  const serviceEnd = serviceExpiresAt == null ? null : millis(serviceExpiresAt);
  if (entitlements.sandboxDraftOnly === true && serviceEnd === null) return refusal("SERVICE_EXPIRY_REQUIRED");
  if (serviceExpiresAt != null && serviceEnd === null || serviceEnd !== null && serviceEnd <= now) return refusal("SERVICE_EXPIRED");
  return { ready: true, reason: "READY", now, profileId: profile.id, authorizationExpiresAt: expires, serviceExpiresAt: serviceEnd,
    validUntil: Math.min(expires, serviceEnd ?? expires) };
}

// This is a current-media check only, never an owner authorization substitute.
// The worker must also revalidate its stored session, grant and absolute stop.
export function catalogueTestTrackDecision(track, { organisationId, instant, stopAt, configuredGenres = [], profileId } = {}) {
  const profile = getCatalogueTestProfile(profileId);
  const currentTime = millis(instant), stopTime = millis(stopAt);
  if (!ID.test(organisationId || "") || currentTime === null || stopTime === null || stopTime <= currentTime ||
      !profile || stopTime - currentTime > profile.maximumSeconds * 1000) return "RIGHTS_WINDOW_INACTIVE";
  if (!Array.isArray(configuredGenres) || configuredGenres.length > 250) return "CATALOGUE_GENRE_LOCKED";
  instant = new Date(currentTime);
  stopAt = new Date(stopTime);
  const asset = track?.mediaAsset;
  if (!ID.test(track?.id || "") || !ID.test(asset?.id || "") || track.mediaAssetId !== asset.id ||
      !STORAGE_KEY.test(asset.storageKey || "") || safeBytes(asset.sizeBytes) === null ||
      typeof asset.licensedCatalogue !== "boolean" || !Number.isInteger(asset.durationSeconds) ||
      asset.durationSeconds < 3 || asset.durationSeconds > 86_400 ||
      typeof track.title !== "string" || !track.title.trim() || track.title.length > 200 ||
      typeof track.artist !== "string" || !track.artist.trim() || track.artist.length > 200) return "TRACK_IDENTITY_INVALID";
  // Empty loaded relation is evidence of absence. An omitted relation is not.
  if (track.catalogueProvider != null || track.rightsBasis === "DISTRIBUTOR_LICENCE" ||
      !Array.isArray(track.distributorItems) || track.distributorItems.length) return "PROVIDER_OUTPUT_UNAVAILABLE";
  if (asset.libraryType !== "RUVANAS_CATALOGUE" || asset.organisationId !== null) return "CATALOGUE_OWNERSHIP_INVALID";
  if (track.status !== "READY") return "TRACK_NOT_READY";
  if (asset.status !== "READY" || asset.mediaType !== "MUSIC") return "MEDIA_NOT_READY";
  const confirmed = millis(track.rightsConfirmedAt), reviewed = millis(track.rightsReviewedAt);
  if (track.rightsReviewStatus !== "APPROVED" || confirmed === null || reviewed === null ||
      confirmed > instant.getTime() || reviewed > instant.getTime() ||
      !ID.test(track.rightsConfirmedById || "") || !ID.test(track.rightsReviewedById || "") ||
      typeof track.rightsHolder !== "string" || !track.rightsHolder.trim() ||
      typeof track.rightsReference !== "string" || !track.rightsReference.trim() ||
      !["OWNED_MASTER", "DIRECT_LICENCE", "DISTRIBUTOR_LICENCE", "OTHER"].includes(track.rightsBasis)) return "RIGHTS_DECLARATION_REQUIRED";
  if (track.minimumCatalogueLevel !== LIMITS.catalogueLevel) return "CATALOGUE_TIER_REQUIRED";
  if ((track.licenceStartsAt != null && millis(track.licenceStartsAt) === null) ||
      (track.licenceExpiresAt != null && millis(track.licenceExpiresAt) === null)) return "RIGHTS_WINDOW_INACTIVE";
  const approvedGenres = (Array.isArray(asset.genres) ? asset.genres : []).filter((item) =>
    item?.mediaGenre?.active === true && item.mediaGenre.providerReviewStatus === "APPROVED");
  const projectedTrack = { ...track, mediaAsset: { ...asset, genres: approvedGenres } };
  const permittedGenreCodes = new Set(licensedGenresForLevel(LIMITS.catalogueLevel, configuredGenres).map(({ code }) => code));
  if (!genreCodesForTrack(projectedTrack).some((code) => permittedGenreCodes.has(code))) return "CATALOGUE_GENRE_LOCKED";
  const options = { organisationId, requiredUse: "ONLINE_RADIO", territory: LIMITS.territory,
    licensedCatalogueLevel: LIMITS.catalogueLevel, configuredGenres };
  const current = musicTrackEligibility(projectedTrack, { ...options, instant });
  if (!current.playable) return current.reason;
  if (!musicTrackEligibility(projectedTrack, { ...options, instant: new Date(stopAt.getTime() - 1) }).playable) return "RIGHTS_WINDOW_INACTIVE";
  return null;
}

function randomFrom(seed) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** Build only a frozen-choice plan. This function never starts or authorizes a worker. */
export function buildOnlineRadioCatalogueTestPlan({ station, entitlements, tracks, configuredGenres = [], authorization,
  instant = new Date(), origin, seed, durationSeconds, serviceExpiresAt = null } = {}) {
  const grant = validateCatalogueTestAuthorization({ station, entitlements, authorization, instant, origin, serviceExpiresAt });
  if (!grant.ready) return grant;
  const profile = getCatalogueTestProfile(grant.profileId);
  const testMode = catalogueTestMode(authorization.testMode, profile.id);
  const handover = testMode.id === HANDOVER_TEST_MODE;
  if (durationSeconds === undefined) durationSeconds = profile.maximumSeconds;
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > profile.maximumSeconds ||
      (profile.id === "ONE_HOUR" || handover) && durationSeconds !== profile.maximumSeconds) return refusal("INVALID_DURATION");
  if (typeof seed !== "string" || !seed.trim() || seed.length > 128 || /[\0\r\n]/.test(seed)) return refusal("INVALID_SEED");
  if (!Array.isArray(tracks) || tracks.length > LIMITS.maximumCandidates) return refusal("INVALID_TRACKS");
  if (!Array.isArray(configuredGenres) || configuredGenres.length > 250) return refusal("INVALID_GENRES");
  const targetSeconds = Math.min(durationSeconds, Math.floor((grant.validUntil - grant.now) / 1000));
  if (targetSeconds < 1) return refusal("AUTHORIZATION_EXPIRED");
  if ((profile.id === "ONE_HOUR" || handover) && targetSeconds !== durationSeconds) return refusal("AUTHORIZATION_EXPIRED");
  const startsAt = new Date(grant.now), stopAt = new Date(grant.now + targetSeconds * 1000);
  const excludedReasons = {}, eligible = [], identities = new Map();
  for (const track of tracks) {
    const fingerprint = catalogueTestTrackFingerprint(track);
    if (ID.test(track?.id || "") && identities.has(track.id)) {
      if (identities.get(track.id) !== fingerprint) return refusal("DUPLICATE_TRACK_ID");
      continue;
    }
    if (ID.test(track?.id || "")) identities.set(track.id, fingerprint);
    const reason = catalogueTestTrackDecision(track, { organisationId: station.organisationId, instant: startsAt, stopAt, configuredGenres, profileId: profile.id });
    if (reason) excludedReasons[reason] = (excludedReasons[reason] || 0) + 1;
    else if (handover && track.mediaAsset.durationSeconds < testMode.phaseSeconds) excludedReasons.HANDOVER_AUDIO_REQUIRED = (excludedReasons.HANDOVER_AUDIO_REQUIRED || 0) + 1;
    else eligible.push({ track, fingerprint });
  }
  if (!eligible.length) return { ...refusal("NO_RIGHTS_APPROVED_AUDIO"), eligibleTrackCount: 0, excludedReasons };
  if (handover && new Set(eligible.map(({ track }) => track.mediaAssetId)).size < testMode.maximumItems) return refusal("HANDOVER_AUDIO_REQUIRED");
  eligible.sort((left, right) => compareText(left.track.id, right.track.id));
  const random = randomFrom(seed), items = [], uniqueAssets = new Map();
  let bag = [...eligible], totalSeconds = 0, previousTrackId = null, previousArtist = null;
  const audioTargetSeconds = handover ? testMode.audioDurationSeconds : targetSeconds;
  while (totalSeconds < audioTargetSeconds && items.length < (handover ? testMode.maximumItems : profile.maximumItems) && bag.length) {
    const available = handover ? bag.filter(({ track }) => !uniqueAssets.has(track.mediaAssetId)) : bag;
    const otherTracks = available.filter(({ track }) => track.id !== previousTrackId);
    const pool = otherTracks.length ? otherTracks : available;
    const otherArtists = pool.filter(({ track }) => track.artist.trim().toLocaleLowerCase("en") !== previousArtist);
    const choices = otherArtists.length ? otherArtists : pool;
    const candidate = choices[Math.floor(random() * choices.length)];
    bag.splice(bag.indexOf(candidate), 1);
    const { track, fingerprint } = candidate, asset = track.mediaAsset;
    uniqueAssets.set(asset.id, safeBytes(asset.sizeBytes));
    const duration = asset.durationSeconds, playDuration = handover ? testMode.phaseSeconds : Math.min(duration, targetSeconds - totalSeconds);
    items.push({ trackId: track.id, title: track.title, artist: track.artist, durationSeconds: duration,
      playDurationSeconds: playDuration, startOffsetSeconds: totalSeconds, endOffsetSeconds: totalSeconds + playDuration,
      source: asset.licensedCatalogue ? "LICENSED_CATALOGUE" : "RUVANAS_CORE", fingerprint, track });
    totalSeconds += playDuration;
    previousTrackId = track.id;
    previousArtist = track.artist.trim().toLocaleLowerCase("en");
  }
  const uniqueFileBytes = [...uniqueAssets.values()].reduce((sum, bytes) => sum + bytes, 0);
  if (totalSeconds !== audioTargetSeconds) return refusal("INSUFFICIENT_AUDIO");
  if (uniqueFileBytes > profile.maximumUniqueFileBytes) return refusal("PLAN_TOO_LARGE");
  const stationFingerprint = hash({ id: station.id, organisationId: station.organisationId, status: station.status,
    productFamily: station.productFamily, publicPlayerEnabled: station.publicPlayerEnabled, stationWebsiteEnabled: station.stationWebsiteEnabled });
  const configuredGenresFingerprint = hash(genreIdentities(configuredGenres));
  const authorizationFingerprint = hash({ kind: authorization.kind, actorRole: authorization.actorRole,
    ...(authorization.profileId === undefined ? {} : { profileId: profile.id, maximumSeconds: profile.maximumSeconds }),
    ...(authorization.testMode === undefined ? {} : { testMode: authorization.testMode }),
    actorUserId: authorization.actorUserId, actorSessionId: authorization.actorSessionId ?? null,
    stationId: authorization.stationId, organisationId: authorization.organisationId,
    origin: authorization.origin, catalogueLevel: authorization.catalogueLevel,
    issuedAt: dateIdentity(authorization.issuedAt), expiresAt: dateIdentity(authorization.expiresAt) });
  const entitlementsFingerprint = hash({ serviceEnabled: entitlements.serviceEnabled, onlineRadioEnabled: entitlements.onlineRadioEnabled,
    outputEnabled: entitlements.outputEnabled, sandboxDraftOnly: entitlements.sandboxDraftOnly,
    planCode: entitlements.planCode, licensedMusicCatalogueLevel: entitlements.licensedMusicCatalogueLevel,
    includesRuvanasCatalogue: entitlements.includesRuvanasCatalogue, serviceExpiresAt: dateIdentity(serviceExpiresAt) });
  return { ready: true, reason: "READY", label: CATALOGUE_TEST_REASON_LABELS.READY,
    mode: LIMITS.kind, profileId: profile.id, stationId: station.id, organisationId: station.organisationId, territory: LIMITS.territory,
    catalogueLevel: LIMITS.catalogueLevel, startsAt: startsAt.toISOString(), stopAt: stopAt.toISOString(),
    requestedSeconds: durationSeconds, targetSeconds, totalSeconds, seed, items, uniqueFileBytes,
    ...(handover ? { testMode: HANDOVER_TEST_MODE, audioDurationSeconds: testMode.audioDurationSeconds } : {}),
    eligibleTrackCount: eligible.length, excludedReasons,
    validation: { stationFingerprint, configuredGenresFingerprint, authorizationFingerprint, entitlementsFingerprint,
      tracks: [...new Map(items.map(({ trackId, fingerprint }) => [trackId, { trackId, fingerprint }])).values()] },
  };
}

/** Owner UI DTO: no storage keys, source URLs, asset IDs, grants or secret data. */
export function safeCatalogueTestPlan(plan) {
  if (!plan?.ready) return { ready: false, reason: plan?.reason || "NO_RIGHTS_APPROVED_AUDIO",
    label: CATALOGUE_TEST_REASON_LABELS[plan?.reason] || CATALOGUE_TEST_REASON_LABELS.NO_RIGHTS_APPROVED_AUDIO,
    excludedReasons: { ...(plan?.excludedReasons || {}) } };
  return { ready: true, reason: "READY", label: CATALOGUE_TEST_REASON_LABELS.READY,
    profileId: plan.profileId, stationId: plan.stationId, territory: plan.territory, catalogueLevel: plan.catalogueLevel,
    startsAt: plan.startsAt, stopAt: plan.stopAt, targetSeconds: plan.targetSeconds, totalSeconds: plan.totalSeconds,
    testMode: plan.testMode || "STANDARD", ...(plan.testMode === HANDOVER_TEST_MODE ? { audioDurationSeconds: plan.audioDurationSeconds } : {}),
    eligibleTrackCount: plan.eligibleTrackCount, uniqueFileBytes: plan.uniqueFileBytes, excludedReasons: { ...plan.excludedReasons },
    items: plan.items.map(({ trackId, title, artist, durationSeconds, playDurationSeconds, startOffsetSeconds, endOffsetSeconds, source }) =>
      ({ trackId, title, artist, durationSeconds, playDurationSeconds, startOffsetSeconds, endOffsetSeconds, source })) };
}
