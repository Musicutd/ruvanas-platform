import { prisma } from "@/lib/prisma";
import { cataloguePlaybackTrackInclude } from "@/lib/catalogue-playback-include";
import {
  compileCampaignPlayout,
  playoutIntentCreateData
} from "@/lib/campaign-playout.mjs";
import { evaluateLocationOpen } from "@/lib/opening-hours.mjs";
import { resolveMusicSchedule } from "@/lib/music-scheduling.mjs";
import { musicModeIsPlayable } from "@/lib/music-mode-playback.mjs";
import { resolveUnifiedPlayout } from "@/lib/playout-resolver.mjs";
import {
  advancedProgrammeCandidates,
  autoDjCandidates,
  musicResolutionCandidate,
  subscriberPlaylistCandidate
} from "@/lib/playout-source-adapters.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { loadEligibleSubscriberMusic, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";
import { externalLiveCandidate } from "@/lib/external-live.mjs";
import { liveFailoverCandidate } from "@/lib/live-failover.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import {
  compileSchoolRadioPlayout,
  mergeSharedInsertions,
  schoolPlayoutIntentCreateData
} from "@/lib/school-radio.mjs";

const playbackModeInclude = {
  generatedPlaylists: { where: { status: "PUBLISHED" }, select: { status: true, selectedGenreCodes: true }, take: 1 },
  tracks: { include: { track: { include: cataloguePlaybackTrackInclude } } }
};

export async function resolvePlayerProgramming(player, instant = new Date(), {
  persistOperationalEvidence = true,
  publicAudience = false
} = {}) {
  const location = player.zone.location;
  const channelId = player.zone.channelAssignments[0]?.channelId || null;
  const entitlements = resolveEntitlements(player.organisation?.subscription);
  const requiredUse = rightsUseForChannel(player.zone.channelAssignments[0]?.channel) || ({ RETAIL: "RETAIL_RADIO", SCHOOL: "SCHOOL_RADIO", ONLINE: "ONLINE_RADIO", HEALTH: "HEALTH_RADIO", FAITH: "FAITH_RADIO", ORGANISATIONS: "ORGANISATIONS_RADIO" }[entitlements.planProductFamily] || null);
  const schoolRadioEnabled = entitlements.schoolRadioEnabled && (!publicAudience || entitlements.schoolPublicPublishingEnabled);
  const opening = location.openingHours.length
    ? evaluateLocationOpen({
        instant,
        timezone: location.timezone,
        weeklyHours: location.openingHours,
        exceptions: location.openingExceptions
      })
    : { isOpen: true, source: "unconfigured" };
  const [schedules, campaigns, schoolSlots, autoDjPolicy, programmeSchedule, externalLiveSource, liveFailoverPolicy, radioAdvertisingPolicy, subscriberPlaylistEvent, nextSubscriberPlaylistEvent] = await Promise.all([
    prisma.musicSchedule.findMany({
      where: {
        organisationId: player.organisationId,
        status: "PUBLISHED",
        OR: [{ zoneId: player.zoneId }, { locationId: player.zone.locationId }]
      },
      include: {
        slots: {
          include: {
            musicMode: {
              include: {
                tracks: {
                  include: {
                    track: {
                      include: {
                        mediaAsset: { include: { genres: { include: { mediaGenre: true } } } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }),
    prisma.campaign.findMany({
      where: {
        organisationId: player.organisationId,
        status: "PUBLISHED"
      },
      include: {
        targets: true,
        rule: true,
        schedules: true,
        promoVersion: {
          include: {
            promoAsset: { select: { id: true, name: true, status: true } },
            mediaAsset: {
              select: {
                id: true,
                organisationId: true,
                status: true,
                durationSeconds: true
              }
            }
          }
        }
      }
    }),
    schoolRadioEnabled ? prisma.schoolBroadcastSlot.findMany({
      where: {
        organisationId: player.organisationId,
        status: "APPROVED",
        startsAt: { gte: new Date(instant.getTime() - 5 * 60 * 1000), lt: new Date(instant.getTime() + 10 * 60 * 1000) },
        endsAt: { gt: instant },
        OR: [{ zoneId: player.zoneId }, { locationId: player.zone.locationId }]
      },
      include: {
        announcement: {
          include: {
            sourceExchangeRequest: {
              include: {
                offer: { select: { status: true, sourceOrganisationId: true, approvedPromoVersionId: true } }
              }
            },
            promoVersion: {
              include: {
                promoAsset: { select: { id: true, name: true, status: true } },
                mediaAsset: { select: { id: true, organisationId: true, status: true, durationSeconds: true } }
              }
            }
          }
        },
        episode: {
          include: {
            rundown: {
              include: {
                items: {
                  orderBy: { position: "asc" },
                  include: {
                    sourceMediaAsset: true,
                    sourceTrack: { include: { mediaAsset: true } },
                    sourcePromoVersion: { include: { mediaAsset: true } },
                    sourceAnnouncement: { include: { promoVersion: { include: { mediaAsset: true } } } },
                    sourceTake: { include: { mediaAsset: true } }
                  }
                }
              }
            }
          }
        }
      }
    }) : Promise.resolve([]),
    channelId ? prisma.autoDjPolicy.findFirst({
      where: { organisationId: player.organisationId, channelId },
      include: {
        defaultMusicMode: {
          include: {
            tracks: { include: { track: { include: cataloguePlaybackTrackInclude } } }
          }
        },
        backupMusicMode: {
          include: {
            tracks: { include: { track: { include: cataloguePlaybackTrackInclude } } }
          }
        }
      }
    }) : Promise.resolve(null),
    channelId ? prisma.programmeSchedule.findFirst({
      where: { organisationId: player.organisationId, channelId },
      include: {
        versions: {
          where: { status: "PUBLISHED", isActive: true },
          orderBy: { version: "desc" },
          take: 1,
          include: {
            items: {
              orderBy: { position: "asc" },
              include: {
                musicMode: { include: playbackModeInclude },
                radioClock: {
                  include: {
                    items: {
                      orderBy: { position: "asc" },
                      include: {
                        musicMode: { include: playbackModeInclude },
                        track: { include: { mediaAsset: true } }
                      }
                    }
                  }
                },
                schoolRundown: {
                  include: {
                    episode: { select: { title: true } },
                    items: {
                      orderBy: { position: "asc" },
                      include: { sourceTrack: { include: { mediaAsset: true } } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }) : Promise.resolve(null),
    channelId ? prisma.externalLiveSource.findFirst({
      where: { organisationId: player.organisationId, channelId, status: "ACTIVE" },
      orderBy: { activatedAt: "desc" }
    }) : Promise.resolve(null),
    channelId ? prisma.liveFailoverPolicy.findUnique({
      where: { organisationId_channelId: { organisationId: player.organisationId, channelId } },
      include: { effectiveSource: true }
    }) : Promise.resolve(null),
    channelId ? prisma.radioAdvertisingPolicy.findUnique({
      where: { channelId_organisationId: { channelId, organisationId: player.organisationId } }
    }) : Promise.resolve(null),
    channelId ? prisma.subscriberPlaylistEvent.findFirst({
      where: { organisationId: player.organisationId, channelId, cancelledAt: null, startsAt: { lte: instant }, endsAt: { gt: instant } },
      include: { smartPlaylist: { include: { musicMode: { include: playbackModeInclude } } } },
      orderBy: { startsAt: "desc" }
    }) : Promise.resolve(null),
    channelId ? prisma.subscriberPlaylistEvent.findFirst({
      where: { organisationId: player.organisationId, channelId, cancelledAt: null, startsAt: { gt: instant } },
      select: { startsAt: true }, orderBy: { startsAt: "asc" }
    }) : Promise.resolve(null)
  ]);
  if (subscriberPlaylistEvent) {
    const playlist = subscriberPlaylistEvent.smartPlaylist;
    const eligibleEntries = await loadEligibleSubscriberMusic(prisma, {
      organisationId: player.organisationId, requiredUse: playlist.rightsUse,
      territory: playlist.territory, catalogueLevel: entitlements.licensedMusicCatalogueLevel, instant
    });
    playlist.musicMode.tracks = eligibleEntries.map((entry) => ({ track: entry.track, weight: 100 }));
  }
  if (autoDjPolicy?.defaultMusicMode?.slug === `nonstop-${channelId}`) {
    const eligibleEntries = await loadEligibleSubscriberMusic(prisma, {
      organisationId: player.organisationId, requiredUse: autoDjPolicy.rightsUse,
      territory: autoDjPolicy.territory, catalogueLevel: entitlements.licensedMusicCatalogueLevel,
      sourceScopes: Array.isArray(autoDjPolicy.sourceScopes) ? autoDjPolicy.sourceScopes : null, instant
    });
    autoDjPolicy.defaultMusicMode.tracks = eligibleEntries.map((entry) => ({ track: entry.track, weight: 100 }));
  }
  const legacyResolution = resolveMusicSchedule({
    schedules,
    instant,
    timezone: location.timezone,
    locationOpen: opening.isOpen,
    musicModeAvailable: (mode) => musicModeIsPlayable(mode, instant, { organisationId: player.organisationId, requiredUse, licensedCatalogueLevel: entitlements.licensedMusicCatalogueLevel })
  });
  const local = legacyResolution.local;
  const campaignPlayout = compileCampaignPlayout({
    campaigns,
    player,
    instant,
    radioAdvertisingPolicy,
    isLocationOpenAt: (candidateInstant) => location.openingHours.length
      ? evaluateLocationOpen({
          instant: candidateInstant,
          timezone: location.timezone,
          weeklyHours: location.openingHours,
          exceptions: location.openingExceptions
        }).isOpen
      : true
  });
  const schoolPlayout = compileSchoolRadioPlayout({ slots: schoolSlots, player, instant });
  const sharedPlayout = mergeSharedInsertions({ campaignPlayout, schoolPlayout });
  const candidates = [
    liveFailoverPolicy?.enabled
      ? liveFailoverCandidate(liveFailoverPolicy, { organisationId: player.organisationId, channelId, instant })
      : externalLiveCandidate(externalLiveSource, { organisationId: player.organisationId, channelId, instant }),
    ...advancedProgrammeCandidates(programmeSchedule, instant, player.organisationId, channelId, { licensedCatalogueLevel: entitlements.licensedMusicCatalogueLevel }),
    subscriberPlaylistCandidate(subscriberPlaylistEvent, { organisationId: player.organisationId, channelId, instant, licensedCatalogueLevel: entitlements.licensedMusicCatalogueLevel }),
    musicResolutionCandidate(legacyResolution, {
      organisationId: player.organisationId,
      channelId,
      instant
    }),
    ...autoDjCandidates(autoDjPolicy, {
      organisationId: player.organisationId,
      channelId,
      instant,
      locationOpen: opening.isOpen,
      local,
      licensedCatalogueLevel: entitlements.licensedMusicCatalogueLevel
    })
  ].filter(Boolean);
  const playoutDecision = resolveUnifiedPlayout({
    organisationId: player.organisationId,
    channelId,
    targetId: player.id,
    instant,
    candidates,
    requiredInsertions: [
      ...sharedPlayout.campaignPlayout.insertions,
      ...sharedPlayout.schoolPlayout.insertions
    ]
  });
  const resolution = playoutDecision.selectedPayload?.resolution || {
    musicMode: null,
    reason: "CRITICAL_FAILURE",
    sourceLabel: playoutDecision.sourceLabel,
    fallbackCause: null,
    local
  };
  resolution.alert = playoutDecision.operatorAlert || resolution.alert || null;
  resolution.licensedCatalogueLevel = entitlements.licensedMusicCatalogueLevel;
  resolution.requiredUse = requiredUse;
  if (nextSubscriberPlaylistEvent?.startsAt && (!resolution.validUntil || nextSubscriberPlaylistEvent.startsAt < resolution.validUntil)) {
    resolution.validUntil = nextSubscriberPlaylistEvent.startsAt;
  }
  if (persistOperationalEvidence && resolution.alert && channelId) {
    const localDate = resolution.local?.date || instant.toISOString().slice(0, 10);
    const dedupeKey = `playout:${channelId}:${resolution.alert.code}:${localDate}`;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.notificationEvent.findUnique({
        where: { organisationId_dedupeKey: { organisationId: player.organisationId, dedupeKey } },
        select: { id: true }
      });
      if (existing) return;
      await enqueueNotificationEvent(tx, {
        organisationId: player.organisationId,
        type: "AUTODJ_FAILURE",
        severity: resolution.alert.severity,
        title: resolution.alert.severity === "CRITICAL" ? "Channel programming unavailable" : "Channel fallback active",
        message: resolution.alert.message,
        entityType: "Channel",
        entityId: channelId,
        metadata: {
          channelId,
          playerId: player.id,
          resolution: resolution.reason,
          alertCode: resolution.alert.code,
          decisionId: playoutDecision.decisionId,
          selectedSourceType: playoutDecision.sourceType,
          localDate
        },
        dedupeKey,
        correlationId: `playout:${channelId}:${localDate}`,
        occurredAt: instant
      });
      await tx.auditLog.create({
        data: {
          organisationId: player.organisationId,
          action: resolution.alert.code === "PLAYOUT_FALLBACK_ACTIVE"
            ? "UNIFIED_PLAYOUT_FALLBACK_ACTIVATED"
            : resolution.alert.code === "NO_PLAYABLE_SOURCE"
              ? "UNIFIED_PLAYOUT_CRITICAL_FAILURE"
              : resolution.alert.code === "SCHEDULED_MODE_UNAVAILABLE"
                ? "AUTODJ_FALLBACK_ACTIVATED_AFTER_SCHEDULE_FAILURE"
                : resolution.alert.code === "DEFAULT_AUTODJ_UNAVAILABLE"
                  ? "AUTODJ_BACKUP_ACTIVATED"
                  : "AUTODJ_CRITICAL_PROGRAMMING_FAILURE",
          entityType: "Channel",
          entityId: channelId,
          details: {
            playerId: player.id,
            severity: resolution.alert.severity,
            alertCode: resolution.alert.code,
            fallbackSource: resolution.reason,
            decisionId: playoutDecision.decisionId,
            dedupeKey
          }
        }
      });
    });
  }
  if (persistOperationalEvidence && (sharedPlayout.campaignPlayout.insertions.length || sharedPlayout.schoolPlayout.insertions.length)) {
    await prisma.playoutIntent.createMany({
      data: [
        ...sharedPlayout.campaignPlayout.insertions.map((insertion) => playoutIntentCreateData({ insertion, player, channelId })),
        ...sharedPlayout.schoolPlayout.insertions.map((insertion) => schoolPlayoutIntentCreateData({ insertion, player, channelId }))
      ],
      skipDuplicates: true
    });
  }
  return {
    opening,
    resolution,
    playoutDecision,
    campaignPlayout: sharedPlayout.campaignPlayout,
    schoolPlayout: sharedPlayout.schoolPlayout
  };
}

