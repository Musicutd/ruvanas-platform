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

test("private or non-music assets cannot leak into another organisation mode", () => {
  const privateTrack = {
    status: "READY",
    mediaAsset: {
      status: "READY",
      mediaType: "MUSIC",
      libraryType: "ORGANISATION_PROMO",
      organisationId: "organisation-1"
    }
  };

  assert.equal(canUseTrackForOrganisation(privateTrack, "organisation-1"), true);
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

