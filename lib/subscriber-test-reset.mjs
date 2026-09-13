export const SUBSCRIBER_TEST_RESET_CONFIRMATION = "DELETE TEST SUBSCRIBERS";
const SUBSCRIBER_TEST_RESET_TRANSACTION = Object.freeze({ maxWait: 10_000, timeout: 120_000 });

export class SubscriberTestResetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SubscriberTestResetError";
    this.code = code;
  }
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateSubscriberTestReset({ actor, retainedEmail, confirmation, requireConfirmation = true }) {
  const email = normalizedEmail(retainedEmail);
  if (!actor || actor.role !== "SUPER_ADMIN") {
    throw new SubscriberTestResetError("SUPER_ADMIN_REQUIRED", "Only a Ruvanas Super Admin can reset subscriber test data.");
  }
  if (!email || normalizedEmail(actor.email) !== email) {
    throw new SubscriberTestResetError("RETAINED_ACCOUNT_MISMATCH", "The retained account must be the signed-in Super Admin.");
  }
  if (requireConfirmation && confirmation !== SUBSCRIBER_TEST_RESET_CONFIRMATION) {
    throw new SubscriberTestResetError("CONFIRMATION_REQUIRED", `Enter ${SUBSCRIBER_TEST_RESET_CONFIRMATION} exactly.`);
  }
  return email;
}

async function findRetainedUser(database, email) {
  const retainedUser = await database.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true }
  });
  if (!retainedUser || retainedUser.role !== "SUPER_ADMIN") {
    throw new SubscriberTestResetError("RETAINED_ACCOUNT_INVALID", "The retained account is not an active Super Admin.");
  }
  return retainedUser;
}

async function countExternalBillingRecords(database, organisationIds) {
  if (!organisationIds.length) return 0;
  const [invoiceCount, contractCount] = await Promise.all([
    database.billingInvoice.count({
      where: {
        organisationId: { in: organisationIds },
        OR: [{ externalInvoiceId: { not: null } }, { amountPaidCents: { gt: 0 } }]
      }
    }),
    database.billingContract.count({
      where: {
        externalSubscriptionId: { not: null },
        subscription: { organisationId: { in: organisationIds } }
      }
    })
  ]);
  return invoiceCount + contractCount;
}

export async function subscriberTestResetPreview(database, { actor, retainedEmail }) {
  const email = validateSubscriberTestReset({ actor, retainedEmail, requireConfirmation: false });
  const retainedUser = await findRetainedUser(database, email);
  const organisations = await database.organisation.findMany({ select: { id: true } });
  const organisationIds = organisations.map((item) => item.id);
  const [usersToDelete, superAdminsToDelete, codesToDelete, externalBillingRecords] = await Promise.all([
    database.user.count({ where: { id: { not: retainedUser.id } } }),
    database.user.count({ where: { id: { not: retainedUser.id }, role: "SUPER_ADMIN" } }),
    database.complimentaryAccessCode.count(),
    countExternalBillingRecords(database, organisationIds)
  ]);
  return {
    retainedUser,
    usersToDelete,
    superAdminsToDelete,
    organisationsToDelete: organisationIds.length,
    codesToDelete,
    externalBillingRecords
  };
}

function scopedAuditWhere({ organisationIds, userIds, schoolNetworkIds, stationNetworkIds }) {
  const clauses = [];
  if (organisationIds.length) clauses.push({ organisationId: { in: organisationIds } });
  if (userIds.length) clauses.push({ actorUserId: { in: userIds } });
  if (schoolNetworkIds.length) clauses.push({ schoolNetworkId: { in: schoolNetworkIds } });
  if (stationNetworkIds.length) clauses.push({ stationNetworkId: { in: stationNetworkIds } });
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}

export async function resetSubscriberTestData(database, { actor, retainedEmail, confirmation }) {
  const email = validateSubscriberTestReset({ actor, retainedEmail, confirmation });
  return database.$transaction(async (tx) => {
    const retainedUser = await findRetainedUser(tx, email);
    if (retainedUser.id !== actor.id) {
      throw new SubscriberTestResetError("RETAINED_ACCOUNT_MISMATCH", "The retained account must be the signed-in Super Admin.");
    }

    const [targetUsers, organisations, schoolNetworks, stationNetworks] = await Promise.all([
      tx.user.findMany({ where: { id: { not: retainedUser.id } }, select: { id: true } }),
      tx.organisation.findMany({ select: { id: true } }),
      tx.schoolNetwork.findMany({ select: { id: true } }),
      tx.stationNetwork.findMany({ select: { id: true } })
    ]);
    const userIds = targetUsers.map((item) => item.id);
    const organisationIds = organisations.map((item) => item.id);
    const schoolNetworkIds = schoolNetworks.map((item) => item.id);
    const stationNetworkIds = stationNetworks.map((item) => item.id);
    const externalBillingRecords = await countExternalBillingRecords(tx, organisationIds);
    if (externalBillingRecords) {
      throw new SubscriberTestResetError("FINANCIAL_RECORDS_PRESENT", "The reset is blocked because an organisation has external billing records.");
    }
    await tx.recoveryControl.updateMany({
      where: { updatedByUserId: { in: userIds } },
      data: { updatedByUserId: retainedUser.id }
    });
    await tx.recoveryEvidence.updateMany({
      where: { recordedByUserId: { in: userIds } },
      data: { recordedByUserId: retainedUser.id }
    });

    const auditLogs = await tx.auditLog.deleteMany({
      where: scopedAuditWhere({ organisationIds, userIds, schoolNetworkIds, stationNetworkIds })
    });
    const rightsAttestations = await tx.rightsReportAttestation.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const auditExportSeals = await tx.auditExportSeal.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const rightsLedgerEvents = await tx.rightsUsageLedgerEvent.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const syndicationAgreements = await tx.radioSyndicationAgreement.deleteMany({});
    const syndicationOffers = await tx.radioSyndicationOffer.deleteMany({});
    const stationNetworkAgreements = await tx.stationNetworkAgreement.deleteMany({});
    const deletedStationNetworks = await tx.stationNetwork.deleteMany({});
    const deletedSchoolNetworks = await tx.schoolNetwork.deleteMany({});
    const studioBroadcastCommands = await tx.studioBroadcastCommand.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const studioBroadcastSessions = await tx.studioBroadcastSession.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const studioBroadcastDestinations = await tx.studioBroadcastDestination.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const studioPlayoutSessions = await tx.studioPlayoutSession.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const studioProgrammePacks = await tx.studioProgrammePack.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const supportTickets = await tx.supportTicket.deleteMany({
      where: {
        OR: [
          { organisationId: { in: organisationIds } },
          { createdByUserId: { in: userIds } }
        ]
      }
    });
    const betaProgrammeReviews = await tx.betaProgrammeReview.deleteMany({ where: { reviewedByUserId: { in: userIds } } });
    const betaProgrammes = await tx.betaProgramme.deleteMany({ where: { createdByUserId: { in: userIds } } });
    const accessCodes = await tx.complimentaryAccessCode.deleteMany({});
    const deletedOrganisations = await tx.organisation.deleteMany({});
    const deletedUsers = await tx.user.deleteMany({ where: { id: { not: retainedUser.id } } });
    await tx.auditLog.create({
      data: {
        actorUserId: retainedUser.id,
        action: "SUBSCRIBER_TEST_DATA_RESET",
        entityType: "Platform",
        details: {
          retainedEmail: retainedUser.email,
          deletedUsers: deletedUsers.count,
          deletedOrganisations: deletedOrganisations.count,
          deletedAccessCodes: accessCodes.count
        }
      }
    });

    return {
      retainedUser,
      deletedUsers: deletedUsers.count,
      deletedOrganisations: deletedOrganisations.count,
      deletedAccessCodes: accessCodes.count,
      deletedSchoolNetworks: deletedSchoolNetworks.count,
      deletedStationNetworks: deletedStationNetworks.count,
      deletedRelatedRecords:
        auditLogs.count + rightsAttestations.count + auditExportSeals.count + rightsLedgerEvents.count +
        syndicationAgreements.count + syndicationOffers.count + stationNetworkAgreements.count +
        studioBroadcastCommands.count + studioBroadcastSessions.count + studioBroadcastDestinations.count +
        studioPlayoutSessions.count + studioProgrammePacks.count + supportTickets.count +
        betaProgrammeReviews.count + betaProgrammes.count
    };
  }, SUBSCRIBER_TEST_RESET_TRANSACTION);
}
