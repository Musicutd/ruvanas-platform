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

const CORRECTIONS_EVIDENCE_WHERE = [
  { correctionsProfile: { isNot: null } },
  { locations: { some: { correctionsFacility: { isNot: null } } } },
  { stations: { some: { productFamily: "CORRECTIONS" } } },
  { channels: { some: { musicRightsUse: "CORRECTIONS_RADIO" } } },
  { autoDjPolicies: { some: { rightsUse: "CORRECTIONS_RADIO" } } },
  { smartPlaylists: { some: { rightsUse: "CORRECTIONS_RADIO" } } },
  { generatedPlaylists: { some: { rightsUse: "CORRECTIONS_RADIO" } } },
  { rightsUsageLedgerEvents: { some: { rightsUse: "CORRECTIONS_RADIO" } } },
  { playoutIntents: { some: { OR: [
    { correctionsRequestId: { not: null } },
    { correctionsRehabContentId: { not: null } },
    { correctionsProgrammeId: { not: null } },
    { correctionsSubmissionId: { not: null } },
    { correctionsTrackId: { not: null } },
    { correctionsAnnouncementId: { not: null } },
    { correctionsOverrideId: { not: null } }
  ] } } },
  { correctionsProgrammes: { some: {} } },
  { correctionsFacilityGrants: { some: {} } },
  { correctionsContributors: { some: {} } },
  { correctionsStudioSessions: { some: {} } },
  { correctionsRequests: { some: {} } },
  { correctionsRehabCategories: { some: {} } },
  { correctionsRehabContent: { some: {} } },
  { correctionsDevelopmentModules: { some: {} } },
  { correctionsAnnouncements: { some: {} } },
  { correctionsOverrides: { some: {} } },
  { correctionsNetworkGrants: { some: {} } },
  { correctionsNetworkWindows: { some: {} } },
  { correctionsDistributions: { some: {} } },
  { correctionsNetworkAudioDistributions: { some: {} } },
  { correctionsSyndicationOffers: { some: {} } },
  { proofOfPlayEvents: { some: { programmingSource: { startsWith: "CORRECTIONS_" } } } },
  { proofOfPlayEvents: { some: { itemType: "CORRECTIONS_AUDIO" } } },
  { auditLogs: { some: { action: { startsWith: "CORRECTIONS_" } } } }
];

function hasCorrectionsEntitlement(subscription) {
  return subscription?.plan?.productFamily === "CORRECTIONS"
    || subscription?.plan?.correctionsRadioEnabled === true
    || subscription?.correctionsRadioEnabled === true
    || subscription?.complimentaryPlanProductFamily === "CORRECTIONS"
    || subscription?.complimentaryCorrectionsRadioEnabled === true;
}

async function assertNoCorrectionsEvidence(tx, organisation) {
  let evidence = hasCorrectionsEntitlement(organisation.subscription)
    || await tx.organisation.findFirst({
      where: { id: organisation.id, OR: CORRECTIONS_EVIDENCE_WHERE },
      select: { id: true }
    });
  if (!evidence) {
    // These Studio records store organisationId without an Organisation relation.
    evidence = await tx.studioPlayoutSession.findFirst({
      where: { organisationId: organisation.id, productFamily: "CORRECTIONS" },
      select: { id: true }
    }) || await tx.studioProgrammePack.findFirst({
      where: { organisationId: organisation.id, productFamily: "CORRECTIONS" },
      select: { id: true }
    });
  }
  if (evidence) {
    throw new TrialOrganisationDeletionError(
      "CORRECTIONS_EVIDENCE_PRESENT",
      "This organisation has Corrections access or evidence and cannot be deleted through the trial cleanup flow."
    );
  }
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
    // Lock the parent and current subscription before checking eligibility.
    // New Organisation dependents and subscription entitlement changes must
    // wait until this decision ends.
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "organisationId" = ${organisationId} FOR UPDATE`;
    const organisation = await tx.organisation.findUnique({
      where: { id: organisationId },
      select: {
        id: true,
        name: true,
        slug: true,
        subscription: { select: {
          status: true,
          correctionsRadioEnabled: true,
          complimentaryCorrectionsRadioEnabled: true,
          complimentaryPlanProductFamily: true,
          plan: { select: { productFamily: true, correctionsRadioEnabled: true } }
        } },
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

    await assertNoCorrectionsEvidence(tx, organisation);

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
  }, { isolationLevel: "ReadCommitted", timeout: 30000 });
}
