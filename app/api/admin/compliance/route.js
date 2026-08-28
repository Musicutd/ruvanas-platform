import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getRequestId } from "@/lib/security-log";
import {
  dataRequestCompletion,
  generateOperationalReference,
  normalizeDataRequest,
  normalizeRetentionPolicy
} from "@/lib/compliance-operations.mjs";
import {
  auditExportDownloadUrl,
  createAuditExport,
  createRetentionPreview
} from "@/lib/compliance-service";

const common = z.object({ action: z.string(), organisationId: z.string().min(1) });
const retentionSchema = common.extend({
  action: z.literal("UPDATE_RETENTION"),
  rawPlaybackDays: z.coerce.number(),
  playerHeartbeatDays: z.coerce.number(),
  audioProjectDays: z.coerce.number(),
  supportTicketDays: z.coerce.number(),
  auditDays: z.coerce.number()
});
const previewSchema = common.extend({ action: z.literal("PREVIEW_RETENTION") });
const policySchema = common.extend({
  action: z.literal("RECORD_POLICY_ACCEPTANCE"),
  key: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().min(2).max(160),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  evidenceReference: z.string().trim().min(3).max(4_000).optional()
});
const createDataSchema = common.extend({
  action: z.literal("CREATE_DATA_REQUEST"),
  type: z.enum(["EXPORT", "CORRECTION", "DELETION", "RESTRICTION"]),
  subjectUserId: z.string().min(1).nullable().optional(),
  subjectEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional()
});
const updateDataSchema = z.object({
  action: z.literal("UPDATE_DATA_REQUEST"),
  requestId: z.string().min(1),
  status: z.enum(["OPEN", "IN_REVIEW", "AWAITING_INFORMATION", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED"]),
  notes: z.string().trim().max(4_000).nullable().optional()
});
const auditSchema = common.extend({
  action: z.literal("CREATE_AUDIT_EXPORT"),
  fromAt: z.string().datetime().optional(),
  untilAt: z.string().datetime().optional()
});
const schema = z.discriminatedUnion("action", [retentionSchema, previewSchema, policySchema, createDataSchema, updateDataSchema, auditSchema]);

async function requireSuperAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return access;
  if (access.user.role !== "SUPER_ADMIN") return { ok: false, status: 403, error: "Only a Ruvanas Super Admin can manage compliance operations." };
  return access;
}

export async function POST(request) {
  try {
    const access = await requireSuperAdmin();
    if (!access.ok) return accessDenied(access);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid compliance operation." }, { status: 400 });
    const input = parsed.data;
    const operationRequestId = getRequestId(request);

    if ("organisationId" in input) {
      const organisation = await prisma.organisation.findUnique({ where: { id: input.organisationId }, select: { id: true } });
      if (!organisation) return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    }

    if (input.action === "UPDATE_RETENTION") {
      const policy = normalizeRetentionPolicy(input);
      const result = await prisma.$transaction(async (tx) => {
        const saved = await tx.retentionPolicy.upsert({
          where: { organisationId: input.organisationId },
          create: { organisationId: input.organisationId, ...policy, reviewedByUserId: access.user.id, reviewedAt: new Date() },
          update: { ...policy, reviewedByUserId: access.user.id, reviewedAt: new Date() }
        });
        await tx.auditLog.create({ data: { organisationId: input.organisationId, actorUserId: access.user.id, action: "RETENTION_POLICY_UPDATED", entityType: "RetentionPolicy", entityId: saved.id, details: { policy, requestId: operationRequestId } } });
        return saved;
      });
      return NextResponse.json({ ok: true, policy: result });
    }

    if (input.action === "PREVIEW_RETENTION") {
      const policy = await prisma.retentionPolicy.findUnique({ where: { organisationId: input.organisationId } });
      const job = await createRetentionPreview({ organisationId: input.organisationId, requestedByUserId: access.user.id, policy: policy || {}, requestId: operationRequestId });
      return NextResponse.json({ ok: true, job, notice: "Preview complete. No records were deleted." }, { status: 201 });
    }

    if (input.action === "RECORD_POLICY_ACCEPTANCE") {
      if (!input.contentSha256 && !input.evidenceReference) return NextResponse.json({ error: "Provide a policy document reference or SHA-256 evidence." }, { status: 400 });
      const contentSha256 = (input.contentSha256 || crypto.createHash("sha256").update(input.evidenceReference).digest("hex")).toLowerCase();
      const acceptance = await prisma.$transaction(async (tx) => {
        const policy = await tx.compliancePolicy.upsert({
          where: { key_version: { key: input.key, version: input.version } },
          create: { key: input.key, version: input.version, title: input.title, contentSha256, effectiveAt: new Date(), createdByUserId: access.user.id },
          update: { title: input.title, active: true }
        });
        if (policy.contentSha256 !== contentSha256) throw new Error("POLICY_HASH_MISMATCH");
        const saved = await tx.policyAcceptance.upsert({
          where: { organisationId_policyId_acceptedByUserId: { organisationId: input.organisationId, policyId: policy.id, acceptedByUserId: access.user.id } },
          create: { organisationId: input.organisationId, policyId: policy.id, acceptedByUserId: access.user.id, evidence: { recordedByRole: access.user.role, requestId: operationRequestId } },
          update: { acceptedAt: new Date(), evidence: { recordedByRole: access.user.role, requestId: operationRequestId } },
          include: { policy: true }
        });
        await tx.auditLog.create({ data: { organisationId: input.organisationId, actorUserId: access.user.id, action: "POLICY_ACCEPTANCE_RECORDED", entityType: "PolicyAcceptance", entityId: saved.id, details: { policyKey: policy.key, policyVersion: policy.version, contentSha256: policy.contentSha256, requestId: operationRequestId } } });
        return saved;
      });
      return NextResponse.json({ ok: true, acceptance }, { status: 201 });
    }

    if (input.action === "CREATE_DATA_REQUEST") {
      const normalized = normalizeDataRequest(input);
      if (normalized.subjectUserId) {
        const subject = await prisma.organisationMember.findUnique({
          where: { userId_organisationId: { userId: normalized.subjectUserId, organisationId: input.organisationId } },
          select: { userId: true }
        });
        if (!subject) return NextResponse.json({ error: "Subject user not found in this organisation." }, { status: 404 });
      }
      const dataRequest = await prisma.$transaction(async (tx) => {
        const created = await tx.dataRequest.create({ data: { organisationId: input.organisationId, requestedByUserId: access.user.id, reference: generateOperationalReference("DR"), ...normalized } });
        await tx.auditLog.create({ data: { organisationId: input.organisationId, actorUserId: access.user.id, action: "DATA_REQUEST_CREATED", entityType: "DataRequest", entityId: created.id, details: { reference: created.reference, type: created.type, dueAt: created.dueAt, requestId: operationRequestId } } });
        return created;
      });
      return NextResponse.json({ ok: true, dataRequest }, { status: 201 });
    }

    if (input.action === "UPDATE_DATA_REQUEST") {
      const existing = await prisma.dataRequest.findUnique({ where: { id: input.requestId } });
      if (!existing) return NextResponse.json({ error: "Data request not found." }, { status: 404 });
      const completion = dataRequestCompletion(input.status, access.user.id);
      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.dataRequest.update({ where: { id: existing.id }, data: { status: input.status, ...(input.notes !== undefined ? { notes: input.notes || null } : {}), ...completion } });
        await tx.auditLog.create({ data: { organisationId: existing.organisationId, actorUserId: access.user.id, action: "DATA_REQUEST_STATUS_CHANGED", entityType: "DataRequest", entityId: existing.id, details: { from: existing.status, to: input.status, requestId: operationRequestId } } });
        return saved;
      });
      return NextResponse.json({ ok: true, dataRequest: updated });
    }

    const job = await createAuditExport({ organisationId: input.organisationId, requestedByUserId: access.user.id, window: input, requestId: operationRequestId });
    return NextResponse.json({ ok: true, job, downloadUrl: job?.status === "READY" ? auditExportDownloadUrl(job) : null }, { status: 201 });
  } catch (error) {
    if (error?.message === "POLICY_HASH_MISMATCH") return NextResponse.json({ error: "This policy version already exists with different content evidence. Create a new version instead." }, { status: 409 });
    if (error instanceof Error && /must|Select|Provide|limited|earlier/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Compliance operation error:", error);
    return NextResponse.json({ error: "Unable to complete the compliance operation." }, { status: 500 });
  }
}

