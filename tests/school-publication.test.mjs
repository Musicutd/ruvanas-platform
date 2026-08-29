import assert from "node:assert/strict";
import test from "node:test";

import {
  consentRecordIsCurrent,
  controlledPublicationSnapshot,
  redactPublicPodcastEpisode,
  resolvePublicationConsentCoverage,
  validateControlledSchoolPublication
} from "../lib/school-publication.mjs";

const now = new Date("2026-09-19T12:00:00.000Z");

test("controlled school publishing requires every independent safety control", () => {
  const ready = {
    entitlementEnabled: true,
    profilePolicy: "PUBLIC",
    safeguardingStatus: "APPROVED",
    episodeStatus: "APPROVED",
    hasApprovedAudio: true,
    transcriptStatus: "APPROVED",
    contributorIds: [],
    consentRecords: [],
    now
  };

  assert.throws(() => validateControlledSchoolPublication({ ...ready, entitlementEnabled: false }), /not enabled/);
  assert.throws(() => validateControlledSchoolPublication({ ...ready, profilePolicy: "PRIVATE" }), /policy/);
  assert.throws(() => validateControlledSchoolPublication({ ...ready, safeguardingStatus: "CHANGES_REQUESTED" }), /safeguarding/);
  assert.throws(() => validateControlledSchoolPublication({ ...ready, episodeStatus: "IN_REVIEW" }), /staff-approved/);
  assert.throws(() => validateControlledSchoolPublication({ ...ready, hasApprovedAudio: false }), /audio/);
  assert.throws(() => validateControlledSchoolPublication({ ...ready, transcriptStatus: "NEEDS_REVIEW" }), /transcript/);
  assert.deepEqual(validateControlledSchoolPublication(ready), { allowed: true, scope: "PUBLIC", consentRecordIds: [] });
});

test("latest applicable consent must be granted, current, and unrevoked for each contributor", () => {
  const granted = { id: "consent-1", contributorId: "student-1", status: "GRANTED", grantedAt: "2026-09-01T00:00:00.000Z", expiresAt: null, revokedAt: null, createdAt: "2026-09-01T00:00:00.000Z" };
  const revoked = { id: "consent-2", contributorId: "student-1", status: "REVOKED", grantedAt: null, expiresAt: null, revokedAt: "2026-09-18T00:00:00.000Z", createdAt: "2026-09-18T00:00:00.000Z" };
  const second = { id: "consent-3", contributorId: "student-2", status: "GRANTED", grantedAt: "2026-09-02T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", revokedAt: null, createdAt: "2026-09-02T00:00:00.000Z" };

  assert.equal(consentRecordIsCurrent(granted, now), true);
  assert.equal(consentRecordIsCurrent({ ...granted, expiresAt: "2026-09-10T00:00:00.000Z" }, now), false);
  assert.equal(resolvePublicationConsentCoverage({ contributorIds: ["student-1", "student-2"], consentRecords: [granted, revoked, second], now }).complete, false);
  const restored = { ...granted, id: "consent-4", createdAt: "2026-09-19T00:00:00.000Z" };
  assert.deepEqual(
    resolvePublicationConsentCoverage({ contributorIds: ["student-1", "student-2", "student-1"], consentRecords: [granted, revoked, second, restored], now }).currentConsentRecordIds,
    ["consent-4", "consent-3"]
  );
});

test("public podcast output is redacted and publication snapshots are immutable", () => {
  const podcast = {
    id: "podcast-1",
    accessibleDescription: "An accessible introduction.",
    chaptersJson: [{ startMs: 0, title: "Opening" }],
    publishedAt: now,
    updatedAt: now,
    series: { title: "Student Voices" },
    episode: {
      id: "private-episode-id",
      title: "Community update",
      summary: "A staff-approved school update.",
      programme: { title: "Morning News" },
      contributors: [{ contributorId: "private-student-id", contributor: { displayName: "Private Student" } }]
    },
    transcript: { segmentsJson: [{ startMs: 0, endMs: 1000, text: "Welcome", speaker: "Private Student" }] },
    publicationDecisions: [{ actorUserId: "private-staff-id", consentRecordIds: ["private-consent-id"] }]
  };
  const redacted = redactPublicPodcastEpisode(podcast);
  const serialized = JSON.stringify(redacted);
  assert.equal(redacted.transcript[0].text, "Welcome");
  assert.equal("speaker" in redacted.transcript[0], false);
  assert.equal(serialized.includes("private-student-id"), false);
  assert.equal(serialized.includes("private-staff-id"), false);
  assert.equal(serialized.includes("private-consent-id"), false);

  const snapshot = controlledPublicationSnapshot({ organisationId: "org-1", podcastEpisodeId: "podcast-1", profilePolicy: "PUBLIC", safeguardingStatus: "APPROVED", contributorIds: ["student-1"], consentRecordIds: ["consent-1"], publicationRevision: 2 });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.publicationRevision, 2);
});
