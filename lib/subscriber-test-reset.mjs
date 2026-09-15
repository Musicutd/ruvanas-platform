import { Prisma } from "@prisma/client";

export const SUBSCRIBER_TEST_RESET_CONFIRMATION = "DELETE TEST SUBSCRIBERS";
const SUBSCRIBER_TEST_RESET_TRANSACTION = Object.freeze({ maxWait: 10_000, timeout: 300_000 });

export class SubscriberTestResetError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "SubscriberTestResetError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function lowerFirst(value) {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function organisationScopedResetModels() {
  const models = Prisma.dmmf.datamodel.models.filter((model) =>
    model.fields.some((field) => field.kind === "scalar" && field.name === "organisationId")
  );
  const modelNames = new Set(models.map((model) => model.name));
  const parentsByModel = new Map(models.map((model) => [
    model.name,
    new Set(model.fields
      .filter((field) =>
        field.kind === "object" &&
        field.relationFromFields?.length &&
        field.type !== model.name &&
        modelNames.has(field.type)
      )
      .map((field) => field.type))
  ]));

  // PromoAsset owns PromoVersion with a cascading delete. Prisma's direct
  // relation graph cannot see that tenant records which restrict deletion of
  // PromoVersion must therefore be removed before their owning PromoAsset.
  // Add that transitive edge so the normal topological ordering remains the
  // single authority for tenant cleanup as new promo consumers are added.
  for (const model of models) {
    const restrictsPromoVersion = model.fields.some((field) =>
      field.kind === "object" &&
      field.type === "PromoVersion" &&
      field.relationFromFields?.length &&
      field.relationOnDelete === "Restrict"
    );
    if (model.name !== "PromoAsset" && restrictsPromoVersion && modelNames.has("PromoAsset")) {
      parentsByModel.get(model.name).add("PromoAsset");
    }
  }
  const incoming = new Map(models.map((model) => [model.name, 0]));
  for (const parents of parentsByModel.values()) {
    for (const parent of parents) incoming.set(parent, incoming.get(parent) + 1);
  }
  const ready = [...modelNames].filter((name) => incoming.get(name) === 0).sort();
  const ordered = [];
  while (ready.length) {
    const name = ready.shift();
    ordered.push(name);
    for (const parent of parentsByModel.get(name)) {
      incoming.set(parent, incoming.get(parent) - 1);
      if (incoming.get(parent) === 0) {
        ready.push(parent);
        ready.sort();
      }
    }
  }
  if (ordered.length !== models.length) {
    throw new Error("Organisation-scoped reset dependency order contains a cycle.");
  }
  return Object.freeze(ordered.map((modelName) => Object.freeze({
    modelName,
    delegate: lowerFirst(modelName)
  })));
}

export const ORGANISATION_SCOPED_RESET_MODELS = organisationScopedResetModels();

function readableModelName(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

async function resetStage(code, description, operation) {
  try {
    return await operation();
  } catch (error) {
    console.error(`Subscriber test-data reset stage ${code} failed:`, error);
    throw new SubscriberTestResetError(
      `RESET_STAGE_${code}`,
      `The reset stopped safely while clearing ${description}. No partial deletion was retained. Reference: ${code}.`,
      error
    );
  }
}

async function clearOrganisationScopedRecords(tx, organisationIds) {
  if (!organisationIds.length) return 0;
  let deleted = 0;
  for (const { modelName, delegate } of ORGANISATION_SCOPED_RESET_MODELS) {
    const repository = tx[delegate];
    const result = await resetStage(modelName.toUpperCase(), readableModelName(modelName), async () => {
      if (!repository?.deleteMany) {
        throw new Error(`Prisma delegate ${delegate} is unavailable.`);
      }
      return repository.deleteMany({ where: { organisationId: { in: organisationIds } } });
    });
    deleted += result.count;
  }
  return deleted;
}

async function clearDigitalSignageAssetReferences(tx, organisationIds) {
  if (!organisationIds.length) return 0;
  const deliveryProofs = await resetStage(
    "DIGITAL_SIGNAGE_DELIVERY_PROOFS",
    "digital signage delivery proofs",
    () => tx.digitalSignageDeliveryProof.deleteMany({
      where: { organisationId: { in: organisationIds } }
    })
  );
  const [playlistItems, retailVisualCreatives] = await Promise.all([
    resetStage(
      "DIGITAL_SIGNAGE_PLAYLIST_ITEMS",
      "digital signage playlist items",
      () => tx.digitalSignagePlaylistItem.deleteMany({
        where: { playlist: { organisationId: { in: organisationIds } } }
      })
    ),
    resetStage(
      "RETAIL_MEDIA_VISUAL_CREATIVES",
      "retail media visual creatives",
      () => tx.retailMediaOrderVisualCreative.deleteMany({
        where: {
          OR: [
            { order: { organisationId: { in: organisationIds } } },
            { signageAsset: { organisationId: { in: organisationIds } } }
          ]
        }
      })
    )
  ]);
  return deliveryProofs.count + playlistItems.count + retailVisualCreatives.count;
}

async function clearPromoAssetReferences(tx, organisationIds) {
  if (!organisationIds.length) return 0;
  const [exchangeOffers, retailMediaCreatives, radioClockItems, schoolRundownItems] = await Promise.all([
    resetStage(
      "SCHOOL_EPISODE_EXCHANGE_OFFERS",
      "school episode exchange offers",
      () => tx.schoolEpisodeExchangeOffer.deleteMany({
        where: {
          OR: [
            { sourceOrganisationId: { in: organisationIds } },
            { approvedPromoVersion: { promoAsset: { organisationId: { in: organisationIds } } } }
          ]
        }
      })
    ),
    resetStage(
      "RETAIL_MEDIA_ORDER_CREATIVES",
      "retail media order creatives",
      () => tx.retailMediaOrderCreative.deleteMany({
        where: {
          OR: [
            { order: { organisationId: { in: organisationIds } } },
            { promoVersion: { promoAsset: { organisationId: { in: organisationIds } } } }
          ]
        }
      })
    ),
    resetStage(
      "RADIO_CLOCK_ITEMS",
      "radio clock items",
      () => tx.radioClockItem.deleteMany({
        where: {
          OR: [
            { radioClock: { organisationId: { in: organisationIds } } },
            { promoVersion: { promoAsset: { organisationId: { in: organisationIds } } } }
          ]
        }
      })
    ),
    resetStage(
      "SCHOOL_RUNDOWN_ITEMS",
      "school rundown items",
      () => tx.schoolRundownItem.deleteMany({
        where: {
          OR: [
            { rundown: { organisationId: { in: organisationIds } } },
            { sourcePromoVersion: { promoAsset: { organisationId: { in: organisationIds } } } }
          ]
        }
      })
    )
  ]);
  return exchangeOffers.count + retailMediaCreatives.count + radioClockItems.count + schoolRundownItems.count;
}

async function clearSchoolContributorReferences(tx, organisationIds) {
  if (!organisationIds.length) return 0;
  const result = await resetStage(
    "SCHOOL_EPISODE_CONTRIBUTORS",
    "school episode contributors",
    () => tx.schoolEpisodeContributor.deleteMany({
      where: {
        OR: [
          { episode: { organisationId: { in: organisationIds } } },
          { contributor: { organisationId: { in: organisationIds } } }
        ]
      }
    })
  );
  return result.count;
}

async function archiveRightsEvidenceForReset(tx, { organisationIds, archivedByUserId }) {
  if (!organisationIds.length) return { usageEvents: 0, attestations: 0 };
  const organisationFilter = Prisma.join(organisationIds);
  const [usageEvents, attestations] = await Promise.all([
    tx.$executeRaw(Prisma.sql`
      INSERT INTO "RightsEvidenceResetArchive" (
        "sourceTable", "sourceId", "tenantOrganisationId", "archivedByUserId", "reason", "payload"
      )
      SELECT
        'RightsUsageLedgerEvent', evidence.id, evidence."organisationId", ${archivedByUserId},
        'SUBSCRIBER_TEST_DATA_RESET', to_jsonb(evidence)
      FROM "RightsUsageLedgerEvent" AS evidence
      WHERE evidence."organisationId" IN (${organisationFilter})
      ON CONFLICT ("sourceTable", "sourceId") DO NOTHING
    `),
    tx.$executeRaw(Prisma.sql`
      INSERT INTO "RightsEvidenceResetArchive" (
        "sourceTable", "sourceId", "tenantOrganisationId", "archivedByUserId", "reason", "payload"
      )
      SELECT
        'RightsReportAttestation', evidence.id, evidence."organisationId", ${archivedByUserId},
        'SUBSCRIBER_TEST_DATA_RESET', to_jsonb(evidence)
      FROM "RightsReportAttestation" AS evidence
      WHERE evidence."organisationId" IN (${organisationFilter})
      ON CONFLICT ("sourceTable", "sourceId") DO NOTHING
    `)
  ]);
  return { usageEvents, attestations };
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
  const [usersToDelete, superAdminsToDelete, codesToDelete, externalBillingRecords, rightsUsageEvents, rightsAttestations] = await Promise.all([
    database.user.count({ where: { id: { not: retainedUser.id } } }),
    database.user.count({ where: { id: { not: retainedUser.id }, role: "SUPER_ADMIN" } }),
    database.complimentaryAccessCode.count(),
    countExternalBillingRecords(database, organisationIds),
    database.rightsUsageLedgerEvent.count({ where: { organisationId: { in: organisationIds } } }),
    database.rightsReportAttestation.count({ where: { organisationId: { in: organisationIds } } })
  ]);
  return {
    retainedUser,
    usersToDelete,
    superAdminsToDelete,
    organisationsToDelete: organisationIds.length,
    codesToDelete,
    externalBillingRecords,
    rightsEvidenceToArchive: rightsUsageEvents + rightsAttestations
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

    const archivedRightsEvidence = await resetStage(
      "RIGHTS_EVIDENCE_ARCHIVE",
      "the immutable rights-evidence archive",
      () => archiveRightsEvidenceForReset(tx, { organisationIds, archivedByUserId: retainedUser.id })
    );
    const auditLogs = await tx.auditLog.deleteMany({
      where: scopedAuditWhere({ organisationIds, userIds, schoolNetworkIds, stationNetworkIds })
    });
    const rightsAttestations = await resetStage(
      "RIGHTS_REPORT_ATTESTATIONS",
      "archived rights-report attestations",
      () => tx.rightsReportAttestation.deleteMany({ where: { organisationId: { in: organisationIds } } })
    );
    const auditExportSeals = await tx.auditExportSeal.deleteMany({ where: { organisationId: { in: organisationIds } } });
    const rightsLedgerEvents = await resetStage(
      "RIGHTS_USAGE_LEDGER",
      "archived rights-usage ledger events",
      () => tx.rightsUsageLedgerEvent.deleteMany({ where: { organisationId: { in: organisationIds } } })
    );
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
    const digitalSignageAssetReferences = await clearDigitalSignageAssetReferences(tx, organisationIds);
    const promoAssetReferences = await clearPromoAssetReferences(tx, organisationIds);
    const schoolContributorReferences = await clearSchoolContributorReferences(tx, organisationIds);
    const orderedTenantRecords = await clearOrganisationScopedRecords(tx, organisationIds);
    const deletedOrganisations = await resetStage("ORGANISATIONS", "subscriber organisations", () => tx.organisation.deleteMany({}));
    const deletedUsers = await resetStage("USERS", "subscriber profiles", () => tx.user.deleteMany({ where: { id: { not: retainedUser.id } } }));
    await tx.auditLog.create({
      data: {
        actorUserId: retainedUser.id,
        action: "SUBSCRIBER_TEST_DATA_RESET",
        entityType: "Platform",
        details: {
          retainedEmail: retainedUser.email,
          deletedUsers: deletedUsers.count,
          deletedOrganisations: deletedOrganisations.count,
          deletedAccessCodes: accessCodes.count,
          archivedRightsEvidence: archivedRightsEvidence.usageEvents + archivedRightsEvidence.attestations
        }
      }
    });

    return {
      retainedUser,
      deletedUsers: deletedUsers.count,
      deletedOrganisations: deletedOrganisations.count,
      deletedAccessCodes: accessCodes.count,
      archivedRightsEvidence: archivedRightsEvidence.usageEvents + archivedRightsEvidence.attestations,
      deletedSchoolNetworks: deletedSchoolNetworks.count,
      deletedStationNetworks: deletedStationNetworks.count,
      deletedRelatedRecords:
        auditLogs.count + rightsAttestations.count + auditExportSeals.count + rightsLedgerEvents.count +
        syndicationAgreements.count + syndicationOffers.count + stationNetworkAgreements.count +
        studioBroadcastCommands.count + studioBroadcastSessions.count + studioBroadcastDestinations.count +
        studioPlayoutSessions.count + studioProgrammePacks.count + supportTickets.count +
        betaProgrammeReviews.count + betaProgrammes.count + digitalSignageAssetReferences +
        promoAssetReferences + schoolContributorReferences + orderedTenantRecords
    };
  }, SUBSCRIBER_TEST_RESET_TRANSACTION);
}
