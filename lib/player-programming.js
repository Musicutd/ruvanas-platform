import { prisma } from "@/lib/prisma";
import {
  compileCampaignPlayout,
  playoutIntentCreateData
} from "@/lib/campaign-playout.mjs";
import { evaluateLocationOpen } from "@/lib/opening-hours.mjs";
import { resolveMusicSchedule } from "@/lib/music-scheduling.mjs";
import { musicModeIsPlayable } from "@/lib/music-mode-playback.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { enqueueNotificationEvent } from "@/lib/job-notification-service";
import {
  compileSchoolRadioPlayout,
  mergeSharedInsertions,
  schoolPlayoutIntentCreateData
} from "@/lib/school-radio.mjs";

export async function resolvePlayerProgramming(player, instant = new Date()) {
  const location = player.zone.location;
  const channelId = player.zone.channelAssignments[0]?.channelId || null;
  const schoolRadioEnabled = resolveEntitlements(player.organisation?.subscription).schoolRadioEnabled;
  const opening = location.openingHours.length
    ? evaluateLocationOpen({
        instant,
        timezone: location.timezone,
        weeklyHours: location.openingHours,
        exceptions: location.openingExceptions
      })
    : { isOpen: true, source: "unconfigured" };
  const [schedules, campaigns, schoolSlots, autoDjPolicy] = await Promise.all([
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
                        mediaAsset: {
                          select: {
                            id: true,
                            organisationId: true,
                            libraryType: true,
                            mediaType: true,
                            status: true,
                            durationSeconds: true
                          }
                        }
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
            tracks: { include: { track: { include: { mediaAsset: true } } } }
          }
        },
        backupMusicMode: {
          include: {
            tracks: { include: { track: { include: { mediaAsset: true } } } }
          }
        }
      }
    }) : Promise.resolve(null)
  ]);
  const resolution = resolveMusicSchedule({
    schedules,
    instant,
    timezone: location.timezone,
    locationOpen: opening.isOpen,
    autoDjPolicy: autoDjPolicy || { enabled: false, playbackPolicy: "FOLLOW_LOCATION_HOURS" },
    musicModeAvailable: (mode) => musicModeIsPlayable(mode, instant)
  });
  if (resolution.alert && channelId) {
    const dedupeKey = `autodj:${channelId}:${resolution.alert.code}:${resolution.local.date}`;
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
        title: resolution.alert.severity === "CRITICAL" ? "AutoDJ programming unavailable" : "AutoDJ fallback active",
        message: resolution.alert.message,
        entityType: "Channel",
        entityId: channelId,
        metadata: {
          channelId,
          playerId: player.id,
          resolution: resolution.reason,
          alertCode: resolution.alert.code,
          localDate: resolution.local.date
        },
        dedupeKey,
        correlationId: `autodj:${channelId}:${resolution.local.date}`,
        occurredAt: instant
      });
      await tx.auditLog.create({
        data: {
          organisationId: player.organisationId,
          action: resolution.alert.code === "SCHEDULED_MODE_UNAVAILABLE"
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
            dedupeKey
          }
        }
      });
    });
  }
  const campaignPlayout = compileCampaignPlayout({
    campaigns,
    player,
    instant,
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
  if (sharedPlayout.campaignPlayout.insertions.length || sharedPlayout.schoolPlayout.insertions.length) {
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
    campaignPlayout: sharedPlayout.campaignPlayout,
    schoolPlayout: sharedPlayout.schoolPlayout
  };
}

