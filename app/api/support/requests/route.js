import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { generateOperationalReference } from "@/lib/compliance-operations.mjs";
import { getRequestId } from "@/lib/security-log";
import {
  normalizeSubscriberSupportRequest,
  subscriberSupportCategoryLabel,
  subscriberSupportVisibility
} from "@/lib/subscriber-support.mjs";

function denied(status, error) {
  return NextResponse.json({ error }, { status });
}

async function activeContext() {
  const context = await getActiveOrganisationContext();
  if (!context) return { response: denied(401, "Sign in to use subscriber support.") };
  if (context.user.role === "STUDENT") return { response: denied(403, "Student accounts use the supervised School Radio workspace.") };
  if (!context.membership) return { response: denied(403, "Select an organisation before using subscriber support.") };
  return { context };
}

export async function GET() {
  try {
    const access = await activeContext();
    if (access.response) return access.response;
    const { membership, user } = access.context;
    const tickets = await prisma.supportTicket.findMany({
      where: {
        organisationId: membership.organisationId,
        linkedEntityType: "SUBSCRIBER_SUPPORT",
        ...subscriberSupportVisibility({ membershipRole: membership.role, userId: user.id })
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        reference: true,
        subject: true,
        description: true,
        linkedEntityId: true,
        priority: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true
      }
    });
    return NextResponse.json({ tickets });
  } catch (error) {
    console.error("Load subscriber support requests error:", error);
    return denied(500, "Unable to load support requests.");
  }
}

export async function POST(request) {
  try {
    const access = await activeContext();
    if (access.response) return access.response;
    const { membership, user } = access.context;
    let input;
    try {
      input = normalizeSubscriberSupportRequest(await request.json());
    } catch (error) {
      return denied(400, error instanceof Error ? error.message : "Check the support request.");
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1_000);
    const recentCount = await prisma.supportTicket.count({
      where: {
        organisationId: membership.organisationId,
        createdByUserId: user.id,
        linkedEntityType: "SUBSCRIBER_SUPPORT",
        createdAt: { gte: tenMinutesAgo }
      }
    });
    if (recentCount >= 3) return denied(429, "Please wait before sending another support request.");

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          organisationId: membership.organisationId,
          createdByUserId: user.id,
          reference: generateOperationalReference("SUP"),
          priority: "NORMAL",
          subject: input.subject,
          description: input.description,
          linkedEntityType: "SUBSCRIBER_SUPPORT",
          linkedEntityId: input.category
        },
        select: {
          id: true,
          reference: true,
          subject: true,
          description: true,
          linkedEntityId: true,
          priority: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: membership.organisationId,
          actorUserId: user.id,
          action: "SUBSCRIBER_SUPPORT_REQUEST_CREATED",
          entityType: "SupportTicket",
          entityId: created.id,
          details: {
            reference: created.reference,
            category: input.category,
            categoryLabel: subscriberSupportCategoryLabel(input.category),
            requestId: getRequestId(request)
          }
        }
      });
      return created;
    });

    return NextResponse.json({ ok: true, ticket }, { status: 201 });
  } catch (error) {
    console.error("Create subscriber support request error:", error);
    return denied(500, "Unable to create the support request.");
  }
}
