import { prisma } from "@/lib/prisma";
import {
  compileCampaignPlayout,
  playoutIntentCreateData
} from "@/lib/campaign-playout.mjs";
import { evaluateLocationOpen } from "@/lib/opening-hours.mjs";
import { resolveMusicSchedule } from "@/lib/music-scheduling.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import {
  compileSchoolRadioPlayout,
  mergeSharedInsertions,
  schoolPlayoutIntentCreateData
} from "@/lib/school-radio.mjs";

export async function resolvePlayerProgramming(player, instant = new Date()) {
  const location = player.zone.location;
  const schoolRadioEnabled = resolveEntitlements(player.organisation?.subscription).schoolRadioEnabled;
  const opening = location.openingHours.length
    ? evaluateLocationOpen({
        instant,
        timezone: location.timezone,
        weeklyHours: location.openingHours,
        exceptions: location.openingExceptions
      })
    : { isOpen: true, source: "unconfigured" };
  const [schedules, campaigns, schoolSlots] = await Promise.all([
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
    }) : Promise.resolve([])
  ]);
  const resolution = resolveMusicSchedule({
    schedules,
    instant,
    timezone: location.timezone,
    locationOpen: opening.isOpen
  });
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
    const channelId = player.zone.channelAssignments[0]?.channelId || null;
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

