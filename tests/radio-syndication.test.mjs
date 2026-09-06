import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canManageRadioSyndication,
  normalizeRadioSyndicationOffer,
  normalizeRadioSyndicationRequest,
  normalizeRadioSyndicationTerritories,
  radioSyndicationDeliveryDecision,
  radioSyndicationFleetSummary,
  redactedRadioSyndicationOffer,
  transitionRadioSyndicationAgreement,
  transitionRadioSyndicationOffer
} from "../lib/radio-syndication.mjs";

const from = "2026-10-01T00:00:00.000Z";
const until = "2026-10-31T00:00:00.000Z";

test("syndication offers require one source and bounded rights metadata", () => {
  const offer = normalizeRadioSyndicationOffer({
    stationNetworkId: "network-1", sourceStationId: "station-1", kind: "RECORDED_PROGRAMME", sourcePodcastEpisodeId: "episode-1",
    title: "  Weekly programme  ", rightsHolder: "Independent Radio", rightsReference: "LIC-42", rightsBasis: "DIRECT_LICENCE",
    permittedTerritories: "gb, MT,gb", availableFrom: from, availableUntil: until
  });
  assert.equal(offer.title, "Weekly programme");
  assert.equal(offer.permittedTerritories, "GB,MT");
  assert.equal(canManageRadioSyndication("OWNER"), true);
  assert.equal(canManageRadioSyndication("MANAGER"), true);
  assert.equal(canManageRadioSyndication("CONTENT_EDITOR"), false);
  assert.throws(() => normalizeRadioSyndicationTerritories("WORLDWIDE,MT"), /cannot be combined/);
  assert.throws(() => normalizeRadioSyndicationTerritories("Malta"), /two-letter/);
  assert.throws(() => normalizeRadioSyndicationOffer({ ...offer, sourceChannelId: "channel-1" }), /exactly one/);
  assert.throws(() => normalizeRadioSyndicationOffer({ ...offer, availableUntil: from }), /later/);
});

test("recipient windows and territories stay inside the source grant", () => {
  const offer = { permittedTerritories: "GB,MT", availableFrom: from, availableUntil: until };
  const request = normalizeRadioSyndicationRequest({ targetStationId: "station-2", requestedTerritories: "MT", requestedFrom: "2026-10-02T00:00:00Z", requestedUntil: "2026-10-20T00:00:00Z", intendedUse: "Weekly broadcast on our community station." }, offer);
  assert.equal(request.requestedTerritories, "MT");
  assert.throws(() => normalizeRadioSyndicationRequest({ ...request, requestedTerritories: "US" }, offer), /subset/);
  assert.throws(() => normalizeRadioSyndicationRequest({ ...request, requestedUntil: "2026-11-01T00:00:00Z" }, offer), /within/);
  assert.throws(() => normalizeRadioSyndicationRequest({ ...request, intendedUse: "test" }, offer), /at least 20/);
});

test("offer and agreement state machines reject implicit authority", () => {
  assert.equal(transitionRadioSyndicationOffer({ currentStatus: "DRAFT", action: "PUBLISH" }).status, "AVAILABLE");
  assert.equal(transitionRadioSyndicationOffer({ currentStatus: "AVAILABLE", action: "PAUSE" }).status, "PAUSED");
  assert.throws(() => transitionRadioSyndicationOffer({ currentStatus: "WITHDRAWN", action: "PUBLISH" }), /not available/);
  assert.equal(transitionRadioSyndicationAgreement({ currentStatus: "PENDING", action: "APPROVE" }).status, "APPROVED");
  assert.equal(transitionRadioSyndicationAgreement({ currentStatus: "PENDING", action: "CANCEL" }).status, "CANCELLED");
  assert.equal(transitionRadioSyndicationAgreement({ currentStatus: "APPROVED", action: "REVOKE", notes: "Rights have ended." }).status, "REVOKED");
  assert.throws(() => transitionRadioSyndicationAgreement({ currentStatus: "APPROVED", action: "REVOKE" }), /reason/);
});

function deliverableFixture(kind = "RECORDED_PROGRAMME") {
  const offer = {
    kind, status: "AVAILABLE", availableFrom: from, availableUntil: until,
    network: { status: "ACTIVE" }, sourceNetworkAgreement: { status: "ACTIVE" }, sourceStation: { status: "ACTIVE", streamConfig: { streamUrl: "https://radio.example/live" } },
    sourceChannel: kind === "LIVE_RELAY" ? { status: "ACTIVE" } : null,
    sourcePodcastEpisode: kind === "RECORDED_PROGRAMME" ? { status: "PUBLISHED", mediaAsset: { status: "READY" } } : null
  };
  const agreement = { status: "APPROVED", requestedTerritories: "MT", requestedFrom: from, requestedUntil: until, targetNetworkAgreement: { status: "ACTIVE" }, targetStation: { status: "ACTIVE" } };
  return { offer, agreement };
}

test("delivery is fail-closed across membership, rights, territory and source readiness", () => {
  const instant = new Date("2026-10-10T00:00:00Z");
  for (const kind of ["RECORDED_PROGRAMME", "LIVE_RELAY"]) {
    const base = deliverableFixture(kind);
    assert.deepEqual(radioSyndicationDeliveryDecision({ ...base, territory: "MT", instant }), { allowed: true, reason: "DELIVERABLE" });
    assert.equal(radioSyndicationDeliveryDecision({ ...base, territory: "US", instant }).reason, "TERRITORY_NOT_PERMITTED");
    assert.equal(radioSyndicationDeliveryDecision({ offer: { ...base.offer, status: "PAUSED" }, agreement: base.agreement, territory: "MT", instant }).reason, "OFFER_UNAVAILABLE");
    assert.equal(radioSyndicationDeliveryDecision({ offer: base.offer, agreement: { ...base.agreement, targetNetworkAgreement: { status: "REVOKED" } }, territory: "MT", instant }).reason, "TARGET_MEMBERSHIP_INACTIVE");
  }
});

test("cross-tenant summaries redact transport, storage and account internals", () => {
  const summary = redactedRadioSyndicationOffer({
    id: "offer-1", kind: "LIVE_RELAY", title: "Live show", description: null, status: "AVAILABLE", rightsHolder: "Source", rightsBasis: "OWNED_MASTER", rightsReference: "secret-contract", permittedTerritories: "MT", availableFrom: new Date(from), availableUntil: new Date(until), termsVersion: "v1", sourceOrganisationId: "source-org",
    network: { id: "network-1", name: "Network", privateKey: "no" }, sourceStation: { id: "station-1", name: "Source", slug: "source", streamConfig: { streamUrl: "https://secret" }, providerAccountId: "secret" }, sourceOrganisation: { id: "source-org", name: "Source Org", subscription: { id: "private" } }, agreements: []
  }, { activeOrganisationId: "recipient-org" });
  const serialized = JSON.stringify(summary);
  assert.match(serialized, /Verified by source station/);
  assert.doesNotMatch(serialized, /secret-contract|streamUrl|providerAccountId|subscription|privateKey|storageKey|credential/i);
});

test("Stage 19.20 routes preserve tenant boundaries and protected delivery", async () => {
  const [route, service, delivery, media, live, audio, schema, migration, navigation] = await Promise.all([
    readFile(new URL("../app/api/radio-syndication/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/radio-syndication-service.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/radio-syndication-delivery.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/radio-syndication/agreements/[agreementId]/media/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/radio-syndication/agreements/[agreementId]/live/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/podcast-audio-delivery.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261021000000_stage_19_20_radio_syndication/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8")
  ]);
  assert.match(route, /canManageRadioSyndication/);
  assert.match(route, /sourceOrganisationId: \{ not: organisationId \}/);
  assert.match(route, /targetOrganisationId: organisationId/);
  assert.match(route, /RADIO_SYNDICATION_AGREEMENT_/);
  assert.match(service, /sourceOrganisationId: organisationId/);
  assert.match(delivery, /targetOrganisationId, importedAt: \{ not: null \}/);
  assert.match(media, /private, no-store/);
  assert.match(live, /protectedLiveResponse/);
  assert.match(audio, /cacheControl/);
  assert.match(schema, /@@index\(\[offerId, targetStationId, status\]\)/);
  assert.match(route, /status: \{ in: \["PENDING", "APPROVED"\] \}/);
  assert.match(migration, /source_kind_check/);
  assert.match(migration, /FOREIGN KEY \("targetStationId", "targetOrganisationId"\)/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(navigation, /Programme syndication/);
  assert.doesNotMatch(service, /storageKey|credentialEncrypted|providerAccountId|subscription\.plan/);
});

test("syndication fleet summaries remain linear at network scale", () => {
  const offers = Array.from({ length: 10_000 }, (_, index) => ({ kind: index % 2 ? "LIVE_RELAY" : "RECORDED_PROGRAMME", agreements: [{ status: index % 3 ? "APPROVED" : "PENDING" }] }));
  const started = performance.now();
  const summary = radioSyndicationFleetSummary(offers);
  assert.deepEqual(summary, { offers: 10_000, recorded: 5_000, live: 5_000, agreements: 10_000, approved: 6666 });
  assert.ok(performance.now() - started < 1500);
});
