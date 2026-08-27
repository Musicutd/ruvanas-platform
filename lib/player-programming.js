import { prisma } from "@/lib/prisma";
import {
  compileCampaignPlayout,
  playoutIntentCreateData
} from "@/lib/campaign-playout.mjs";
import { evaluateLocationOpen } from "@/lib/opening-hours.mjs";
import { resolveMusicSchedule } from "@/lib/music-scheduling.mjs";

export async function resolvePlayerProgramming(player, instant = new Date()) {
  const location = player.zone.location;
  const opening = location.openingHours.length
    ? evaluateLocationOpen({
        instant,
        timezone: location.timezone,
        weeklyHours: location.openingHours,
        exceptions: location.openingExceptions
      })
    : { isOpen: true, source: "unconfigured" };
  const [schedules, campaigns] = await Promise.all([
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
    })
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
  if (campaignPlayout.insertions.length) {
    const channelId = player.zone.channelAssignments[0]?.channelId || null;
    await prisma.playoutIntent.createMany({
      data: campaignPlayout.insertions.map((insertion) =>
        playoutIntentCreateData({ insertion, player, channelId })
      ),
      skipDuplicates: true
    });
  }
  return {
    opening,
    resolution,
    campaignPlayout
  };
}
