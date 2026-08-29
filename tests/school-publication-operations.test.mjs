import assert from "node:assert/strict";
import test from "node:test";
import {
  normaliseSchoolPublicationFilters,
  schoolPublicationDayBucket,
  schoolPublicationEvidenceCsv,
  schoolPublicationRetentionPreview,
  SCHOOL_PUBLICATION_EVIDENCE_NOTICE
} from "../lib/school-publication-operations.mjs";

test("school publication evidence uses canonical UTC days and bounded report windows", () => {
  assert.equal(schoolPublicationDayBucket("2026-08-29T22:34:56.000Z").toISOString(), "2026-08-29T00:00:00.000Z");
  assert.deepEqual(
    normaliseSchoolPublicationFilters({ from: "2026-08-01", to: "2026-08-29" }),
    { from: "2026-08-01", to: "2026-08-29", days: 29, fromInstant: new Date("2026-08-01T00:00:00.000Z"), until: new Date("2026-08-30T00:00:00.000Z") }
  );
  assert.throws(() => normaliseSchoolPublicationFilters({ from: "2026-01-01", to: "2026-08-29" }), /limited to 93 days/);
  assert.throws(() => normaliseSchoolPublicationFilters({ from: "2026-08-30", to: "2026-08-29" }), /must not be after/);
});

test("school retention operations remain a non-destructive preview", () => {
  const preview = schoolPublicationRetentionPreview(
    { status: "APPROVED", rawRecordingRetentionDays: 30, consentEvidenceRetentionDays: 365 },
    new Date("2026-08-29T12:00:00.000Z")
  );
  assert.equal(preview.rawRecordingCutoff, "2026-07-30T12:00:00.000Z");
  assert.equal(preview.consentEvidenceCutoff, "2025-08-29T12:00:00.000Z");
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.destructiveActionPerformed, false);
});

test("school publication CSV reports delivery evidence without audience claims", () => {
  const csv = schoolPublicationEvidenceCsv({ episodes: [{
    title: "=Unsafe title",
    series: "School news",
    days: [{ date: "2026-08-29", metadataListingCount: 3, audioRequestCount: 2, fullAudioRequestCount: 1, rangeAudioRequestCount: 1, audioBytesOffered: "4096" }]
  }] });
  assert.match(csv, /Metadata listings/);
  assert.match(csv, /Audio delivery requests/);
  assert.match(csv, /Listener or audience measured/);
  assert.match(csv, /"No"/);
  assert.match(csv, /'=Unsafe title/);
  assert.match(SCHOOL_PUBLICATION_EVIDENCE_NOTICE, /does not identify listeners/);
  assert.match(SCHOOL_PUBLICATION_EVIDENCE_NOTICE, /does not.*audience size/i);
});
