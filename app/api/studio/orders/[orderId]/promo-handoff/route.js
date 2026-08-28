import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { buildPromoProcessingJobs, nextPromoVersionNumber, normalizePromoLanguageCode } from "@/lib/promo-versioning.mjs";
import { productionPermissions } from "@/lib/production-orders.mjs";
import { requireActiveStudio } from "@/lib/studio-access";

const handoffSchema = z.object({
  name: z.string().trim().min(2).max(160),
  mediaType: z.enum(["COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"]),
  languageCode: z.string().trim().min(2).max(35),
  durationSeconds: z.number().int().min(5).max(600).optional().nullable()
});

export async function POST(request, { params }) {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const permissions = productionPermissions({ platformRole: access.user.role, membershipRole: access.membership.role });
  if (!permissions.canProduce) return NextResponse.json({ error: "Only Ruvanas production staff can create the promo handoff." }, { status: 403 });

  const parsed = handoffSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Provide valid promotional-audio handoff details." }, { status: 400 });
  let languageCode;
  try { languageCode = normalizePromoLanguageCode(parsed.data.languageCode); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }

  const order = await prisma.productionOrder.findFirst({
    where: { id: String(params.orderId || ""), organisationId: access.organisation.id },
    include: {
      promoAsset: { include: { versions: { select: { id: true, version: true, sourceReference: true } } } },
      files: { where: { kind: "FINAL_MASTER" }, orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!order) return NextResponse.json({ error: "The production order was not found." }, { status: 404 });
  if (order.status !== "DELIVERED") return NextResponse.json({ error: "Deliver the approved final master before creating a promo handoff." }, { status: 409 });
  const finalMaster = order.files[0];
  if (!finalMaster) return NextResponse.json({ error: "This order has no final master." }, { status: 409 });
  const sourceReference = `production-order:${order.id}:file:${finalMaster.id}`;
  const existing = order.promoAsset?.versions.find((version) => version.sourceReference === sourceReference);
  if (existing) {
    return NextResponse.json({ promoAssetId: order.promoAsset.id, promoVersionId: existing.id, version: existing.version, created: false, reviewUrl: "/admin/media" });
  }

  const result = await prisma.$transaction(async (tx) => {
    let promoAsset = order.promoAsset;
    if (!promoAsset) {
      promoAsset = await tx.promoAsset.create({
        data: { organisationId: access.organisation.id, name: parsed.data.name, mediaType: parsed.data.mediaType, languageCode }
      });
      await tx.productionOrder.update({ where: { id: order.id }, data: { promoAssetId: promoAsset.id } });
    } else if (promoAsset.mediaType !== parsed.data.mediaType) {
      throw new Error("A replacement handoff must keep the promo asset's audio type.");
    }

    let mediaAsset = await tx.mediaAsset.findUnique({ where: { storageKey: finalMaster.storageKey } });
    if (!mediaAsset) {
      mediaAsset = await tx.mediaAsset.create({
        data: {
          organisationId: access.organisation.id,
          libraryType: "ORGANISATION_PROMO",
          name: parsed.data.name,
          originalName: finalMaster.originalName,
          storageKey: finalMaster.storageKey,
          mimeType: finalMaster.mimeType,
          sizeBytes: finalMaster.sizeBytes,
          durationSeconds: parsed.data.durationSeconds || null,
          mediaType: parsed.data.mediaType,
          status: "READY"
        }
      });
    }
    const promoVersion = await tx.promoVersion.create({
      data: {
        promoAssetId: promoAsset.id,
        mediaAssetId: mediaAsset.id,
        version: nextPromoVersionNumber(order.promoAsset?.versions || []),
        status: "IN_REVIEW",
        qcStatus: "PENDING",
        sourceType: "STUDIO",
        sourceReference,
        languageCode,
        checksumSha256: finalMaster.checksumSha256,
        durationSeconds: parsed.data.durationSeconds || null,
        submittedById: access.user.id,
        submittedAt: new Date(),
        processingJobs: { create: buildPromoProcessingJobs() }
      }
    });
    await tx.productionOrderEvent.create({
      data: { organisationId: access.organisation.id, orderId: order.id, actorUserId: access.user.id, eventType: "PROMO_HANDOFF_CREATED", note: `Final master sent to promo review as ${promoAsset.name} version ${promoVersion.version}.` }
    });
    await tx.auditLog.create({
      data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "PRODUCTION_ORDER_PROMO_HANDOFF_CREATED", entityType: "PromoVersion", entityId: promoVersion.id, details: { orderId: order.id, promoAssetId: promoAsset.id, version: promoVersion.version, sourceReference } }
    });
    return { promoAsset, promoVersion };
  });

  return NextResponse.json({ promoAssetId: result.promoAsset.id, promoVersionId: result.promoVersion.id, version: result.promoVersion.version, created: true, reviewUrl: "/admin/media" }, { status: 201 });
}


