import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { mapPromoOnlyTrack } from "../../lib/promo-only.mjs";
import { upsertPromoOnlyMetadata } from "../../lib/promo-only-service.js";

const OWNED_URL = "postgres://mainqa@127.0.0.1:5552/ruvanas_main_qa_20261010";
const enabled = process.env.RUN_DATABASE_TESTS === "1" && process.env.DATABASE_URL === OWNED_URL;

test("Promo Only identity, reviewed rights, customer ownership and playlist links survive metadata sync",
  { skip: !enabled }, async () => {
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const numericId = randomBytes(6).readUIntBE(0, 6) + 1;
    const genre = "Synthetic Promo Only " + suffix;
    const config = { autoCreateGenres: true, genreReviewRequired: true };
    const rollback = new Error("ROLL_BACK_OWNED_PROMO_ONLY_FIXTURE");
    let ownedUserId;
    try {
      assert.equal(await prisma.musicDistributorConnection.findUnique({
        where: { providerKey: "PROMO_ONLY" }
      }), null, "A fresh owned database is required.");
      await assert.rejects(prisma.$transaction(async (db) => {
        const user = await db.user.create({ data: {
          name: "Synthetic Promo Only QA",
          email: "promo-only-" + suffix + "@example.invalid",
          passwordHash: "SYNTHETIC_NOT_A_LOGIN", role: "SUPER_ADMIN"
        } });
        ownedUserId = user.id;
        const org = await db.organisation.create({ data: {
          name: "Synthetic Promo Only Customer", slug: "promo-only-" + suffix
        } });
        const connection = await db.musicDistributorConnection.create({ data: {
          createdByUserId: user.id, name: "Synthetic Promo Only " + suffix,
          providerKey: "PROMO_ONLY", apiBaseUrl: "https://synthetic.invalid/",
          tokenUrl: "https://synthetic.invalid/token",
          clientCredentialsEncrypted: "SYNTHETIC_NO_CREDENTIALS"
        } });
        const raw = (offset, title, modifiedAt) => ({
          trackid: String(numericId + offset), title, artist: "Synthetic Artist",
          genre, modified: Math.floor(Date.parse(modifiedAt) / 1000)
        });
        const mapped = (offset, title, modifiedAt) =>
          mapPromoOnlyTrack(raw(offset, title, modifiedAt));
        const t0 = "2026-10-10T08:00:00.000Z";
        const t1 = "2026-10-10T09:00:00.000Z";

        const first = await upsertPromoOnlyMetadata(db, connection, mapped(0, "First title", t0), config);
        assert.equal(first.created, true);
        assert.equal(first.genreResult.created, true);
        assert.equal(first.genreResult.genre.providerReviewStatus, "PENDING");
        const repeated = await upsertPromoOnlyMetadata(db, connection, mapped(0, "First title", t0), config);
        assert.equal(repeated.created, false);
        assert.equal(repeated.changed, false);
        assert.equal(repeated.track.id, first.track.id);
        assert.equal(await db.musicDistributorTrack.count({ where: {
          connectionId: connection.id, externalTrackId: String(numericId)
        } }), 1);

        const reviewed = await db.musicDistributorTrack.update({ where: { id: first.track.id }, data: {
          minimumCatalogueLevel: "PREMIUM", permittedTerritories: ["MT", "GB"],
          permittedUses: ["ONLINE_RADIO"],
          licenceStartsAt: new Date("2026-10-01T00:00:00.000Z"),
          licenceExpiresAt: new Date("2026-12-31T00:00:00.000Z"),
          rightsHolder: "Human-reviewed synthetic rights",
          rightsReference: "human-reviewed:synthetic",
          status: "TAKEN_DOWN", takedownReason: "Human-reviewed synthetic takedown",
          takenDownAt: new Date("2026-10-10T08:30:00.000Z")
        } });
        const updated = await upsertPromoOnlyMetadata(db, connection,
          mapped(0, "Revised supplier title", t1), config);
        assert.equal(updated.track.id, first.track.id);
        assert.equal(updated.changed, true);
        assert.equal(updated.track.title, "Revised supplier title");
        assert.equal(updated.track.revision, reviewed.revision + 1);
        for (const field of ["minimumCatalogueLevel", "permittedTerritories", "permittedUses",
          "licenceStartsAt", "licenceExpiresAt", "rightsHolder", "rightsReference", "status",
          "takedownReason", "takenDownAt"]) {
          assert.deepEqual(updated.track[field], reviewed[field],
            "Supplier metadata changed reviewed " + field);
        }

        const customer = await upsertPromoOnlyMetadata(db, connection,
          mapped(1, "Customer-linked supplier row", t0), config);
        const customerAsset = await db.mediaAsset.create({ data: {
          organisationId: org.id, libraryType: "ORGANISATION_MUSIC",
          name: "Synthetic customer audio", originalName: "customer.wav",
          storageKey: "synthetic/promo-only/customer/" + suffix,
          mimeType: "audio/wav", sizeBytes: BigInt(1), mediaType: "MUSIC", status: "READY"
        } });
        const customerTrack = await db.track.create({ data: {
          mediaAssetId: customerAsset.id, title: "Customer audio", artist: "Customer artist",
          catalogueProvider: "PROMO_ONLY", status: "READY", rightsReviewStatus: "APPROVED"
        } });
        await db.musicDistributorTrack.update({ where: { id: customer.track.id },
          data: { trackId: customerTrack.id } });
        await assert.rejects(() => upsertPromoOnlyMetadata(db, connection,
          mapped(1, "Forged customer overwrite", t1), config),
        { code: "PROMOONLY_CATALOGUE_OWNERSHIP_MISMATCH" });
        const customerAfter = await db.musicDistributorTrack.findUnique({
          where: { id: customer.track.id }
        });
        assert.equal(customerAfter.title, customer.track.title);
        assert.equal(customerAfter.metadataChecksum, customer.track.metadataChecksum);
        assert.equal(customerAfter.revision, customer.track.revision);
        assert.equal(customerAfter.trackId, customerTrack.id);
        assert.deepEqual(await db.track.findUnique({ where: { id: customerTrack.id },
          select: { status: true, rightsReviewStatus: true, mediaAssetId: true } }),
        { status: "READY", rightsReviewStatus: "APPROVED", mediaAssetId: customerAsset.id });

        const global = await upsertPromoOnlyMetadata(db, connection,
          mapped(2, "Global supplier row", t0), config);
        const globalAsset = await db.mediaAsset.create({ data: {
          libraryType: "RUVANAS_CATALOGUE", name: "Synthetic global audio",
          originalName: "global.wav", storageKey: "synthetic/promo-only/global/" + suffix,
          mimeType: "audio/wav", sizeBytes: BigInt(1), mediaType: "MUSIC", status: "READY"
        } });
        const globalTrack = await db.track.create({ data: {
          mediaAssetId: globalAsset.id, title: "Global supplier row", artist: "Synthetic Artist",
          catalogueProvider: "PROMO_ONLY", status: "READY", rightsReviewStatus: "APPROVED"
        } });
        await db.musicDistributorTrack.update({ where: { id: global.track.id }, data: {
          trackId: globalTrack.id, importState: "AUTODJ_READY",
          autoDjReady: true, audioStatus: "VALIDATED"
        } });
        const playlist = await db.generatedPlaylist.create({ data: {
          organisationId: org.id, name: "Synthetic reference playlist",
          targetType: "CHANNEL", targetId: "synthetic-" + suffix, timezone: "Europe/Malta",
          scheduledDate: new Date("2026-10-10T00:00:00.000Z"),
          startMinute: 0, endMinute: 60, rightsUse: "ONLINE_RADIO", createdByUserId: user.id
        } });
        const version = await db.generatedPlaylistVersion.create({ data: {
          generatedPlaylistId: playlist.id, version: 1, seed: "synthetic-" + suffix,
          requestedDurationSeconds: 60, generatedDurationSeconds: 60
        } });
        const item = await db.generatedPlaylistItem.create({ data: {
          generatedPlaylistVersionId: version.id, trackId: globalTrack.id, position: 0,
          startOffsetSeconds: 0, endOffsetSeconds: 60, durationSeconds: 60,
          genreCode: "synthetic", sourceScope: "RUVANAS_CATALOGUE"
        } });
        const quarantined = await upsertPromoOnlyMetadata(db, connection,
          mapped(2, "Global revised title", t1), config);
        assert.equal(quarantined.track.id, global.track.id);
        assert.equal(quarantined.track.trackId, globalTrack.id);
        assert.equal(quarantined.track.importState, "RECONCILIATION_REQUIRED");
        assert.equal(quarantined.track.autoDjReady, false);
        assert.deepEqual(await db.track.findUnique({ where: { id: globalTrack.id },
          select: { status: true, rightsReviewStatus: true, mediaAssetId: true } }),
        { status: "DRAFT", rightsReviewStatus: "DRAFT", mediaAssetId: globalAsset.id });
        assert.equal((await db.generatedPlaylistItem.findUnique({
          where: { id: item.id }
        })).trackId, globalTrack.id);
        assert.equal(await db.auditLog.count({ where: {
          action: "PROMOONLY_METADATA_RECONCILIATION_REQUIRED", entityId: global.track.id
        } }), 1);
        // Roll back every owned synthetic row, including the genre mapping and playlist.
        throw rollback;
      }, { maxWait: 10_000, timeout: 30_000 }), error => error === rollback);
      assert.equal(await prisma.musicDistributorConnection.findUnique({
        where: { providerKey: "PROMO_ONLY" }
      }), null);
      assert.equal(await prisma.user.findUnique({ where: { id: ownedUserId } }), null);
    } finally {
      await prisma.$disconnect();
    }
  });
