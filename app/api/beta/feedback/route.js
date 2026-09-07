import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { hasSubscriberProduct } from "@/lib/product-access.mjs";
import { getRequestId } from "@/lib/security-log";
import {
  betaFeedbackVisibility,
  normalizeBetaFeedback
} from "@/lib/beta-operations.mjs";

export const dynamic = "force-dynamic";

function denied(status, error) {
  return NextResponse.json({ error }, { status });
}

async function activeContext() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } }
  });
  if (!context) return { response: denied(401, "Sign in to use the beta feedback workspace.") };
  if (context.user.role === "STUDENT") return { response: denied(403, "Student accounts cannot use the beta feedback workspace.") };
  if (!context.membership) return { response: denied(403, "Select an organisation before using beta feedback.") };
  return { context };
}

const participationSelect = {
  id: true,
  product: true,
  status: true,
  admittedAt: true,
  programme: { select: { id: true, name: true, description: true, status: true, startsAt: true, endsAt: true } }
};

export async function GET() {
  try {
    const access = await activeContext();
    if (access.response) return access.response;
    const { membership, user } = access.context;
    const [participations, feedback] = await Promise.all([
      prisma.betaParticipant.findMany({
        where: {
          organisationId: membership.organisationId,
          status: "ACTIVE",
          programme: { status: "ACTIVE" }
        },
        select: participationSelect,
        orderBy: { admittedAt: "desc" }
      }),
      prisma.betaFeedback.findMany({
        where: {
          organisationId: membership.organisationId,
          ...betaFeedbackVisibility({ membershipRole: membership.role, userId: user.id })
        },
        select: {
          id: true,
          product: true,
          category: true,
          severity: true,
          status: true,
          rating: true,
          subject: true,
          description: true,
          adminResponse: true,
          createdAt: true,
          updatedAt: true,
          programme: { select: { name: true } }
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 100
      })
    ]);
    return NextResponse.json({ participations, feedback });
  } catch (error) {
    console.error("Load beta feedback error:", error);
    return denied(500, "Unable to load the beta feedback workspace.");
  }
}

export async function POST(request) {
  try {
    const access = await activeContext();
    if (access.response) return access.response;
    const { membership, user } = access.context;
    let input;
    try { input = normalizeBetaFeedback(await request.json()); } catch (error) { return denied(400, error.message); }

    const participant = await prisma.betaParticipant.findFirst({
      where: {
        id: input.participantId,
        organisationId: membership.organisationId,
        status: "ACTIVE",
        programme: { status: "ACTIVE" }
      },
      include: { programme: true }
    });
    if (!participant) return denied(403, "This beta invitation is not active.");
    const entitlements = resolveEntitlements(membership.organisation.subscription);
    if (!hasSubscriberProduct(entitlements, participant.product)) {
      return denied(403, "Your organisation no longer has access to this beta product.");
    }

    const recentCount = await prisma.betaFeedback.count({
      where: {
        organisationId: membership.organisationId,
        createdByUserId: user.id,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1_000) }
      }
    });
    if (recentCount >= 5) return denied(429, "Please wait before sending more beta feedback.");

    const feedback = await prisma.$transaction(async (tx) => {
      const created = await tx.betaFeedback.create({ data: {
        programmeId: participant.programmeId,
        participantId: participant.id,
        organisationId: membership.organisationId,
        createdByUserId: user.id,
        product: participant.product,
        category: input.category,
        severity: input.severity,
        rating: input.rating,
        subject: input.subject,
        description: input.description
      } });
      await tx.auditLog.create({ data: {
        organisationId: membership.organisationId,
        actorUserId: user.id,
        action: "BETA_FEEDBACK_SUBMITTED",
        entityType: "BetaFeedback",
        entityId: created.id,
        details: {
          programmeId: participant.programmeId,
          product: participant.product,
          category: input.category,
          severity: input.severity,
          rating: input.rating,
          requestId: getRequestId(request)
        }
      } });
      return created;
    });
    return NextResponse.json({ ok: true, feedback: { id: feedback.id, status: feedback.status } }, { status: 201 });
  } catch (error) {
    console.error("Submit beta feedback error:", error);
    return denied(500, "Unable to submit beta feedback.");
  }
}
