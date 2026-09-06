import { resolveTxt } from "node:dns/promises";
import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { buildPlayerManifest } from "@/lib/player-manifest.mjs";
import { publicNowPlaying } from "@/lib/public-player.mjs";
import { loadPublicPlayerStation, publicPlayerTarget } from "@/lib/public-player-service";
import { resolvePlayerProgramming } from "@/lib/player-programming";
import { stationDomainDnsName, stationDomainTxtVerified } from "@/lib/station-website.mjs";

const publishedSeries = {
  where: {
    product: "ONLINE_RADIO",
    publicationScope: "PUBLIC",
    rssEnabled: true,
    episodes: { some: { status: "PUBLISHED", publicationScope: "PUBLIC", publishedAt: { not: null } } }
  },
  orderBy: { updatedAt: "desc" },
  take: 12,
  select: {
    id: true, title: true, description: true, feedSlug: true, author: true, artworkUrl: true,
    episodes: { where: { status: "PUBLISHED", publicationScope: "PUBLIC", publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, take: 1, select: { title: true, publishedAt: true } }
  }
};

const websiteSelect = {
  id: true, organisationId: true, name: true, slug: true, description: true, logoUrl: true,
  publicPlayerEnabled: true, publicPlayerTagline: true, publicPlayerAccent: true,
  stationWebsiteEnabled: true, stationWebsiteHeadline: true, stationWebsiteAbout: true,
  stationWebsiteHeroImageUrl: true, stationWebsiteContactEmail: true, stationWebsiteTheme: true,
  stationWebsiteLinks: true, stationWebsiteShowNowPlaying: true, stationWebsiteShowPodcasts: true,
  organisation: { select: { name: true, slug: true, subscription: { include: { plan: true, billingContract: true } } } },
  podcastSeries: publishedSeries
};

function safeWebsite(station) {
  if (!station || !station.stationWebsiteEnabled || !resolveEntitlements(station.organisation.subscription).serviceEnabled) return null;
  return {
    id: station.id,
    name: station.name,
    slug: station.slug,
    description: station.description,
    logoUrl: station.logoUrl,
    playerEnabled: station.publicPlayerEnabled,
    tagline: station.publicPlayerTagline,
    accent: station.publicPlayerAccent,
    headline: station.stationWebsiteHeadline || station.publicPlayerTagline || `Live radio from ${station.name}`,
    about: station.stationWebsiteAbout || station.description,
    heroImageUrl: station.stationWebsiteHeroImageUrl,
    contactEmail: station.stationWebsiteContactEmail,
    theme: station.stationWebsiteTheme,
    links: Array.isArray(station.stationWebsiteLinks) ? station.stationWebsiteLinks : [],
    showNowPlaying: station.stationWebsiteShowNowPlaying,
    showPodcasts: station.stationWebsiteShowPodcasts,
    organisation: { name: station.organisation.name, slug: station.organisation.slug },
    podcasts: station.stationWebsiteShowPodcasts ? station.podcastSeries.map((series) => ({
      id: series.id, title: series.title, description: series.description, author: series.author,
      artworkUrl: series.artworkUrl, latestEpisode: series.episodes[0] || null,
      url: `/podcasts/${station.organisation.slug}/${series.feedSlug}`,
      rssUrl: `/api/public/podcasts/${station.organisation.slug}/${series.feedSlug}/rss`
    })) : []
  };
}

export async function loadPublicStationWebsiteBySlug(slug, database = prisma) {
  if (!/^[a-z0-9-]{1,120}$/i.test(slug || "")) return null;
  return safeWebsite(await database.station.findFirst({ where: { slug, status: "ACTIVE", stationWebsiteEnabled: true }, select: websiteSelect }));
}

export async function loadPublicStationWebsiteByDomain(hostname, database = prisma) {
  const domain = await database.stationDomain.findFirst({
    where: { hostname, status: "ACTIVE", station: { status: "ACTIVE", stationWebsiteEnabled: true } },
    select: { station: { select: websiteSelect } }
  });
  return safeWebsite(domain?.station);
}

export async function loadPublicStationNowPlaying(slug, instant = new Date(), database = prisma) {
  const station = await loadPublicPlayerStation(database, slug);
  if (!station || !station.stationWebsiteEnabled || !station.stationWebsiteShowNowPlaying) return null;
  const target = publicPlayerTarget(station, instant);
  if (!target) return { station: station.name, channel: null, state: "NOT_READY", nowPlaying: null };
  const programming = await resolvePlayerProgramming(target.player, instant, { persistOperationalEvidence: false, publicAudience: true });
  const manifest = buildPlayerManifest({
    player: target.player,
    resolution: programming.resolution,
    playoutDecision: programming.playoutDecision,
    campaignPlayout: programming.campaignPlayout,
    schoolPlayout: programming.schoolPlayout,
    instant,
    includeProof: false,
    mediaUrlFor: () => null,
    liveUrlFor: () => null
  });
  return { station: station.name, channel: target.channel.name, state: manifest.state, nowPlaying: publicNowPlaying(manifest, instant), generatedAt: instant.toISOString() };
}

export async function verifyStationDomainDns(domain, resolver = resolveTxt) {
  let records;
  try { records = await resolver(stationDomainDnsName(domain.hostname)); }
  catch { return false; }
  return stationDomainTxtVerified(records, domain.verificationToken);
}
