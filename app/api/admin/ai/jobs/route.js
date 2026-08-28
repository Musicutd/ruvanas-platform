import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getRequestId } from "@/lib/security-log";
import {
  aiArtifactProvenance,
  assertProviderDataPolicy,
  generateGovernedDraft,
  normalizeAssistantRequest
} from "@/lib/ai-governance.mjs";

const schema = z.object({
  organisationId: z.string().min(1),
  assistantType: z.enum(["PROMO_SCRIPT", "SCHEDULE_RULES", "ANALYTICS_SUMMARY", "SCHOOL_SCRIPT", "SCHOOL_SHOW_PLAN", "SCHOOL_PRONUNCIATION"]),
  dataClassification: z.enum(["INTERNAL", "CUSTOMER_CONTENT", "SCHOOL_CONTENT", "SCHOOL_STUDENT_DATA"]),
  title: z.string(),
  audience: z.string(),
  brief: z.string(),
  callToAction: z.string().optional(),
  tone: z.string().optional(),
  durationSeconds: z.coerce.number()
});

async function requireSuperAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access;
  if (access.user.role !== "SUPER_ADMIN") return { ok: false, status: 403, error: "Only a Ruvanas Super Admin can create governed assistant drafts." };
  return access;
}

export async function POST(request) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid assistant request." }, { status: 400 });

    const organisation = await prisma.organisation.findUnique({ where: { id: parsed.data.organisationId }, select: { id: true } });
    if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });

    const normalized = normalizeAssistantRequest(parsed.data);
    const providerKey = "RUVANAS_TEMPLATE_V1";
    const sharing = assertProviderDataPolicy({ providerKey, dataClassification: normalized.dataClassification });
    const draftText = generateGovernedDraft(normalized);
    const provenance = aiArtifactProvenance({ assistantType: normalized.assistantType, dataClassification: normalized.dataClassification, providerKey });
    const operationRequestId = getRequestId(request);

    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.aIJob.create({
        data: {
          organisationId: parsed.data.organisationId,
          requestedByUserId: access.user.id,
          assistantType: normalized.assistantType,
          dataClassification: normalized.dataClassification,
          providerKey,
          providerDataUseApproved: sharing.providerDataUseApproved,
          privateDataSent: sharing.privateDataSent,
          input: normalized,
          draftText,
          metadata: { create: { providerKey, modelKey: "governed-template-v1", provenance } }
        },
        include: { metadata: true, organisation: { select: { name: true } }, requestedBy: { select: { name: true, email: true } } }
      });
      await tx.auditLog.create({
        data: {
          organisationId: created.organisationId,
          actorUserId: access.user.id,
          action: "AI_DRAFT_CREATED",
          entityType: "AIJob",
          entityId: created.id,
          details: { assistantType: created.assistantType, dataClassification: created.dataClassification, providerKey, privateDataSent: false, autoPublishAllowed: false, requestId: operationRequestId }
        }
      });
      return created;
    });

    return NextResponse.json({ job, notice: "Draft created for human review. It has not been published or scheduled." }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /required|characters|Duration|provider|student data|classification|assistant type/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("AI draft creation error:", error);
    return NextResponse.json({ error: "Unable to create the governed assistant draft." }, { status: 500 });
  }
}

