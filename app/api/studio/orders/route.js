import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { normaliseProductionOrderPayload, productionPermissions } from "@/lib/production-orders.mjs";
import { appendProductionCreditEntry, productionCreditSummary } from "@/lib/production-credit-service";
import { requireActiveStudio } from "@/lib/studio-access";

export const dynamic = "force-dynamic";

function orderInclude() {
  return {
    createdBy: { select: { id: true, name: true, email: true } },
    assignedTo: { select: { id: true, name: true, email: true } },
    events: {
      orderBy: { createdAt: "asc" },
      include: { actor: { select: { id: true, name: true, email: true } } }
    },
    files: {
      orderBy: { createdAt: "desc" },
      include: { uploadedBy: { select: { id: true, name: true, email: true } } }
    },
    scripts: {
      orderBy: { version: "desc" },
      include: { createdBy: { select: { id: true, name: true, email: true } } }
    },
    revisions: {
      orderBy: { createdAt: "desc" },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        resolvedBy: { select: { id: true, name: true, email: true } }
      }
    },
    promoAsset: {
      select: {
        id: true,
        name: true,
        currentApprovedVersionId: true,
        versions: {
          orderBy: { version: "desc" },
          select: { id: true, version: true, status: true, qcStatus: true, languageCode: true, sourceReference: true, createdAt: true }
        }
      }
    }
  };
}

function serialiseOrder(order) {
  return { ...order, files: order.files.map(({ storageKey: _storageKey, sizeBytes, ...file }) => ({ ...file, sizeBytes: sizeBytes.toString() })) };
}

export async function GET() {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const [orders, credits] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { organisationId: access.organisation.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: orderInclude()
    }),
    productionCreditSummary(prisma, access.organisation.id)
  ]);
  const permissions = productionPermissions({ platformRole: access.user.role, membershipRole: access.membership.role });
  const staff = permissions.canProduce ? await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "SUPPORT"] } },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true, role: true }
  }) : [];
  return NextResponse.json({
    organisation: { id: access.organisation.id, name: access.organisation.name },
    role: access.membership.role,
    platformRole: access.user.role,
    permissions,
    credits,
    canManageCredits: access.user.role === "SUPER_ADMIN",
    staff,
    orders: orders.map(serialiseOrder)
  });
}

export async function POST(request) {
  const access = await requireActiveStudio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  let input;
  try {
    input = normaliseProductionOrderPayload(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Provide a valid production brief." }, { status: 400 });
  }
  const status = input.submitNow ? "SUBMITTED" : "DRAFT";
  const now = new Date();
  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      let created = await tx.productionOrder.create({
      data: {
        organisationId: access.organisation.id,
        createdByUserId: access.user.id,
        title: input.title,
        promotionDetails: input.promotionDetails,
        mandatoryLegalWording: input.mandatoryLegalWording,
        languageCodes: input.languageCodes,
        voicePreference: input.voicePreference,
        toneStyle: input.toneStyle,
        targetDurationSeconds: input.targetDurationSeconds,
        musicBedPreference: input.musicBedPreference,
        campaignStartsOn: input.campaignStartsOn,
        campaignEndsOn: input.campaignEndsOn,
        pronunciationNotes: input.pronunciationNotes,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        fundingType: input.fundingType,
        fundingStatus: "PENDING",
        priority: input.priority,
        deadlineAt: input.deadlineAt,
        status,
        submittedAt: input.submitNow ? now : null,
        events: {
          create: {
            organisationId: access.organisation.id,
            actorUserId: access.user.id,
            eventType: "CREATED",
            toStatus: status,
            note: input.submitNow ? "Order created and submitted for production review." : "Draft production order created."
          }
        }
      },
      include: orderInclude()
      });
      if (input.submitNow && input.fundingType === "PLAN_INCLUDED") {
        await appendProductionCreditEntry(tx, {
          organisationId: access.organisation.id,
          orderId: created.id,
          actorUserId: access.user.id,
          entryType: "RESERVE",
          quantity: 1,
          idempotencyKey: `production-order:${created.id}:reserve`
        });
        created = await tx.productionOrder.update({
          where: { id: created.id },
          data: { fundingStatus: "RESERVED" },
          include: orderInclude()
        });
        await tx.productionOrderEvent.create({
          data: { organisationId: access.organisation.id, orderId: created.id, actorUserId: access.user.id, eventType: "FUNDING_CHANGED", note: "One plan-included production credit reserved." }
        });
      }
      await tx.auditLog.create({
      data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: input.submitNow ? "PRODUCTION_ORDER_SUBMITTED" : "PRODUCTION_ORDER_DRAFT_CREATED",
        entityType: "ProductionOrder",
        entityId: created.id,
          details: { status, priority: created.priority, fundingType: created.fundingType, fundingStatus: created.fundingStatus, languageCodes: created.languageCodes }
        }
      });
      return created;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The production order could not be created.";
    if (message.includes("production credits")) return NextResponse.json({ error: message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ order: serialiseOrder(order) }, { status: 201 });
}

