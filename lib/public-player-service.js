import { buildPlayerManifest } from "./player-manifest.mjs";
import { resolvePlayerProgramming } from "./player-programming";
import { createListenerTelemetryToken } from "./listener-analytics.mjs";
import { playableLiveMusicModeEntries } from "./music-mode-playback.mjs";
import {
  appendPublicPlaybackToken,
  claimPublicListenerLease,
  PUBLIC_LISTENER_HEARTBEAT_SECONDS,
  publicNowPlaying,
  releasePublicListenerLease,
  verifyPublicPlaybackToken,
  isPublicPlaybackTokenActive
} from "./public-player.mjs";

const stationInclude = {
  organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } },
  streamConfig: { select: { streamUrl: true } },
  channels: {
    where: { status: "ACTIVE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      zoneAssignments: {
        orderBy: [{ activeFrom: "asc" }, { id: "asc" }],
        include: {
          zone: {
            include: {
              location: { include: { openingHours: true, openingExceptions: true } }
            }
          }
        }
      }
    }
  }
};

export async function loadPublicPlayerStation(database, slug) {
  if (!/^[a-z0-9-]{1,120}$/i.test(slug || "")) return null;
  return database.station.findFirst({ where: { slug, status: "ACTIVE", publicPlayerEnabled: true }, include: stationInclude });
}

export function publicPlayerTarget(station, instant = new Date()) {
  const channel = station?.channels?.find((candidate) => candidate.zoneAssignments?.some((assignment) => !assignment.activeTo || new Date(assignment.activeTo) > instant));
  const assignment = channel?.zoneAssignments?.find((candidate) => !candidate.activeTo || new Date(candidate.activeTo) > instant);
  if (!channel || !assignment?.zone?.location) return null;
  return {
    station,
    channel,
    player: {
      id: `public:${station.id}`,
      name: `${station.name} public player`,
      organisationId: station.organisationId,
      stationId: station.id,
      channelId: channel.id,
      organisation: station.organisation,
      zoneId: assignment.zone.id,
      zone: {
        ...assignment.zone,
        channelAssignments: [{ channelId: channel.id, channel }]
      }
    }
  };
}

function publicMediaUrl(slug) {
  return (mediaAssetId, token) => appendPublicPlaybackToken(`/api/public/player/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaAssetId)}`, token);
}

function publicLiveUrl(slug) {
  return (sourceId, token) => appendPublicPlaybackToken(`/api/public/player/${encodeURIComponent(slug)}/live/${encodeURIComponent(sourceId)}`, token);
}

function safePlaylist(items) {
  return (items || []).map(({ scheduleItemId, itemType, title, artist, album, durationSeconds, position, weight, mediaUrl }) => ({
    scheduleItemId, itemType, title, artist, album, durationSeconds, position, weight, mediaUrl
  }));
}

function safeInsertions(items) {
  return (items || []).map(({ scheduleItemId, itemType, title, artist, durationSeconds, plannedStart, hardStart, mediaUrl }) => ({
    scheduleItemId, itemType, title, artist, durationSeconds, plannedStart, hardStart, mediaUrl
  }));
}

export async function buildPublicPlayerResponse(database, { station, target, sessionId, instant = new Date(), secret }) {
  const access = await claimPublicListenerLease(database, { station, channelId: target.channel.id, sessionId, instant, secret });
  if (!access.ok) return access;
  const programming = await resolvePlayerProgramming(target.player, instant, { persistOperationalEvidence: false, publicAudience: true });
  const privateManifest = buildPlayerManifest({
    player: target.player,
    resolution: programming.resolution,
    playoutDecision: programming.playoutDecision,
    campaignPlayout: programming.campaignPlayout,
    schoolPlayout: programming.schoolPlayout,
    proofSecret: secret,
    listenerToken: access.playbackToken,
    instant,
    mediaUrlFor: publicMediaUrl(station.slug),
    liveUrlFor: publicLiveUrl(station.slug),
    includeProof: false
  });
  const telemetryExpiresAt = new Date(instant.getTime() + 10 * 60 * 1_000);
  const telemetryToken = createListenerTelemetryToken({ organisationId: station.organisationId, channelId: target.channel.id, sessionId, issuedAt: instant, expiresAt: telemetryExpiresAt }, secret);
  const manifest = {
    version: privateManifest.version,
    generatedAt: privateManifest.generatedAt,
    expiresAt: privateManifest.expiresAt,
    refreshAfterSeconds: PUBLIC_LISTENER_HEARTBEAT_SECONDS,
    state: privateManifest.state,
    station: {
      name: station.name,
      slug: station.slug,
      description: station.description,
      logoUrl: station.logoUrl,
      tagline: station.publicPlayerTagline,
      accent: station.publicPlayerAccent
    },
    channel: { name: target.channel.name, slug: target.channel.slug },
    schedule: privateManifest.schedule ? { source: privateManifest.schedule.source, sourceLabel: privateManifest.schedule.sourceLabel } : null,
    nowPlaying: null,
    externalLive: privateManifest.externalLive ? { sourceLabel: privateManifest.externalLive.sourceLabel, mediaUrl: privateManifest.externalLive.mediaUrl } : null,
    live: privateManifest.live,
    playlist: safePlaylist(privateManifest.playlist),
    insertions: safeInsertions(privateManifest.insertions),
    fallbackStream: !privateManifest.externalLive && !privateManifest.playlist.length && station.streamConfig?.streamUrl
      ? { mediaUrl: appendPublicPlaybackToken(`/api/public/player/${encodeURIComponent(station.slug)}/stream`, access.playbackToken) }
      : null,
    listenerCapacity: { active: access.activeCount, limit: access.limit },
    listenerRequests: station.listenerRequestsEnabled ? { enabled: true, endpoint: `/api/public/player/${encodeURIComponent(station.slug)}/requests`, instructions: station.listenerRequestInstructions || "Tell the station team which song you would like to hear." } : { enabled: false },
    analytics: { endpoint: "/api/listener-analytics/events", token: telemetryToken, heartbeatSeconds: 30, expiresAt: telemetryExpiresAt.toISOString() }
  };
  manifest.nowPlaying = publicNowPlaying(manifest, instant);
  return { ok: true, manifest, programming };
}

export async function authorizePublicPlayback(database, { slug, token, instant = new Date(), secret }) {
  const station = await loadPublicPlayerStation(database, slug);
  if (!station) return { ok: false, status: 404, error: "This public station is unavailable." };
  const authority = verifyPublicPlaybackToken(token, { instant, secret });
  if (!authority || authority.stationId !== station.id || authority.organisationId !== station.organisationId) return { ok: false, status: 401, error: "This listening session has expired." };
  const target = publicPlayerTarget(station, instant);
  if (!target || authority.channelId !== target.channel.id) return { ok: false, status: 409, error: "The public channel is not ready." };
  if (!await isPublicPlaybackTokenActive(database, { authority, instant })) return { ok: false, status: 429, error: "This listening slot is no longer active." };
  return { ok: true, station, target, authority };
}

export async function releasePublicPlayerSession(database, { station, sessionId, secret }) {
  return releasePublicListenerLease(database, { stationId: station.id, sessionId, secret });
}

export function publicPlaybackAssetAllowed(programming, mediaAssetId, instant = new Date()) {
  const eligibleMusic = playableLiveMusicModeEntries(programming.resolution.musicMode, instant).some(({ track }) => track.mediaAsset?.id === mediaAssetId);
  const eligibleCampaign = (programming.campaignPlayout.insertions || []).some((item) => item.mediaAssetId === mediaAssetId);
  const eligibleSchool = (programming.schoolPlayout.insertions || []).some((item) => item.mediaAssetId === mediaAssetId);
  return eligibleMusic || eligibleCampaign || eligibleSchool;
}
