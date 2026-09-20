import assert from "node:assert/strict";
import test from "node:test";
import { filterStudioLibraryAssets, mergeStudioLibraryAssets, STUDIO_LIBRARY_TABS, studioPackItemAvailability, studioProgrammePackScope } from "../lib/studio-library-workspace.mjs";

const assets = [
  { id: "music-1", name: "First track", title: "Morning Light", artist: "Ada", mediaType: "MUSIC" },
  { id: "jingle-1", name: "Station ID", mediaType: "JINGLE" },
  { id: "ad-1", name: "Local sponsor", mediaType: "COMMERCIAL" }
];

test("Studio library tabs reflect media types that actually exist", () => {
  assert.deepEqual(STUDIO_LIBRARY_TABS.map((tab) => tab.id), ["ALL", "MUSIC", "JINGLE", "COMMERCIAL", "ANNOUNCEMENT", "VOICEOVER"]);
  assert.deepEqual(filterStudioLibraryAssets(assets, { tab: "COMMERCIAL" }).map((asset) => asset.id), ["ad-1"]);
  assert.deepEqual(filterStudioLibraryAssets(assets, { tab: "JINGLE" }).map((asset) => asset.id), ["jingle-1"]);
});

test("Studio library searches title, artist and name without hiding the selected media type", () => {
  assert.deepEqual(filterStudioLibraryAssets(assets, { tab: "MUSIC", query: "ada morning" }).map((asset) => asset.id), ["music-1"]);
  assert.deepEqual(filterStudioLibraryAssets(assets, { tab: "JINGLE", query: "morning" }), []);
  assert.deepEqual(filterStudioLibraryAssets(assets, { tab: "ALL", query: "sponsor" }).map((asset) => asset.id), ["ad-1"]);
});

test("Programme packs are scoped to the active organisation and pillar", () => {
  assert.deepEqual(studioProgrammePackScope("organisation-1", "ONLINE"), { organisationId: "organisation-1", productFamily: "ONLINE" });
  assert.throws(() => studioProgrammePackScope("organisation-1", ""));
});

test("Older programme-pack audio stays findable beyond the recent library page", () => {
  assert.deepEqual(mergeStudioLibraryAssets(assets, [{ id: "older-1", mediaType: "MUSIC" }, assets[0]]).map((asset) => asset.id), ["music-1", "jingle-1", "ad-1", "older-1"]);
});

test("Unavailable pack media cannot be sent to Prepare from the workspace", () => {
  assert.equal(studioPackItemAvailability({ mediaAssetId: "music-1" }, assets).canPrepare, true);
  assert.deepEqual(studioPackItemAvailability({ mediaAssetId: "archived" }, assets), { asset: null, canPrepare: false });
});
