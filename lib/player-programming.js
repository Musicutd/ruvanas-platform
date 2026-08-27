import { prisma } from "@/lib/prisma";
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
  const schedules = await prisma.musicSchedule.findMany({
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
  });
  return {
    opening,
    resolution: resolveMusicSchedule({
      schedules,
      instant,
      timezone: location.timezone,
      locationOpen: opening.isOpen
    })
  };
}
