import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { simplePlaylistAccess } from "@/lib/simple-playlist-access";
import { loadEligibleSubscriberMusic, rightsUseForChannel } from "@/lib/subscriber-playlist-service.mjs";
import { normaliseGenreCode, sourceScopeForTrack } from "@/lib/autodj-genre-entitlements.mjs";
import { subscriberProductAccess } from "@/lib/product-access.mjs";
import { previewTesterCatalogueMetadataPolicy } from "@/lib/private-preview-account-policy.mjs";
import { privatePreviewTesterRequestAllowed } from "@/lib/private-preview-tester-policy.mjs";
import { onlineDraftChannelWhere } from "@/lib/private-preview-online-draft.mjs";

export const dynamic = "force-dynamic";

const useByProduct = { RETAIL: "RETAIL_RADIO", SCHOOL: "SCHOOL_RADIO", ONLINE: "ONLINE_RADIO", HEALTH: "HEALTH_RADIO", FAITH: "FAITH_RADIO", ORGANISATIONS: "ORGANISATIONS_RADIO" };
const productByUse = Object.fromEntries(Object.entries(useByProduct).map(([product, use]) => [use, product]));

export async function GET(request) {
  const access = await simplePlaylistAccess();
  if (access.response) return access.response;
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const zoneId = searchParams.get("zoneId");
  const requestedProduct = searchParams.get("product")?.toUpperCase() || null;
  if (requestedProduct && !useByProduct[requestedProduct]) return NextResponse.json({ error: "Choose a supported Ruvanas service." }, { status: 400 });
  const query = (searchParams.get("q") || "").trim().toLowerCase().slice(0, 100);
  const genre = normaliseGenreCode(searchParams.get("genre") || "");
  const limit = Math.min(50, Math.max(1, Number.parseInt(searchParams.get("limit") || "30", 10) || 30));
  const organisationId = access.context.membership.organisationId;
  // A separate, owner-issued metadata grant never changes the account's actual
  // catalogue/audio entitlements. Recheck the live session and tenant here as
  // well as at the preview request boundary; a client flag cannot grant access.
  const plan = access.context.membership.organisation.subscription?.plan;
  const previewPlan = typeof plan?.code === "string" && plan.code.trim().toUpperCase().startsWith("PRIVATE_PREVIEW_");
  const previewMetadata = previewTesterCatalogueMetadataPolicy(plan);
  const metadataOnly = access.sandboxDraftOnly && Boolean(previewMetadata);
  if (previewPlan || access.sandboxDraftOnly || previewMetadata) {
    const session = access.context.session;
    if (!metadataOnly || session?.activeOrganisationId !== organisationId ||
        session?.user?.privatePreviewAccess?.organisationId !== organisationId ||
        !privatePreviewTesterRequestAllowed({ session, pathname: "/api/catalogue/music", method: "GET" }) ||
        requestedProduct !== "ONLINE" || !channelId || zoneId) {
      return NextResponse.json({ error: "Catalogue browsing is not enabled for this private test workspace." }, { status: 403 });
    }
  }
  let rightsUse = useByProduct[requestedProduct || access.entitlements.planProductFamily] || null;
  let territory = null;
  if (channelId) {
    const channel = await prisma.channel.findFirst({ where: { id: channelId, ...(metadataOnly ? onlineDraftChannelWhere(organisationId) : { organisationId }) }, include: {
      station: { select: { productFamily: true } },
      autoDjPolicy: { select: { territory: true } },
      zoneAssignments: { where: { activeFrom: { lte: new Date() }, OR: [{ activeTo: null }, { activeTo: { gt: new Date() } }] }, include: { zone: { include: { location: { select: { countryCode: true } } } } } }
    } });
    if (!channel) return NextResponse.json({ error: "Choose a channel owned by your organisation." }, { status: 404 });
    rightsUse = rightsUseForChannel(channel);
    if (requestedProduct && rightsUse !== useByProduct[requestedProduct]) return NextResponse.json({ error: "This channel belongs to another service." }, { status: 400 });
    territory = metadataOnly ? previewMetadata.territory : channel.autoDjPolicy?.territory || (channel.zoneAssignments.length === 1 ? channel.zoneAssignments[0].zone.location.countryCode : null);
  } else if (zoneId) {
    if (requestedProduct !== "RETAIL") return NextResponse.json({ error: "Choose a Retail listening area." }, { status: 400 });
    const zone = await prisma.zone.findFirst({ where: { id: zoneId, location: { organisationId } }, select: { location: { select: { countryCode: true } } } });
    if (!zone) return NextResponse.json({ error: "Choose a listening area owned by your organisation." }, { status: 404 });
    territory = zone.location.countryCode;
  }
  if (!rightsUse) return NextResponse.json({ error: "This product needs a music-rights profile." }, { status: 409 });
  if (!subscriberProductAccess(access.entitlements, productByUse[rightsUse]).allowed) {
    return NextResponse.json({ error: "This Ruvanas service is not included in your account." }, { status: 403 });
  }
  const scopes = metadataOnly ? ["RUVANAS_CORE", "LICENSED_CATALOGUE"] : [access.entitlements.includesRuvanasCatalogue ? "RUVANAS_CORE" : null, access.entitlements.licensedMusicCatalogueEnabled ? "LICENSED_CATALOGUE" : null].filter(Boolean);
  const catalogueLevel = metadataOnly ? previewMetadata.catalogueLevel : access.entitlements.licensedMusicCatalogueLevel;
  const configuredGenres = await prisma.mediaGenre.findMany({ where: { active: true }, select: { slug: true, name: true, active: true, minimumCatalogueLevel: true } });
  const entries = scopes.length ? await loadEligibleSubscriberMusic(prisma, {
    organisationId, requiredUse: rightsUse, territory,
    catalogueLevel,
    configuredGenres, sourceScopes: scopes
  }) : [];
  const filtered = entries.filter(({ track, genreCodes }) =>
    (!metadataOnly || track.rightsReviewStatus === "APPROVED") &&
    (!genre || genreCodes.includes(genre)) &&
    (!query || `${track.artist} ${track.title} ${track.album || ""} ${track.mixName || ""}`.toLowerCase().includes(query))
  );
  // Explicit allow-list. Never serialize provider responses, credentials, media keys or source URLs.
  const tracks = filtered.slice(0, limit).map(({ track, genreCodes }) => ({
    id: track.id, title: track.title, artist: track.artist, album: track.album,
    mix: track.mixName, bpm: track.bpm, durationSeconds: track.mediaAsset.durationSeconds,
    genreCodes, explicit: track.isExplicit, catalogueTier: track.minimumCatalogueLevel,
    source: sourceScopeForTrack(track) === "LICENSED_CATALOGUE" ? "Licensed catalogue" : "Ruvanas catalogue"
  }));
  return NextResponse.json({ tracks, total: filtered.length, limit, product: productByUse[rightsUse], sources: scopes, territoryKnown: Boolean(territory), catalogueLevel,
    metadataOnly, ...(metadataOnly ? { territory: previewMetadata.territory } : {}) }, { headers: { "Cache-Control": "private, no-store" } });
}
