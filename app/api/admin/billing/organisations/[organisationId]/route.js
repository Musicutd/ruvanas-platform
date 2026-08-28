import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

const nullableDate = z.union([z.string().datetime(), z.null()]).optional();
const updateSchema = z.object({
  provider: z.enum(["MANUAL", "GENERIC_HMAC"]),
  externalCustomerId: z.string().trim().max(191).nullable().optional(),
  externalSubscriptionId: z.string().trim().max(191).nullable().optional(),
  providerStatus: z.string().trim().max(80).nullable().optional(),
  subscriptionStatus: z.enum([
    "TRIAL",
    "ACTIVE",
    "PAST_DUE",
    "CANCELLED",
    "SUSPENDED"
  ]).optional(),
  currentPeriodStart: nullableDate,
  currentPeriodEnd: nullableDate,
  graceEndsAt: nullableDate,
  cancelAtPeriodEnd: z.boolean().optional()
});

function toDate(value) {
  return value ? new Date(value) : null;
}

export async function GET(_request, { params }) {
  const access = await requirePlatformAdmin();
  if (!access.ok) return accessDenied(access);

  const organisation = await prisma.organisation.findUnique({
    where: { id: String(params.organisationId || "") },
    include: {
      subscription: { include: { plan: true, billingContract: true } },
      billingAccount: {
        include: {
          invoices: { orderBy: { createdAt: "desc" }, take: 20 },
          reconciliations: { orderBy: { createdAt: "desc" }, take: 20 }
        }
      }
    }
  });
  if (!organisation) {
    return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
  }
  return NextResponse.json({
    organisation: {
      ...organisation,
      billingAccount: organisation.billingAccount ? {
        ...organisation.billingAccount,
        reconciliations: organisation.billingAccount.reconciliations.map((item) => ({
          ...item,
          storageBytes: item.storageBytes.toString()
        }))
      } : null
    }
  });
}

export async function PATCH(request, { params }) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only a Ruvanas Super Admin can change billing controls." },
        { status: 403 }
      );
    }

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid billing details." },
        { status: 400 }
      );
    }

    const organisationId = String(params.organisationId || "");
    const organisation = await prisma.organisation.findUnique({
      where: { id: organisationId },
      include: { subscription: true }
    });
    if (!organisation) {
      return NextResponse.json({ error: "Organisation not found." }, { status: 404 });
    }
    if (!organisation.subscription) {
      return NextResponse.json(
        { error: "Add a subscription before configuring billing." },
        { status: 409 }
      );
    }

    const data = parsed.data;
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.billingAccount.upsert({
        where: { organisationId },
        create: {
          organisationId,
          provider: data.provider,
          externalCustomerId: data.externalCustomerId || null
        },
        update: {
          provider: data.provider,
          externalCustomerId: data.externalCustomerId === undefined
            ? undefined : data.externalCustomerId,
          active: true
        }
      });
      const contract = await tx.billingContract.upsert({
        where: { subscriptionId: organisation.subscription.id },
        create: {
          billingAccountId: account.id,
          subscriptionId: organisation.subscription.id,
          externalSubscriptionId: data.externalSubscriptionId || null,
          providerStatus: data.providerStatus || null,
          currentPeriodStart: toDate(data.currentPeriodStart),
          currentPeriodEnd: toDate(data.currentPeriodEnd),
          graceEndsAt: toDate(data.graceEndsAt),
          cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
          lastReconciledAt: new Date()
        },
        update: {
          externalSubscriptionId: data.externalSubscriptionId === undefined
            ? undefined : data.externalSubscriptionId,
          providerStatus: data.providerStatus === undefined
            ? undefined : data.providerStatus,
          currentPeriodStart: data.currentPeriodStart === undefined
            ? undefined : toDate(data.currentPeriodStart),
          currentPeriodEnd: data.currentPeriodEnd === undefined
            ? undefined : toDate(data.currentPeriodEnd),
          graceEndsAt: data.graceEndsAt === undefined
            ? undefined : toDate(data.graceEndsAt),
          cancelAtPeriodEnd: data.cancelAtPeriodEnd,
          lastReconciledAt: new Date()
        }
      });
      if (data.subscriptionStatus) {
        await tx.subscription.update({
          where: { id: organisation.subscription.id },
          data: { status: data.subscriptionStatus }
        });
      }
      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: access.user.id,
          action: "BILLING_CONFIGURATION_UPDATED",
          entityType: "BillingContract",
          entityId: contract.id,
          details: {
            provider: data.provider,
            subscriptionStatus: data.subscriptionStatus || organisation.subscription.status,
            graceEndsAt: data.graceEndsAt ?? null
          }
        }
      });
      return { account, contract };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Billing configuration error:", error);
    return NextResponse.json(
      { error: "Unable to update billing controls." },
      { status: 500 }
    );
  }
}

