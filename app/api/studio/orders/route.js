import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MEMBER_ROLES } from "@/lib/permissions.mjs";
import { normaliseProductionOrderPayload, productionPermissions } from "@/lib/production-orders.mjs";
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
    }
  };
}

function serialiseOrder(order) {
  return { ...order, files: order.files.map(({ storageKey: _storageKey, sizeBytes, ...file }) => ({ ...file, sizeBytes: sizeBytes.toString() })) };
}

export async function GET() {
  const access = await requireActiveStudio(ORGANISATION_MEMBER_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const orders = await prisma.productionOrder.findMany({
    where: { organisationId: access.organisation.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: orderInclude()
  });
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
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.productionOrder.create({
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
    await tx.auditLog.create({
      data: {
        organisationId: access.organisation.id,
        actorUserId: access.user.id,
        action: input.submitNow ? "PRODUCTION_ORDER_SUBMITTED" : "PRODUCTION_ORDER_DRAFT_CREATED",
        entityType: "ProductionOrder",
        entityId: created.id,
        details: { status, priority: created.priority, fundingType: created.fundingType, languageCodes: created.languageCodes }
      }
    });
    return created;
  });
  return NextResponse.json({ order: serialiseOrder(order) }, { status: 201 });
}

