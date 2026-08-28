import { prisma } from "@/lib/prisma";
import {
  buildBillingUsageSnapshot,
  compareBillingUsage,
  hashBillingPayload,
  mapProviderSubscriptionStatus
} from "@/lib/billing-reconciliation.mjs";

const INVOICE_STATUSES = new Set([
  "DRAFT",
  "OPEN",
  "PAID",
  "VOID",
  "UNCOLLECTIBLE"
]);

function optionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function integer(value) {
  const result = Number(value || 0);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

export async function reconcileOrganisationBillingUsage({
  organisationId,
  periodStart,
  periodEnd,
  providerUsage,
  actorUserId
}) {
  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    include: {
      subscription: { include: { plan: true } },
      billingAccount: true
    }
  });

  if (!organisation) throw new Error("ORGANISATION_NOT_FOUND");
  if (!organisation.subscription) throw new Error("SUBSCRIPTION_REQUIRED");

  const [locationCount, zoneCount, stationCount, storage] = await Promise.all([
    prisma.location.count({ where: { organisationId } }),
    prisma.zone.count({ where: { location: { organisationId } } }),
    prisma.station.count({ where: { organisationId } }),
    prisma.mediaAsset.aggregate({
      where: { organisationId },
      _sum: { sizeBytes: true }
    })
  ]);

  const snapshot = buildBillingUsageSnapshot({
    locationCount,
    zoneCount,
    stationCount,
    storageBytes: storage._sum.sizeBytes || 0n,
    schoolRadioEnabled: Boolean(
      organisation.subscription.schoolRadioEnabled ??
      organisation.subscription.plan.schoolRadioEnabled
    )
  });
  const comparison = compareBillingUsage(snapshot, providerUsage);

  return prisma.$transaction(async (tx) => {
    const reconciliation = await tx.billingUsageReconciliation.upsert({
      where: {
        organisationId_periodStart_periodEnd: {
          organisationId,
          periodStart,
          periodEnd
        }
      },
      create: {
        organisationId,
        subscriptionId: organisation.subscription.id,
        billingAccountId: organisation.billingAccount?.id || null,
        periodStart,
        periodEnd,
        locationCount: snapshot.locationCount,
        zoneCount: snapshot.zoneCount,
        stationCount: snapshot.stationCount,
        storageBytes: BigInt(snapshot.storageBytes),
        schoolRadioEnabled: snapshot.schoolRadioEnabled,
        providerUsage: providerUsage || undefined,
        discrepancies: comparison.discrepancies,
        status: comparison.status
      },
      update: {
        billingAccountId: organisation.billingAccount?.id || null,
        locationCount: snapshot.locationCount,
        zoneCount: snapshot.zoneCount,
        stationCount: snapshot.stationCount,
        storageBytes: BigInt(snapshot.storageBytes),
        schoolRadioEnabled: snapshot.schoolRadioEnabled,
        providerUsage: providerUsage || undefined,
        discrepancies: comparison.discrepancies,
        status: comparison.status,
        resolvedAt: null
      }
    });

    await tx.auditLog.create({
      data: {
        organisationId,
        actorUserId,
        action: "BILLING_USAGE_RECONCILED",
        entityType: "BillingUsageReconciliation",
        entityId: reconciliation.id,
        details: {
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          status: comparison.status,
          discrepancies: comparison.discrepancies
        }
      }
    });

    return { reconciliation, snapshot, comparison };
  });
}

export async function processGenericBillingWebhook({ eventId, rawBody, event }) {
  const provider = "GENERIC_HMAC";
  const payloadSha256 = hashBillingPayload(rawBody);
  const existing = await prisma.billingWebhookEvent.findUnique({
    where: { provider_externalEventId: { provider, externalEventId: eventId } }
  });
  if (existing) return { duplicate: true, status: existing.status };

  const eventType = String(event?.type || "unknown");
  const data = event?.data && typeof event.data === "object" ? event.data : {};

  let webhook;
  try {
    webhook = await prisma.billingWebhookEvent.create({
      data: {
        provider,
        externalEventId: eventId,
        eventType,
        payloadSha256,
        signatureVerified: true
      }
    });
  } catch (error) {
    if (error?.code === "P2002") return { duplicate: true, status: "RECEIVED" };
    throw error;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const organisationId = String(data.organisationId || "").trim();
      const subscription = organisationId
        ? await tx.subscription.findUnique({ where: { organisationId } })
        : null;

      if (!subscription) {
        await tx.billingWebhookEvent.update({
          where: { id: webhook.id },
          data: { status: "IGNORED", processedAt: new Date() }
        });
        return { duplicate: false, status: "IGNORED" };
      }

      const billingAccount = await tx.billingAccount.upsert({
        where: { organisationId },
        create: {
          organisationId,
          provider,
          externalCustomerId: data.customerId || null
        },
        update: {
          provider,
          externalCustomerId: data.customerId || undefined,
          active: true
        }
      });

      if (eventType === "subscription.updated") {
        const subscriptionStatus = mapProviderSubscriptionStatus(data.status);
        await tx.billingContract.upsert({
          where: { subscriptionId: subscription.id },
          create: {
            billingAccountId: billingAccount.id,
            subscriptionId: subscription.id,
            externalSubscriptionId: data.subscriptionId || null,
            providerStatus: data.status || null,
            currentPeriodStart: optionalDate(data.currentPeriodStart),
            currentPeriodEnd: optionalDate(data.currentPeriodEnd),
            graceEndsAt: optionalDate(data.graceEndsAt),
            cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
            lastReconciledAt: new Date()
          },
          update: {
            externalSubscriptionId: data.subscriptionId || undefined,
            providerStatus: data.status || null,
            currentPeriodStart: optionalDate(data.currentPeriodStart),
            currentPeriodEnd: optionalDate(data.currentPeriodEnd),
            graceEndsAt: optionalDate(data.graceEndsAt),
            cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
            lastReconciledAt: new Date()
          }
        });
        if (subscriptionStatus) {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: subscriptionStatus,
              currentPeriodEnd: optionalDate(data.currentPeriodEnd)
            }
          });
        }
      } else if (eventType === "invoice.updated" && data.invoiceId) {
        const suppliedStatus = String(data.status || "").toUpperCase();
        const status = INVOICE_STATUSES.has(suppliedStatus)
          ? suppliedStatus
          : "DRAFT";
        await tx.billingInvoice.upsert({
          where: {
            billingAccountId_externalInvoiceId: {
              billingAccountId: billingAccount.id,
              externalInvoiceId: String(data.invoiceId)
            }
          },
          create: {
            organisationId,
            billingAccountId: billingAccount.id,
            subscriptionId: subscription.id,
            externalInvoiceId: String(data.invoiceId),
            status,
            currency: String(data.currency || "EUR").toUpperCase(),
            amountDueCents: integer(data.amountDueCents),
            amountPaidCents: integer(data.amountPaidCents),
            periodStart: optionalDate(data.periodStart),
            periodEnd: optionalDate(data.periodEnd),
            dueAt: optionalDate(data.dueAt),
            paidAt: optionalDate(data.paidAt)
          },
          update: {
            status,
            amountDueCents: integer(data.amountDueCents),
            amountPaidCents: integer(data.amountPaidCents),
            dueAt: optionalDate(data.dueAt),
            paidAt: optionalDate(data.paidAt)
          }
        });
      } else {
        await tx.billingWebhookEvent.update({
          where: { id: webhook.id },
          data: { status: "IGNORED", processedAt: new Date() }
        });
        return { duplicate: false, status: "IGNORED" };
      }

      await tx.billingWebhookEvent.update({
        where: { id: webhook.id },
        data: { status: "PROCESSED", processedAt: new Date() }
      });
      return { duplicate: false, status: "PROCESSED" };
    });
  } catch (error) {
    await prisma.billingWebhookEvent.update({
      where: { id: webhook.id },
      data: {
        status: "FAILED",
        errorMessage: "Provider event processing failed.",
        processedAt: new Date()
      }
    }).catch(() => null);
    throw error;
  }
}

