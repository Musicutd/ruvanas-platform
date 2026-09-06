import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canManageRadioDistribution,
  normalizeRadioDistributionInput,
  planRadioDistributionFanOut,
  radioDistributionConfigurationHash,
  radioDistributionPayload,
  radioDistributionReadiness,
  transitionRadioDistributionDestination
} from "../lib/radio-distribution.mjs";

const valid = { stationId: "station-1", kind: "DIRECTORY", providerKey: "generic.directory-v1", listingName: "Ruvanas One", endpointUrl: "https://adapter.example/sync", territoryCodes: "mt,GB", languageCodes: "en,mt-MT", categories: "Music,Talk" };

test("distribution input is provider-neutral, bounded and type-aware", () => {
  const input = normalizeRadioDistributionInput(valid);
  assert.equal(input.providerKey, "GENERIC.DIRECTORY-V1");
  assert.deepEqual(input.territoryCodes, ["GB", "MT"]);
  assert.deepEqual(input.languageCodes, ["en", "mt-MT"]);
  assert.equal(canManageRadioDistribution("OWNER"), true);
  assert.equal(canManageRadioDistribution("MANAGER"), true);
  assert.equal(canManageRadioDistribution("CONTENT_EDITOR"), false);
  assert.throws(() => normalizeRadioDistributionInput({ ...valid, endpointUrl: "http://localhost/sync" }), /HTTPS/);
  assert.throws(() => normalizeRadioDistributionInput({ ...valid, kind: "STREAM_CDN" }), /requires one active/);
  assert.throws(() => normalizeRadioDistributionInput({ ...valid, channelId: "channel-1" }), /must not select/);
});

test("activation readiness fails closed for public and transport dependencies", () => {
  const destination = { kind: "DIRECTORY", connection: { endpointUrl: "https://adapter.example" } };
  const station = { id: "station-1", status: "ACTIVE", publicPlayerEnabled: true, stationWebsiteEnabled: true, streamConfig: { streamUrl: "https://stream.example/live" } };
  assert.deepEqual(radioDistributionReadiness({ destination, station, channel: null }), { ready: true, findings: [] });
  assert.equal(radioDistributionReadiness({ destination, station: { ...station, stationWebsiteEnabled: false }, channel: null }).ready, false);
  const cdn = { ...destination, kind: "STREAM_CDN" };
  assert.equal(radioDistributionReadiness({ destination: cdn, station, channel: { stationId: station.id, status: "ACTIVE" } }).ready, true);
  assert.equal(radioDistributionReadiness({ destination: cdn, station: { ...station, streamConfig: null }, channel: { stationId: station.id, status: "ACTIVE" } }).ready, false);
});

test("distribution lifecycle creates unique, evidence-bound revisions", () => {
  const base = { ...valid, providerKey: "GENERIC", id: "destination-1", status: "DRAFT", revision: 0, territoryCodes: ["WORLDWIDE"], languageCodes: ["en"], categories: ["Music"] };
  const active = transitionRadioDistributionDestination(base, "ACTIVATE", new Date("2026-10-24T00:00:00Z"));
  assert.equal(active.status, "ACTIVE"); assert.equal(active.revision, 1); assert.match(active.configurationHash, /^[a-f0-9]{64}$/);
  const sync = transitionRadioDistributionDestination({ ...base, ...active }, "SYNC");
  assert.equal(sync.revision, 2); assert.notEqual(sync.configurationHash, active.configurationHash);
  const paused = transitionRadioDistributionDestination({ ...base, ...active }, "PAUSE");
  assert.equal(paused.status, "PAUSED");
  assert.equal(transitionRadioDistributionDestination({ ...base, ...paused }, "REVOKE").status, "REVOKED");
  assert.throws(() => transitionRadioDistributionDestination({ ...base, status: "REVOKED" }, "ACTIVATE"), /cannot be changed/);
  assert.equal(radioDistributionConfigurationHash({ ...base, revision: 3 }), radioDistributionConfigurationHash({ ...base, revision: 3 }));
});

test("adapter payload contains only public station distribution data", () => {
  const payload = radioDistributionPayload({ destination: { id: "d1", kind: "DIRECTORY", providerKey: "GENERIC", revision: 2, listingName: "Station", territoryCodes: ["MT"], languageCodes: ["en"], categories: ["Music"], endpointUrl: "secret", organisationId: "private" }, station: { slug: "station-one" }, channel: null, origin: "https://ruvanas.example/private", action: "SYNC" });
  assert.equal(payload.stationUrl, "https://ruvanas.example/radio/station-one");
  assert.equal(payload.playerUrl, "https://ruvanas.example/listen/station-one");
  assert.doesNotMatch(JSON.stringify(payload), /endpoint|organisation|credential|secret/i);
});

test("distribution fan-out remains tenant-independent and linear", () => {
  const destinations = Array.from({ length: 10_000 }, (_, index) => ({ id: `d-${index}`, connectionId: `c-${index}`, stationId: index % 2 ? "other" : "station", status: index % 3 ? "ACTIVE" : "PAUSED", revision: 1 }));
  const started = performance.now();
  const plan = planRadioDistributionFanOut(destinations, "station");
  assert.ok(plan.length > 0 && plan.length < destinations.length);
  assert.ok(performance.now() - started < 1000);
  assert.ok(plan.every((item) => !Object.hasOwn(item, "endpointUrl")));
});

test("Stage 19.23 reuses governed integrations and enforces route/database boundaries", async () => {
  const [route, service, webhook, schema, migration, page, navigation, docs] = await Promise.all([
    readFile(new URL("../app/api/radio-distribution/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/radio-distribution-service.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/outgoing-webhook-service.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261024000000_stage_19_23_radio_distribution/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/radio/distribution/RadioDistributionWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-experience-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/stage-19-23-radio-distribution.md", import.meta.url), "utf8")
  ]);
  assert.match(route, /getRadioDistributionContext/); assert.match(route, /canManageRadioDistribution/); assert.match(route, /encryptSecret\(secret\)/);
  assert.match(route, /queueOutgoingWebhookEventForConnection/); assert.match(route, /organisationId/); assert.doesNotMatch(route, /decryptSecret/);
  assert.match(service, /organisationId: access\.organisation\.id/); assert.doesNotMatch(service, /encryptedSecret/);
  assert.match(webhook, /queueOutgoingWebhookEventForConnection/);
  assert.match(schema, /model RadioDistributionDestination/); assert.match(schema, /@@unique\(\[organisationId, stationId, kind, providerKey\]\)/);
  assert.match(migration, /channel_station_org_fkey/); assert.match(migration, /connection_org_fkey/); assert.match(migration, /activation_check/);
  assert.match(page, /Provider acceptance remains external/); assert.match(navigation, /Station distribution/); assert.match(docs, /does not claim/);
});
