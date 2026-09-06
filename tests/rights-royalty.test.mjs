import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  aggregateRightsUsage,
  normaliseRightsAuthority,
  normaliseRightsReportFilters,
  normaliseRightsWorkMapping,
  rightsEvidenceHash,
  rightsUsageCsv
} from "../lib/rights-royalty.mjs";

test("authority profiles are bounded, territory-specific and provider-neutral", () => {
  assert.deepEqual(normaliseRightsAuthority({ code: " maltese_rights ", name: "Local Music Authority", territoryCode: "mt", reportFormat: "STANDARD_USAGE_V1" }), { code: "MALTESE_RIGHTS", name: "Local Music Authority", territoryCode: "MT", reportFormat: "STANDARD_USAGE_V1", active: true });
  assert.throws(() => normaliseRightsAuthority({ code: "x", name: "Authority", territoryCode: "MT" }), /2–24/);
  assert.throws(() => normaliseRightsAuthority({ code: "AUTH", name: "Authority", territoryCode: "MALTA" }), /two-letter/);
});

test("work mappings validate recognised recording and work identifiers", () => {
  const mapping = normaliseRightsWorkMapping({ recordingCode: "MT-ABC-26-00001", workCode: "T-123.456.789-0", composers: "Writer One, Writer Two", publishers: ["Publisher"], verified: true }, { title: "Song", artist: "Artist" });
  assert.equal(mapping.recordingCode, "MTABC2600001");
  assert.equal(mapping.workCode, "T1234567890");
  assert.deepEqual(mapping.composers, ["Writer One", "Writer Two"]);
  assert.throws(() => normaliseRightsWorkMapping({}, { title: "Song", artist: "Artist" }), /ISRC or ISWC/);
});

test("rights report periods require explicit attestation and remain bounded", () => {
  assert.deepEqual(normaliseRightsReportFilters({ authorityId: "authority-1", from: "2026-01-01", to: "2026-01-31", attestationAccepted: true }), { authorityId: "authority-1", from: "2026-01-01", to: "2026-01-31", attestationAccepted: true });
  assert.throws(() => normaliseRightsReportFilters({ authorityId: "authority-1", from: "2026-01-01", to: "2026-01-31" }), /attestation/);
  assert.throws(() => normaliseRightsReportFilters({ authorityId: "authority-1", from: "2024-01-01", to: "2026-01-31", attestationAccepted: true }), /366/);
});

test("usage evidence hashes are deterministic and change with material evidence", () => {
  const event = { sourceProofEventId: "proof-1", sourceClientEventId: "client-1", organisationId: "org-1", playerId: "player-1", stationId: "station-1", channelId: "channel-1", trackId: "track-1", mediaAssetId: "media-1", occurredAt: "2026-09-06T12:00:00.000Z", durationSeconds: 180, territoryCode: "MT", rightsUse: "ONLINE_RADIO", trackTitle: "Song", trackArtist: "Artist", rightsReference: "licence-1" };
  assert.equal(rightsEvidenceHash(event), rightsEvidenceHash({ ...event }));
  assert.notEqual(rightsEvidenceHash(event), rightsEvidenceHash({ ...event, durationSeconds: 181 }));
});

test("reports aggregate completed usage and disclose unmapped evidence", () => {
  const authority = { code: "AUTH", name: "Authority", territoryCode: "MT", reportFormat: "STANDARD_USAGE_V1" };
  const events = [
    { trackId: "t1", stationId: "s1", channelId: "c1", occurredAt: "2026-09-01T10:00:00Z", durationSeconds: 180, trackTitle: "Song", trackArtist: "Artist", rightsHolder: "Holder", rightsReference: "R1" },
    { trackId: "t1", stationId: "s1", channelId: "c1", occurredAt: "2026-09-01T12:00:00Z", durationSeconds: 175, trackTitle: "Song", trackArtist: "Artist", rightsHolder: "Holder", rightsReference: "R1" },
    { trackId: "t2", stationId: "s1", channelId: "c1", occurredAt: "2026-09-01T13:00:00Z", durationSeconds: 90, trackTitle: "=Unsafe", trackArtist: "Artist", rightsHolder: null, rightsReference: null }
  ];
  const report = aggregateRightsUsage({ authority, events, mappings: [{ trackId: "t1", title: "Mapped Song", primaryArtist: "Artist", recordingCode: "MTABC2600001", workCode: null, composers: ["Writer"], publishers: ["Publisher"], authorityReference: "A-1" }] });
  assert.deepEqual(report.summary, { usageEvents: 3, durationSeconds: 445, unmappedEvents: 1, mappedEvents: 2, evidenceBasis: "device-confirmed completed music playback", audienceMeasurement: false, royaltyCalculation: false });
  assert.equal(report.rows.find((row) => row.trackId === "t1").playCount, 2);
  assert.match(rightsUsageCsv(report), /"No","No"/);
  assert.match(rightsUsageCsv(report), /"'=Unsafe"/);
  const summaryReport = aggregateRightsUsage({ authority: { ...authority, reportFormat: "SUMMARY_USAGE_V1" }, events, mappings: [] });
  assert.equal(summaryReport.rows.length, 2);
  assert.equal(summaryReport.rows.find((row) => row.trackId === "t1").playCount, 2);
  assert.equal(summaryReport.rows.find((row) => row.trackId === "t1").stationId, null);
});

test("Stage 19.22 binds immutable ledger writes to verified proof ingestion", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20261023000000_stage_19_22_rights_royalty_reporting/migration.sql", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/player/proof-of-play/route.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("../lib/rights-royalty-service.js", import.meta.url), "utf8");
  const reportRoute = readFileSync(new URL("../app/api/reports/rights-royalty/exports/route.js", import.meta.url), "utf8");
  assert.match(schema, /model RightsUsageLedgerEvent/);
  assert.match(schema, /sourceProofEventId\s+String\s+@unique/);
  assert.match(migration, /RightsUsageLedgerEvent_immutable/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(service, /eventType === "COMPLETED"/);
  assert.match(route, /appendRightsUsageLedger/);
  assert.match(reportRoute, /requireActiveReportOrganisation/);
  assert.match(reportRoute, /ORGANISATION_MANAGER_ROLES/);
});
