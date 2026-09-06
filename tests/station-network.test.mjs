import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canApproveStationNetworkAgreement,
  canManageStationNetwork,
  normalizeStationNetworkInput,
  stationNetworkAgreementSummary,
  stationNetworkAgreementTransition,
  stationNetworkFleetSummary
} from "../lib/station-network.mjs";

test("station network details and authority are bounded", () => {
  assert.deepEqual(normalizeStationNetworkInput({ name: "  Malta  Radio Network ", description: " Independent stations. " }), { name: "Malta Radio Network", description: "Independent stations." });
  assert.equal(canManageStationNetwork("OWNER"), true);
  assert.equal(canManageStationNetwork("MANAGER"), true);
  assert.equal(canManageStationNetwork("CONTENT_EDITOR"), false);
  assert.equal(canApproveStationNetworkAgreement("OWNER"), true);
  assert.equal(canApproveStationNetworkAgreement("MANAGER"), false);
  assert.throws(() => normalizeStationNetworkInput({ name: "" }), /required/);
  assert.throws(() => normalizeStationNetworkInput({ name: "x".repeat(101) }), /100/);
});

test("station membership uses explicit and revocable state transitions", () => {
  assert.equal(stationNetworkAgreementTransition({ currentStatus: "INVITED", action: "ACCEPT", actorSide: "STATION" }), "ACTIVE");
  assert.equal(stationNetworkAgreementTransition({ currentStatus: "INVITED", action: "DECLINE", actorSide: "STATION" }), "DECLINED");
  assert.equal(stationNetworkAgreementTransition({ currentStatus: "ACTIVE", action: "LEAVE", actorSide: "STATION" }), "REVOKED");
  assert.equal(stationNetworkAgreementTransition({ currentStatus: "ACTIVE", action: "REVOKE", actorSide: "NETWORK" }), "REVOKED");
  assert.throws(() => stationNetworkAgreementTransition({ currentStatus: "INVITED", action: "ACCEPT", actorSide: "NETWORK" }), /not available/);
  assert.throws(() => stationNetworkAgreementTransition({ currentStatus: "ACTIVE", action: "REVOKE", actorSide: "STATION" }), /not available/);
});

test("network summaries expose directory identity but never tenant operations", () => {
  const summary = stationNetworkAgreementSummary({
    id: "agreement-1", status: "ACTIVE", termsVersion: "v1", invitedAt: new Date(0), decidedAt: new Date(1), revokedAt: null,
    station: { id: "station-1", name: "Radio One", slug: "radio-one", status: "ACTIVE", providerAccountId: "secret-provider" },
    stationOrganisation: { id: "org-1", name: "Independent Radio", slug: "independent-radio", subscription: { id: "private" } },
    stationNetwork: { privateKey: "never" }
  });
  const serialized = JSON.stringify(summary);
  assert.match(serialized, /Radio One/);
  assert.doesNotMatch(serialized, /secret-provider|privateKey|subscription|streamConfig|analytics|credential/i);
});

test("Stage 19.19 routes enforce operator and station-owner boundaries", async () => {
  const [collection, network, invitations, decisions, service, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/radio-networks/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/radio-networks/[networkId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/radio-networks/[networkId]/agreements/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/radio-networks/[networkId]/agreements/[agreementId]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/station-network-service.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261020000000_stage_19_19_multi_station_network/migration.sql", import.meta.url), "utf8")
  ]);
  assert.match(collection, /membership\.role !== "OWNER"/);
  assert.match(network, /requireManagedStationNetwork/);
  assert.match(invitations, /station\.status !== "ACTIVE"/);
  assert.match(invitations, /requiresStationOwnerApproval/);
  assert.match(decisions, /canApproveStationNetworkAgreement/);
  assert.match(decisions, /STATION_NETWORK_MEMBERSHIP_/);
  assert.match(service, /status: \{ in: \["INVITED", "ACTIVE"\] \}/);
  assert.match(service, /participatingStationNetworkInclude/);
  assert.doesNotMatch(collection + network + invitations + decisions + service, /streamConfig|providerAccountId|passwordEncrypted|listenerAnalytics|mediaAssets/);
  assert.match(schema, /@@unique\(\[stationNetworkId, stationId\]\)/);
  assert.match(migration, /FOREIGN KEY \("stationId", "stationOrganisationId"\)/);
  assert.match(migration, /ON DELETE RESTRICT/);
});

test("station network fleet summaries remain linear at fleet scale", () => {
  const agreements = Array.from({ length: 10_000 }, (_, index) => ({ status: index % 2 ? "ACTIVE" : "INVITED" }));
  const started = performance.now();
  const summary = stationNetworkFleetSummary(agreements);
  assert.deepEqual(summary, { total: 10_000, invited: 5_000, active: 5_000, declined: 0, revoked: 0 });
  assert.ok(performance.now() - started < 1_500);
});
