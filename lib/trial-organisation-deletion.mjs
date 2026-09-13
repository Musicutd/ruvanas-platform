export const TRIAL_ORGANISATION_DELETE_PREFIX = "DELETE ";

export class TrialOrganisationDeletionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrialOrganisationDeletionError";
    this.code = code;
  }
}

export function trialOrganisationConfirmation(slug) {
  return `${TRIAL_ORGANISATION_DELETE_PREFIX}${String(slug || "").trim()}`;
}

export function assertTrialOrganisationDeletion({ actor, organisation, confirmation }) {
  if (!actor || actor.role !== "SUPER_ADMIN") {
    throw new TrialOrganisationDeletionError("SUPER_ADMIN_REQUIRED", "Only a Ruvanas Super Admin can delete a trial organisation.");
  }
  if (!organisation) {
    throw new TrialOrganisationDeletionError("ORGANISATION_NOT_FOUND", "The organisation no longer exists.");
  }
  if (organisation.subscription && organisation.subscription.status !== "TRIAL") {
    throw new TrialOrganisationDeletionError("TRIAL_ONLY", "Only trial organisations can be deleted here. Suspend or review paid accounts instead.");
  }
  const required = trialOrganisationConfirmation(organisation.slug);
  if (confirmation !== required) {
    throw new TrialOrganisationDeletionError("CONFIRMATION_REQUIRED", `Enter ${required} exactly.`);
  }
  return required;
}

async function countExternalBillingRecords(database, organisationId) {
  const [invoiceCount, contractCount] = await Promise.all([
    database.billingInvoice.count({
      where: {
        organisationId,
        OR: [{ externalInvoiceId: { not: null } }, { amountPaidCents: { gt: 0 } }]
      }
    }),
    database.billingContract.count({
      where: {
        externalSubscriptionId: { not: null },
        subscription: { organisationId }
      }
    })
  ]);
  return invoiceCount + contractCount;
}

export async function deleteTrialOrganisation(database, { actor, organisationId, confirmation }) {
  return database.$transaction(async (tx) => {
    const organisation = await tx.organisation.findUnique({
      where: { id: organisationId },
      select: {
        id: true,
        name: true,
        slug: true,
        subscription: { select: { status: true } },
        _count: { select: { members: true } }
      }
    });
    assertTrialOrganisationDeletion({ actor, organisation, confirmation });

    const externalBillingRecords = await countExternalBillingRecords(tx, organisation.id);
    if (externalBillingRecords > 0) {
      throw new TrialOrganisationDeletionError(
        "FINANCIAL_RECORDS_PRESENT",
        "This organisation has external billing records and must be reviewed instead of deleted."
      );
    }

    await tx.auditLog.create({
      data: {
        organisationId: organisation.id,
        actorUserId: actor.id,
        action: "TRIAL_ORGANISATION_DELETED",
        entityType: "Organisation",
        entityId: organisation.id,
        details: {
          name: organisation.name,
          slug: organisation.slug,
          subscriptionStatus: organisation.subscription?.status || null,
          memberLinksRemoved: organisation._count.members,
          userAccountsDeleted: 0
        }
      }
    });
    await tx.organisation.delete({ where: { id: organisation.id } });

    return {
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      memberLinksRemoved: organisation._count.members,
      userAccountsDeleted: 0
    };
  });
}
