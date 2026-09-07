import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { getRequestId } from "@/lib/security-log";
import {
  assertBetaTransition,
  betaParticipantDecision,
  normalizeBetaParticipant,
  normalizeBetaProgramme
} from "@/lib/beta-operations.mjs";

export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE_PROGRAMME"),
    name: z.string(),
    description: z.string().optional().nullable(),
    maxOrganisations: z.number(),
    startsAt: z.string().optional().nullable(),
    endsAt: z.string().optional().nullable()
  }).strict(),
  z.object({
    action: z.literal("SET_PROGRAMME_STATUS"),
    programmeId: z.string().min(1).max(191),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "CLOSED"])
  }).strict(),
  z.object({
    action: z.literal("ADD_PARTICIPANT"),
    programmeId: z.string(),
    organisationId: z.string(),
    product: z.enum(["RETAIL", "SCHOOL", "ONLINE"]),
    internalNote: z.string().optional().nullable()
  }).strict(),
  z.object({
    action: z.literal("SET_PARTICIPANT_STATUS"),
    participantId: z.string().min(1).max(191),
    status: z.enum(["ACTIVE", "PAUSED", "COMPLETED", "REMOVED"])
  }).strict(),
  z.object({
    action: z.literal("TRIAGE_FEEDBACK"),
    feedbackId: z.string().min(1).max(191),
    status: z.enum(["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
    adminResponse: z.string().trim().max(4_000).optional().nullable()
  }).strict()
]);

function denied(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return denied(parsed.error.issues[0]?.message || "Check the beta operation.");
    const input = parsed.data;
    const requestId = getRequestId(request);
    const superAdminAction = input.action !== "TRIAGE_FEEDBACK";
    if (superAdminAction && access.user.role !== "SUPER_ADMIN") {
      return denied("Only a Ruvanas Super Admin can change beta access.", 403);
    }

    if (input.action === "CREATE_PROGRAMME") {
      let programmeInput;
      try { programmeInput = normalizeBetaProgramme(input); } catch (error) { return denied(error.message); }
      const programme = await prisma.$transaction(async (tx) => {
        const created = await tx.betaProgramme.create({ data: { ...programmeInput, createdByUserId: access.user.id } });
        await tx.auditLog.create({ data: {
          actorUserId: access.user.id,
          action: "BETA_PROGRAMME_CREATED",
          entityType: "BetaProgramme",
          entityId: created.id,
          details: { name: created.name, maxOrganisations: created.maxOrganisations, requestId }
        } });
        return created;
      });
      return NextResponse.json({ ok: true, programme }, { status: 201 });
    }

    if (input.action === "SET_PROGRAMME_STATUS") {
      const existing = await prisma.betaProgramme.findUnique({ where: { id: input.programmeId } });
      if (!existing) return denied("Beta programme not found.", 404);
      try { assertBetaTransition("programme", existing.status, input.status); } catch (error) { return denied(error.message, 409); }
      const programme = await prisma.$transaction(async (tx) => {
        const updated = await tx.betaProgramme.update({ where: { id: existing.id }, data: { status: input.status } });
        await tx.auditLog.create({ data: {
          actorUserId: access.user.id,
          action: "BETA_PROGRAMME_STATUS_CHANGED",
          entityType: "BetaProgramme",
          entityId: existing.id,
          details: { fromStatus: existing.status, toStatus: updated.status, requestId }
        } });
        return updated;
      });
      return NextResponse.json({ ok: true, programme });
    }

    if (input.action === "ADD_PARTICIPANT") {
      let participantInput;
      try { participantInput = normalizeBetaParticipant(input); } catch (error) { return denied(error.message); }
      const [programme, organisation, existing, admittedOrganisations] = await Promise.all([
        prisma.betaProgramme.findUnique({ where: { id: participantInput.programmeId } }),
        prisma.organisation.findUnique({
          where: { id: participantInput.organisationId },
          include: { subscription: { include: { plan: true, billingContract: true } } }
        }),
        prisma.betaParticipant.findUnique({ where: { programmeId_organisationId_product: {
          programmeId: participantInput.programmeId,
          organisationId: participantInput.organisationId,
          product: participantInput.product
        } } }),
        prisma.betaParticipant.findMany({
          where: { programmeId: participantInput.programmeId, status: { not: "REMOVED" } },
          distinct: ["organisationId"],
          select: { organisationId: true }
        })
      ]);
      if (existing) return denied("This organisation is already registered for that beta product.", 409);
      const organisationWithEntitlements = organisation ? {
        ...organisation,
        entitlements: resolveEntitlements(organisation.subscription)
      } : null;
      const decision = betaParticipantDecision({
        programme,
        organisation: organisationWithEntitlements,
        product: participantInput.product,
        activeCount: admittedOrganisations.length
      });
      if (!decision.ok) return denied(decision.error, decision.status);
      const participant = await prisma.$transaction(async (tx) => {
        const created = await tx.betaParticipant.create({ data: {
          ...participantInput,
          admittedByUserId: access.user.id
        } });
        await tx.auditLog.create({ data: {
          organisationId: participantInput.organisationId,
          actorUserId: access.user.id,
          action: "BETA_PARTICIPANT_ADMITTED",
          entityType: "BetaParticipant",
          entityId: created.id,
          details: { programmeId: participantInput.programmeId, product: participantInput.product, billingChanged: false, requestId }
        } });
        return created;
      });
      return NextResponse.json({ ok: true, participant }, { status: 201 });
    }

    if (input.action === "SET_PARTICIPANT_STATUS") {
      const existing = await prisma.betaParticipant.findUnique({ where: { id: input.participantId } });
      if (!existing) return denied("Beta participant not found.", 404);
      try { assertBetaTransition("participant", existing.status, input.status); } catch (error) { return denied(error.message, 409); }
      const participant = await prisma.$transaction(async (tx) => {
        const updated = await tx.betaParticipant.update({ where: { id: existing.id }, data: { status: input.status } });
        await tx.auditLog.create({ data: {
          organisationId: existing.organisationId,
          actorUserId: access.user.id,
          action: "BETA_PARTICIPANT_STATUS_CHANGED",
          entityType: "BetaParticipant",
          entityId: existing.id,
          details: { programmeId: existing.programmeId, product: existing.product, fromStatus: existing.status, toStatus: updated.status, billingChanged: false, requestId }
        } });
        return updated;
      });
      return NextResponse.json({ ok: true, participant });
    }

    const existing = await prisma.betaFeedback.findUnique({ where: { id: input.feedbackId } });
    if (!existing) return denied("Beta feedback not found.", 404);
    try { assertBetaTransition("feedback", existing.status, input.status); } catch (error) { return denied(error.message, 409); }
    const adminResponse = input.adminResponse?.trim() || null;
    if (["RESOLVED", "CLOSED"].includes(input.status) && !adminResponse) {
      return denied("Add a response before resolving or closing beta feedback.");
    }
    const feedback = await prisma.$transaction(async (tx) => {
      const updated = await tx.betaFeedback.update({ where: { id: existing.id }, data: {
        status: input.status,
        adminResponse,
        triagedByUserId: access.user.id,
        resolvedAt: ["RESOLVED", "CLOSED"].includes(input.status) ? (existing.resolvedAt || new Date()) : null
      } });
      await tx.auditLog.create({ data: {
        organisationId: existing.organisationId,
        actorUserId: access.user.id,
        action: "BETA_FEEDBACK_TRIAGED",
        entityType: "BetaFeedback",
        entityId: existing.id,
        details: { programmeId: existing.programmeId, product: existing.product, fromStatus: existing.status, toStatus: updated.status, severity: existing.severity, requestId }
      } });
      return updated;
    });
    return NextResponse.json({ ok: true, feedback });
  } catch (error) {
    console.error("Beta operations error:", error);
    return denied("Unable to complete the beta operation.", 500);
  }
}
