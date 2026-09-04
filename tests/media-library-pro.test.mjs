import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  musicRightsWindowIsCurrent,
  musicTrackEligibility,
  organisationMusicStorageKey,
  parseOrganisationMusicMetadata,
  prepareMusicRightsSubmission
} from "../lib/media-library-pro.mjs";

const completeMetadata = {
  title: "Organisation anthem",
  artist: "Local Artist",
  album: "Approved Masters",
  releaseYear: "2026",
  durationSeconds: "180",
  isExplicit: "false",
  rightsHolder: "Example Organisation",
  rightsReference: "AGREEMENT-2026-42",
  rightsBasis: "DIRECT_LICENCE",
  permittedTerritories: "Worldwide",
  permittedUses: ["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO"],
  licenceStartsAt: "2026-01-01",
  licenceExpiresAt: "2027-12-31",
  rightsConfirmed: "true"
};

function organisationTrack(overrides = {}) {
  return {
    status: "READY",
    rightsHolder: "Example Organisation",
    rightsReference: "AGREEMENT-2026-42",
    rightsBasis: "DIRECT_LICENCE",
    permittedTerritories: "Worldwide",
    permittedUses: ["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO"],
    licenceStartsAt: new Date("2026-01-01T00:00:00.000Z"),
    licenceExpiresAt: new Date("2027-12-31T00:00:00.000Z"),
    rightsConfirmedAt: new Date("2026-09-04T00:00:00.000Z"),
    rightsReviewStatus: "APPROVED",
    mediaAsset: {
      status: "READY",
      mediaType: "MUSIC",
      libraryType: "ORGANISATION_MUSIC",
      organisationId: "organisation-1"
    },
    ...overrides
  };
}

test("organisation music metadata requires a documented rights declaration", () => {
  const valid = parseOrganisationMusicMetadata(completeMetadata);
  assert.equal(valid.ok, true);
  assert.equal(valid.data.releaseYear, 2026);
  assert.equal(valid.data.licenceStartsAt.toISOString(), "2026-01-01T00:00:00.000Z");

  const missingConfirmation = parseOrganisationMusicMetadata({ ...completeMetadata, rightsConfirmed: "false" });
  assert.equal(missingConfirmation.ok, false);
  assert.match(missingConfirmation.error, /authorised/i);

  const backwardsWindow = parseOrganisationMusicMetadata({ ...completeMetadata, licenceStartsAt: "2028-01-01" });
  assert.equal(backwardsWindow.ok, false);
  assert.match(backwardsWindow.error, /expiry/i);
});

test("organisation music keys are tenant scoped and checksum addressed", () => {
  assert.equal(
    organisationMusicStorageKey("organisation1", "a".repeat(64), "mp3"),
    `organisations/organisation1/music/${"a".repeat(64)}.mp3`
  );
  assert.throws(() => organisationMusicStorageKey("../unsafe", "a".repeat(64), "mp3"));
});

test("only approved organisation music can enter the shared playout layer", () => {
  const accepted = musicTrackEligibility(organisationTrack(), {
    organisationId: "organisation-1",
    requiredUse: "ONLINE_RADIO",
    territory: "MT",
    instant: new Date("2026-09-04T12:00:00.000Z")
  });
  assert.deepEqual(accepted, { playable: true, reason: "ORGANISATION_MUSIC" });

  assert.equal(musicTrackEligibility(organisationTrack(), { organisationId: "organisation-2" }).playable, false);
  assert.equal(musicTrackEligibility(organisationTrack({ rightsReviewStatus: "IN_REVIEW" }), { organisationId: "organisation-1" }).playable, false);
  assert.equal(musicTrackEligibility(organisationTrack({ permittedUses: ["ONLINE_RADIO"] }), { organisationId: "organisation-1" }).reason, "PRODUCT_CONTEXT_REQUIRED");
  assert.equal(musicTrackEligibility(organisationTrack({ permittedUses: ["ONLINE_RADIO"] }), { organisationId: "organisation-1", requiredUse: "RETAIL_RADIO" }).reason, "USE_NOT_PERMITTED");
});

test("rights windows and submission transitions fail closed", () => {
  assert.equal(musicRightsWindowIsCurrent(organisationTrack(), new Date("2027-12-31T23:59:00.000Z")), true);
  assert.equal(musicRightsWindowIsCurrent(organisationTrack(), new Date("2028-01-01T00:00:00.000Z")), false);
  const draft = { ...organisationTrack(), status: "DRAFT", rightsReviewStatus: "DRAFT" };
  assert.deepEqual(prepareMusicRightsSubmission(draft), { rightsReviewStatus: "IN_REVIEW", rightsReviewNotes: null });
  assert.throws(() => prepareMusicRightsSubmission({ ...draft, rightsConfirmedAt: null }), /confirm/i);
});

test("Stage 19.2 keeps rights relationships, migration and UI review paths explicit", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20261004000000_stage_19_2_media_library_pro/migration.sql", import.meta.url), "utf8");
  const subscriberPage = readFileSync(new URL("../app/dashboard/media/MusicLibraryPro.js", import.meta.url), "utf8");
  const adminPage = readFileSync(new URL("../app/admin/media/music/page.js", import.meta.url), "utf8");

  assert.match(schema, /ORGANISATION_MUSIC/);
  assert.match(schema, /rightsReviewStatus\s+MusicRightsReviewStatus/);
  assert.match(schema, /@relation\("TrackRightsReviewedBy"/);
  assert.match(migration, /UPDATE "Track" AS track/);
  assert.match(migration, /FOREIGN KEY \("rightsReviewedById"\)/);
  assert.match(subscriberPage, /Upload organisation music/);
  assert.match(subscriberPage, /does not grant or replace a licence/);
  assert.match(adminPage, /Review checklist/);
});
