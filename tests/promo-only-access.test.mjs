import assert from "node:assert/strict";
import { test } from "node:test";
import { musicTrackEligibility } from "../lib/media-library-pro.mjs";
import { studioQueueReadiness } from "../lib/studio-playout.mjs";
import {
  promoOnlyApprovalScopeDecision,
  promoOnlyPlaybackDecision,
  promoOnlyStreamDecision,
  updatePromoOnlyOwnedTrack
} from "../lib/promo-only-playback.mjs";

const testMode = { enabled: true, mode: "AUDIO_TEST" };
const activeItem = { status: "ACTIVE", autoDjReady: true,
  connection: { providerKey: "PROMO_ONLY", status: "ACTIVE" },
  canonicalGenre: { active: true, providerReviewStatus: "APPROVED", minimumCatalogueLevel: "FOCUSED", slug: "pop" }
};
const asset = { status: "READY", mediaType: "MUSIC", libraryType: "RUVANAS_CATALOGUE",
  organisationId: null, licensedCatalogue: true,
  genres: [{ mediaGenre: { slug: "pop", name: "Pop" } }]
};
const track = { status: "READY", catalogueProvider: "PROMO_ONLY", mediaAsset: asset,
  rightsReviewStatus: "APPROVED", permittedTerritories: "US", permittedUses: ["ONLINE_RADIO"],
  minimumCatalogueLevel: "FOCUSED", distributorItems: [activeItem]
};
const eligibility = { requiredUse: "ONLINE_RADIO", territory: "US", licensedCatalogueLevel: "FOCUSED" };

test("an already-imported provider track stops when test mode is off or the connection is paused/revoked", () => {
  assert.equal(musicTrackEligibility(track, { ...eligibility, promoOnlyConfig: testMode }).playable, true);
  for (const config of [{ enabled: false, mode: "OFF" }, { enabled: true, mode: "METADATA" }]) {
    assert.equal(musicTrackEligibility(track, { ...eligibility, promoOnlyConfig: config }).reason, "PROMOONLY_DISABLED");
    assert.equal(studioQueueReadiness({ ...asset, track }, { licensedMusicCatalogueEnabled: true,
      licensedMusicCatalogueLevel: "FOCUSED", planProductFamily: "ONLINE", promoOnlyConfig: config }).ready, false);
  }
  for (const status of ["PAUSED", "REVOKED", "DRAFT"]) {
    const changed = { ...track, distributorItems: [{ ...activeItem, connection: { ...activeItem.connection, status } }] };
    assert.equal(musicTrackEligibility(changed, { ...eligibility, promoOnlyConfig: testMode }).reason, "PROMOONLY_CONNECTION_INACTIVE");
  }
  for (const changed of [
    { ...track, distributorItems: [] },
    { ...track, distributorItems: [{ ...activeItem, status: "TAKEN_DOWN" }] },
    { ...track, distributorItems: [{ ...activeItem, autoDjReady: false }] },
    { ...track, distributorItems: [{ ...activeItem, connection: undefined }] }
  ]) assert.equal(promoOnlyPlaybackDecision(changed, { config: testMode }).allowed, false);
});

test("a recent intent alone cannot stream revoked or out-of-plan supplier audio", () => {
  assert.equal(promoOnlyStreamDecision(track, { currentPlanEligible: false, config: testMode }).allowed, false);
  assert.equal(promoOnlyStreamDecision(track, { currentPlanEligible: true, config: { enabled: false, mode: "OFF" } }).allowed, false);
  assert.equal(promoOnlyStreamDecision(track, { currentPlanEligible: true, config: testMode }).allowed, true);
  assert.equal(promoOnlyStreamDecision({ catalogueProvider: null }, { currentPlanEligible: false }).allowed, true);
});

test("supplier territory and use approval needs an existing narrow contract scope", () => {
  const approved = { approvedTerritories: ["US", "CA", "FR"], approvedUses: ["ONLINE_RADIO"] };
  const input = { ...approved, territories: "US, FR", uses: ["ONLINE_RADIO"] };
  assert.deepEqual(promoOnlyApprovalScopeDecision(input).territoryCodes, ["US", "FR"]);
  for (const territories of ["DE", "EUROPE", "WORLDWIDE", "US, DE", "US, GB"]) {
    assert.equal(promoOnlyApprovalScopeDecision({ ...input, territories }).allowed, false);
  }
  for (const approvedTerritories of [["WORLDWIDE"], ["GLOBAL"], ["ALL"], ["*"], ["EUROPE"], ["US", "DE"]]) {
    assert.equal(promoOnlyApprovalScopeDecision({ ...input, approvedTerritories }).allowed, false);
  }
  assert.equal(promoOnlyApprovalScopeDecision({ ...input, approvedTerritories: [] }).allowed, false);
  assert.equal(promoOnlyApprovalScopeDecision({ ...input, approvedUses: [] }).allowed, false);
  assert.equal(promoOnlyApprovalScopeDecision({ ...input, uses: ["CORRECTIONS_RADIO"] }).allowed, false);
  assert.equal(musicTrackEligibility(track, { ...eligibility, territory: "DE", promoOnlyConfig: testMode }).playable, false);
  assert.equal(musicTrackEligibility(track, { ...eligibility, licensedCatalogueLevel: "NONE", promoOnlyConfig: testMode }).playable, false);
  assert.equal(musicTrackEligibility({ ...track, licenceExpiresAt: new Date("2025-01-01") }, {
    ...eligibility, instant: new Date("2026-01-01"), promoOnlyConfig: testMode
  }).reason, "RIGHTS_WINDOW_INACTIVE");
});

test("linked Track updates are scoped to Promo Only's global catalogue and reject a bad link", async () => {
  const calls = [];
  const tx = { track: { updateMany: async (args) => { calls.push(args); return { count: 1 }; } } };
  await updatePromoOnlyOwnedTrack(tx, "provider-track", { status: "DRAFT" });
  assert.deepEqual(calls[0].where, { id: "provider-track", catalogueProvider: "PROMO_ONLY",
    mediaAsset: { is: { libraryType: "RUVANAS_CATALOGUE", organisationId: null } } });
  const mismatch = { track: { updateMany: async () => ({ count: 0 }) } };
  await assert.rejects(updatePromoOnlyOwnedTrack(mismatch, "customer-track", { status: "DRAFT" }), {
    code: "PROMOONLY_CATALOGUE_OWNERSHIP_MISMATCH"
  });
  await assert.rejects(updatePromoOnlyOwnedTrack(mismatch, null, { status: "DRAFT" }), {
    code: "PROMOONLY_CATALOGUE_OWNERSHIP_MISMATCH"
  });
});
