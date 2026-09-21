import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import { readPromoOnlyConfig, safePromoOnlyConfig } from "@/lib/promo-only.mjs";
import PromoOnlyConsole from "./PromoOnlyConsole";

export const dynamic = "force-dynamic";
export const metadata = { title: "Promo Only testing | Ruvanas Administration" };

export default async function PromoOnlyPage() {
  const user = await getAdminUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");
  let config;
  let configError = null;
  try { config = safePromoOnlyConfig(readPromoOnlyConfig()); }
  catch (error) { config = safePromoOnlyConfig({ mode: "OFF" }); configError = error.code || "PROMOONLY_CONFIG_INVALID"; }
  const connection = await prisma.musicDistributorConnection.findUnique({ where: { providerKey: "PROMO_ONLY" }, select: { id: true, status: true, lastSuccessfulSyncAt: true, lastErrorCode: true, nextSyncAt: true, _count: { select: { tracks: true, feedItems: true, syncRuns: true } } } });
  const [runs, feedItems, tracks, mappings, genres] = await Promise.all([
    connection ? prisma.musicDistributorSyncRun.findMany({ where: { connectionId: connection.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, trigger: true, mode: true, status: true, fetchedCount: true, enrichedCount: true, downloadedCount: true, rejectedCount: true, createdAt: true, completedAt: true, safeErrorCode: true } }) : [],
    connection ? prisma.musicProviderFeedItem.findMany({ where: { connectionId: connection.id }, orderBy: { lastSeenAt: "desc" }, take: 30, select: { id: true, status: true, normalizedPayload: true, externalTrackId: true, externalReleaseId: true, firstSeenAt: true, lastErrorCode: true } }) : [],
    connection ? prisma.musicDistributorTrack.findMany({ where: { connectionId: connection.id }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, artist: true, title: true, mixName: true, bpm: true, durationSeconds: true, label: true, releaseDate: true, externalTrackId: true, externalTitleId: true, sourceGenre: true, isExplicit: true, contentWarning: true, minimumCatalogueLevel: true, importState: true, audioStatus: true, autoDjReady: true, status: true, lastImportErrorCode: true, trackId: true, canonicalGenre: { select: { id: true, name: true, active: true, providerReviewStatus: true } }, track: { select: { status: true, rightsReviewStatus: true } }, release: { select: { externalReleaseId: true } } } }) : [],
    prisma.musicProviderGenreMapping.findMany({ where: { provider: "PROMO_ONLY" }, include: { catalogGenre: { select: { id: true, name: true, active: true, providerReviewStatus: true } } }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.mediaGenre.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, active: true }, take: 300 })
  ]);
  const serializable = (value) => JSON.parse(JSON.stringify(value));
  return <main style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 16px 64px", color: "#172033" }}>
    <p style={{ color: "#9a6400", fontWeight: 900, letterSpacing: 1 }}>PLATFORM CATALOGUE · TESTING ONLY</p>
    <h1>Promo Only catalogue sync</h1>
    <p>RSS discovery and authenticated metadata feed the existing Super Admin Licensed Music Catalogue. Audio testing requires separate server permission, a Promo Only download grant and a Super Admin; imported media remains unapproved until rights review.</p>
    <p><Link href="/admin/catalogue">Open the master Music Catalogue</Link> · <Link href="/admin/music-distributors">Other music distributors</Link></p>
    <PromoOnlyConsole initial={serializable({ config, configError, connection, runs, feedItems, tracks, mappings, genres })} />
  </main>;
}
