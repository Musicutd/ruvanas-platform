import { prisma } from "@/lib/prisma";
import { correctionsFacilityAccess, correctionsRequestContext } from "@/lib/corrections-access";
import { correctionsResponse } from "@/lib/corrections-http";
import { correctionsMusicEligibility } from "@/lib/corrections-policy.mjs";
import { loadEligibleSubscriberMusic } from "@/lib/subscriber-playlist-service.mjs";
import { correctionsC5Features } from "@/lib/corrections-c5-policy.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const access = await correctionsRequestContext();
  if (!access.ok) return correctionsResponse(access);
  if (!correctionsC5Features(access.entitlements).internalRequests) return correctionsResponse({ error: "Requests are not included in this plan." }, 403);
  const facilityId = new URL(request.url).searchParams.get("facilityId");
  const facility = await correctionsFacilityAccess(access, facilityId);
  if (!facility) return correctionsResponse({ error: "Facility not available." }, 404);
  const [organisationPolicy, configuredGenres] = await Promise.all([
    prisma.correctionsProfile.findUnique({ where: { organisationId: access.organisationId } }),
    prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true, active: true, minimumCatalogueLevel: true } })
  ]);
  const entries = await loadEligibleSubscriberMusic(prisma, { organisationId: access.organisationId, requiredUse: "CORRECTIONS_RADIO", territory: facility.location.countryCode, catalogueLevel: access.entitlements.licensedMusicCatalogueLevel, configuredGenres });
  const tracks = entries.filter(({ track }) => correctionsMusicEligibility(track, { organisationId: access.organisationId, facility, facilityPolicy: facility, organisationPolicy, licensedCatalogueLevel: access.entitlements.licensedMusicCatalogueLevel, configuredGenres }).playable)
    .slice(0, 100).map(({ track }) => ({ id: track.id, title: track.title, artist: track.artist }));
  return correctionsResponse({ ok: true, tracks });
}
