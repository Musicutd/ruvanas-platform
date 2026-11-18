import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { readPromoOnlyConfig } from "@/lib/promo-only.mjs";
import { PromoOnlyApiClient } from "@/lib/promo-only-client.mjs";
import { promoOnlyPayloadHash } from "@/lib/promo-only.mjs";
import { syncPromoOnlyGenre } from "@/lib/provider-genre-service";
import { promoOnlyApprovalScopeDecision, updatePromoOnlyOwnedTrack } from "@/lib/promo-only-playback.mjs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SET_TIER"), minimumCatalogueLevel: z.enum(["FOCUSED", "PROFESSIONAL", "PREMIUM"]) }).strict(),
  z.object({ action: z.literal("QUARANTINE") }).strict(),
  z.object({ action: z.literal("ENABLE"), rightsReference: z.string().trim().min(5).max(500), permittedUses: z.array(z.enum(["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO", "HEALTH_RADIO", "FAITH_RADIO", "ORGANISATIONS_RADIO"])).min(1).max(6), permittedTerritories: z.string().trim().min(2).max(500) }).strict(),
  z.object({ action: z.literal("REFRESH_METADATA") }).strict(),
  z.object({ action: z.literal("RETRY_DOWNLOAD") }).strict()
]);

export async function PATCH(request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);
  if (access.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin may manage Promo Only catalogue records." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid Promo Only catalogue action." }, { status: 400 });
  const item = await prisma.musicDistributorTrack.findFirst({ where: { id: params.trackId, connection: { providerKey: "PROMO_ONLY" } }, include: {
    canonicalGenre: true,
    connection: { select: { status: true, defaultPermittedTerritories: true, defaultPermittedUses: true } }
  } });
  if (!item) return NextResponse.json({ error: "Promo Only track not found." }, { status: 404 });
  const { action } = parsed.data;
  try {
    if (action === "REFRESH_METADATA") {
      const config = readPromoOnlyConfig();
      if (!["METADATA", "AUDIO_TEST"].includes(config.mode)) return NextResponse.json({ error: "Enable METADATA mode server-side before refreshing provider metadata." }, { status: 409 });
      const payload = await new PromoOnlyApiClient(config).track(item.externalTrackId);
      const { mapPromoOnlyTrack } = await import("@/lib/promo-only.mjs");
      const metadata = mapPromoOnlyTrack(payload);
      if (metadata.externalTrackId !== item.externalTrackId) return NextResponse.json({ error: "Promo Only returned a different track identity." }, { status: 409 });
      const genre = await syncPromoOnlyGenre(prisma, metadata.sourceGenre, config);
      const checksum = promoOnlyPayloadHash(metadata.providerMetadata);
      const needsReconciliation = Boolean(item.trackId && item.metadataChecksum !== checksum);
      const update = {
        title: metadata.title, artist: metadata.artist, album: metadata.album, label: metadata.label,
        mixName: metadata.mixName, bpm: metadata.bpm, durationSeconds: metadata.durationSeconds,
        sourceGenre: metadata.sourceGenre, canonicalGenreId: genre.genre?.id || null, genreCodes: genre.genre ? [genre.genre.slug] : [], releaseDate: metadata.releaseDate, contentWarning: metadata.contentWarning,
        isExplicit: metadata.isExplicit, externalTitleId: metadata.externalTitleId,
        providerMetadata: metadata.providerMetadata, metadataChecksum: checksum, sourceModifiedAt: metadata.sourceModifiedAt,
        ...(needsReconciliation ? { importState: "RECONCILIATION_REQUIRED", autoDjReady: false } : {}),
        revision: { increment: 1 }
      };
      if (needsReconciliation) {
        await prisma.$transaction(async (tx) => {
          await updatePromoOnlyOwnedTrack(tx, item.trackId, { status: "DRAFT", rightsReviewStatus: "DRAFT" });
          await tx.musicDistributorTrack.update({ where: { id: item.id }, data: update });
        });
      } else {
        await prisma.musicDistributorTrack.update({ where: { id: item.id }, data: update });
      }
    } else if (action === "SET_TIER") {
      await prisma.$transaction(async (tx) => {
        if (item.trackId) await updatePromoOnlyOwnedTrack(tx, item.trackId, { minimumCatalogueLevel: parsed.data.minimumCatalogueLevel });
        await tx.musicDistributorTrack.update({ where: { id: item.id }, data: { minimumCatalogueLevel: parsed.data.minimumCatalogueLevel } });
      });
    } else if (action === "QUARANTINE") {
      await prisma.$transaction(async (tx) => {
        if (item.trackId) await updatePromoOnlyOwnedTrack(tx, item.trackId, { status: "ARCHIVED" });
        await tx.musicDistributorTrack.update({ where: { id: item.id }, data: { status: "UNAVAILABLE", autoDjReady: false, importState: "CATALOGUED" } });
      });
    } else if (action === "ENABLE") {
      let config;
      try { config = readPromoOnlyConfig(); } catch { return NextResponse.json({ error: "Promo Only audio testing is not enabled." }, { status: 409 }); }
      if (!config.enabled || config.mode !== "AUDIO_TEST" || item.connection?.status !== "ACTIVE") {
        return NextResponse.json({ error: "Promo Only audio testing and its provider connection must be active." }, { status: 409 });
      }
      if (!item.trackId || item.status !== "ACTIVE" || !item.canonicalGenre?.active || item.canonicalGenre.providerReviewStatus !== "APPROVED") return NextResponse.json({ error: "Import audio, approve the genre and confirm the provider is active first." }, { status: 409 });
      const scope = promoOnlyApprovalScopeDecision({
        territories: parsed.data.permittedTerritories,
        uses: parsed.data.permittedUses,
        approvedTerritories: item.connection.defaultPermittedTerritories,
        approvedUses: item.connection.defaultPermittedUses
      });
      if (!scope.allowed) {
        return NextResponse.json({ error: "Choose only contract-approved countries and product uses for this supplier." }, { status: 409 });
      }
      await prisma.$transaction(async (tx) => {
        const connection = await tx.musicDistributorConnection.findUnique({ where: { id: item.connectionId }, select: { status: true, defaultPermittedTerritories: true, defaultPermittedUses: true } });
        if (connection?.status !== "ACTIVE" || !promoOnlyApprovalScopeDecision({
          territories: scope.territoryCodes,
          uses: parsed.data.permittedUses,
          approvedTerritories: connection.defaultPermittedTerritories,
          approvedUses: connection.defaultPermittedUses
        }).allowed) throw new Error("Promo Only rights scope changed during approval.");
        await updatePromoOnlyOwnedTrack(tx, item.trackId, { status: "READY", rightsReference: parsed.data.rightsReference, permittedUses: parsed.data.permittedUses, permittedTerritories: scope.territoryCodes.join(", "), rightsReviewStatus: "APPROVED", rightsReviewedAt: new Date(), rightsReviewedById: access.user.id, rightsConfirmedAt: new Date(), rightsConfirmedById: access.user.id });
        await tx.musicDistributorTrack.update({ where: { id: item.id }, data: { permittedUses: parsed.data.permittedUses, permittedTerritories: scope.territoryCodes, autoDjReady: true, importState: "AUTODJ_READY", audioStatus: "READY" } });
      });
    } else if (action === "RETRY_DOWNLOAD") {
      if (item.trackId || !["FAILED_RETRYABLE", "FAILED_PERMANENT"].includes(item.audioStatus)) return NextResponse.json({ error: "Only failed, unlinked audio can be retried." }, { status: 409 });
      await prisma.musicDistributorTrack.update({ where: { id: item.id }, data: { audioStatus: "NOT_REQUESTED", importState: "METADATA_READY", lastImportErrorCode: null } });
    }
    await prisma.auditLog.create({ data: { actorUserId: access.user.id, action: `PROMOONLY_${action}`, entityType: "MusicDistributorTrack", entityId: item.id, details: { externalTrackId: item.externalTrackId, ...(action === "SET_TIER" ? { minimumCatalogueLevel: parsed.data.minimumCatalogueLevel } : {}), ...(action === "ENABLE" ? { rightsReference: parsed.data.rightsReference, permittedUses: parsed.data.permittedUses, permittedTerritories: parsed.data.permittedTerritories } : {}) } } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "The Promo Only catalogue action could not be completed safely." }, { status: 500 });
  }
}
