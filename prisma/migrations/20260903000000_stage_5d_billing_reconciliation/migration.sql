CREATE TYPE "BillingProvider" AS ENUM ('MANUAL', 'GENERIC_HMAC');
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');
CREATE TYPE "BillingWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');
CREATE TYPE "BillingReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'MISMATCHED', 'RESOLVED');

CREATE TABLE "BillingAccount" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'MANUAL',
    "externalCustomerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingContract" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "externalSubscriptionId" TEXT,
    "providerStatus" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "externalInvoiceId" TEXT,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "amountDueCents" INTEGER NOT NULL DEFAULT 0,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "BillingWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingUsageReconciliation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "billingAccountId" TEXT,
    "invoiceId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "locationCount" INTEGER NOT NULL,
    "zoneCount" INTEGER NOT NULL,
    "stationCount" INTEGER NOT NULL,
    "storageBytes" BIGINT NOT NULL,
    "schoolRadioEnabled" BOOLEAN NOT NULL,
    "providerUsage" JSONB,
    "discrepancies" JSONB,
    "status" "BillingReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingUsageReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingAccount_organisationId_key" ON "BillingAccount"("organisationId");
CREATE UNIQUE INDEX "BillingAccount_provider_externalCustomerId_key" ON "BillingAccount"("provider", "externalCustomerId");
CREATE INDEX "BillingAccount_provider_active_idx" ON "BillingAccount"("provider", "active");
CREATE UNIQUE INDEX "BillingContract_billingAccountId_key" ON "BillingContract"("billingAccountId");
CREATE UNIQUE INDEX "BillingContract_subscriptionId_key" ON "BillingContract"("subscriptionId");
CREATE UNIQUE INDEX "BillingContract_billingAccountId_externalSubscriptionId_key" ON "BillingContract"("billingAccountId", "externalSubscriptionId");
CREATE INDEX "BillingContract_providerStatus_idx" ON "BillingContract"("providerStatus");
CREATE INDEX "BillingContract_graceEndsAt_idx" ON "BillingContract"("graceEndsAt");
CREATE UNIQUE INDEX "BillingInvoice_billingAccountId_externalInvoiceId_key" ON "BillingInvoice"("billingAccountId", "externalInvoiceId");
CREATE INDEX "BillingInvoice_organisationId_status_idx" ON "BillingInvoice"("organisationId", "status");
CREATE INDEX "BillingInvoice_subscriptionId_idx" ON "BillingInvoice"("subscriptionId");
CREATE INDEX "BillingInvoice_periodStart_periodEnd_idx" ON "BillingInvoice"("periodStart", "periodEnd");
CREATE UNIQUE INDEX "BillingWebhookEvent_provider_externalEventId_key" ON "BillingWebhookEvent"("provider", "externalEventId");
CREATE INDEX "BillingWebhookEvent_status_receivedAt_idx" ON "BillingWebhookEvent"("status", "receivedAt");
CREATE UNIQUE INDEX "BillingUsageReconciliation_organisationId_periodStart_periodEnd_key" ON "BillingUsageReconciliation"("organisationId", "periodStart", "periodEnd");
CREATE INDEX "BillingUsageReconciliation_status_createdAt_idx" ON "BillingUsageReconciliation"("status", "createdAt");
CREATE INDEX "BillingUsageReconciliation_subscriptionId_idx" ON "BillingUsageReconciliation"("subscriptionId");
CREATE INDEX "BillingUsageReconciliation_billingAccountId_idx" ON "BillingUsageReconciliation"("billingAccountId");
CREATE INDEX "BillingUsageReconciliation_invoiceId_idx" ON "BillingUsageReconciliation"("invoiceId");

ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingContract" ADD CONSTRAINT "BillingContract_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingContract" ADD CONSTRAINT "BillingContract_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingUsageReconciliation" ADD CONSTRAINT "BillingUsageReconciliation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingUsageReconciliation" ADD CONSTRAINT "BillingUsageReconciliation_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingUsageReconciliation" ADD CONSTRAINT "BillingUsageReconciliation_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingUsageReconciliation" ADD CONSTRAINT "BillingUsageReconciliation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "BillingInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

