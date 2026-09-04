import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseTrackForOrganisation,
  makeRadioSlug,
  validateMusicModeTracks
} from "../lib/radio-control.mjs";

test("radio slugs are stable and URL safe", () => {
  assert.equal(makeRadioSlug("  Morning Energy & Pop  "), "morning-energy-pop");
});

test("music mode track selection rejects duplicates and invalid weights", () => {
  assert.equal(
    validateMusicModeTracks([
      { trackId: "track-1", weight: 100 },
      { trackId: "track-1", weight: 50 }
    ]).ok,
    false
  );
  assert.equal(validateMusicModeTracks([{ trackId: "track-1", weight: 0 }]).ok, false);
});

test("music mode track selection normalizes the safe input", () => {
  assert.deepEqual(
    validateMusicModeTracks([{ trackId: " track-1 ", weight: 125 }]),
    { ok: true, tracks: [{ trackId: "track-1", weight: 125 }] }
  );
});

test("global ready catalogue music is available to every organisation", () => {
  assert.equal(
    canUseTrackForOrganisation(
      {
        status: "READY",
        mediaAsset: {
          status: "READY",
          mediaType: "MUSIC",
          libraryType: "RUVANAS_CATALOGUE",
          organisationId: null
        }
      },
      "organisation-1"
    ),
    true
  );
});

test("expired catalogue rights remove a track from music-mode eligibility", () => {
  assert.equal(
    canUseTrackForOrganisation(
      {
        status: "READY",
        licenceExpiresAt: new Date("2026-08-30T00:00:00.000Z"),
        mediaAsset: {
          status: "READY",
          mediaType: "MUSIC",
          libraryType: "RUVANAS_CATALOGUE",
          organisationId: null
        }
      },
      "organisation-1",
      new Date("2026-08-31T00:00:00.000Z")
    ),
    false
  );
});

test("promo or non-music assets cannot enter an organisation music mode", () => {
  const privateTrack = {
    status: "READY",
    mediaAsset: {
      status: "READY",
      mediaType: "MUSIC",
      libraryType: "ORGANISATION_PROMO",
      organisationId: "organisation-1"
    }
  };

  assert.equal(canUseTrackForOrganisation(privateTrack, "organisation-1"), false);
  assert.equal(canUseTrackForOrganisation(privateTrack, "organisation-2"), false);
  assert.equal(
    canUseTrackForOrganisation(
      {
        ...privateTrack,
        mediaAsset: { ...privateTrack.mediaAsset, mediaType: "JINGLE" }
      },
      "organisation-1"
    ),
    false
  );
});

test("approved organisation music is usable only by its owner with complete shared rights", () => {
  const approvedMusic = {
    status: "READY",
    rightsHolder: "Organisation 1",
    rightsReference: "LICENCE-1",
    rightsBasis: "DIRECT_LICENCE",
    permittedTerritories: "Worldwide",
    permittedUses: ["RETAIL_RADIO", "SCHOOL_RADIO", "ONLINE_RADIO"],
    rightsConfirmedAt: new Date("2026-09-04T00:00:00.000Z"),
    rightsReviewStatus: "APPROVED",
    mediaAsset: {
      status: "READY",
      mediaType: "MUSIC",
      libraryType: "ORGANISATION_MUSIC",
      organisationId: "organisation-1"
    }
  };

  assert.equal(canUseTrackForOrganisation(approvedMusic, "organisation-1"), true);
  assert.equal(canUseTrackForOrganisation(approvedMusic, "organisation-2"), false);
  assert.equal(canUseTrackForOrganisation({ ...approvedMusic, rightsReviewStatus: "IN_REVIEW" }, "organisation-1"), false);
});

