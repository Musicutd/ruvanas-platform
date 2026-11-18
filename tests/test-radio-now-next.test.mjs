import test from "node:test";
import assert from "node:assert/strict";
import { buildTestRadioNowNext } from "../lib/test-radio-now-next.mjs";
import { TEST_RADIO_CONTINUOUS as P, continuousSourceFingerprint } from "../lib/test-radio-continuous-policy.mjs";

const iso = value => new Date(value).toISOString();
const start = "2026-10-24T08:00:00Z", end = "2026-10-24T09:00:00Z"; // 10:00 and 11:00 Malta.
function authorized(now) {
  const source = { providerKey: "CENTOVA_CAST", streamUrl: P.listenerUrl, serverHost: P.host, serverPort: P.port, sourcePort: P.port,
    sourceUsername: "", centovaUsername: P.account, bitrateKbps: 128, sourcePasswordEncrypted: "SECRET_SOURCE_PASSWORD", outboundAutoDjEnabled: false,
    encoderLeaseOwner: `${P.leasePrefix}worker-private`, encoderLeaseUntil: new Date(new Date(now).getTime() + 45_000), sourceConnectionStatus: "CONNECTED", lastError: null };
  return { station: { id: P.stationId, organisationId: "organisation-test-radio", productFamily: "ONLINE" }, source,
    grant: { id: "grant-private", stationId: P.stationId, organisationId: "organisation-test-radio", sourceFingerprint: continuousSourceFingerprint(source) },
    tracks: [1, 2].map(number => ({ fingerprint: `fingerprint-${number}`, durationSeconds: 180,
      track: { id: `track-${number}`, mediaAssetId: `asset-${number}`, title: `Song ${number}`, artist: "Artist", storageKey: "DO_NOT_RETURN_STORAGE_KEY" } })) };
}
const descriptor = number => ({ trackId: `track-${number}`, mediaAssetId: `asset-${number}`, fingerprint: `fingerprint-${number}`, durationSeconds: 180 });
const programme = (changes = {}) => ({ id: "saturday-mix", label: "Saturday Dance & Pop Mix", startsAt: start, endsAt: end, priority: 50, tracks: [descriptor(1), descriptor(2)], ...changes });
function runtime(now, occurrences = [programme()]) {
  return { enabled: true, stationId: P.stationId, channelId: "channel-test-radio", versionId: "approved-version-4", revisionFingerprint: "approved-revision-4",
    timezone: "Europe/Malta", effectiveAt: "2026-10-24T07:00:00Z", validUntil: iso(new Date(now).getTime() + 15_000), occurrences, warnings: [] };
}
function observation(auth, now, changes = {}) {
  return { grantId: auth.grant.id, leaseOwner: auth.source.encoderLeaseOwner, observedAt: iso(now), state: "STREAMING", audioBytesSent: 1024,
    trackId: "track-1", phase: "RANDOM", title: "UNTRUSTED_COPIED_TITLE", artist: "UNTRUSTED_COPIED_ARTIST", programme: null, ...changes };
}
function scheduled(auth, now, item = programme(), changes = {}) {
  return observation(auth, now, { phase: "SCHEDULED", programme: { occurrenceId: item.id, scheduleRevision: "approved-revision-4", label: "UNTRUSTED_PROGRAMME_LABEL", startsAt: item.startsAt, endsAt: item.endsAt }, ...changes });
}
function input(now, changes = {}) {
  const auth = authorized(now);
  return { authorized: auth, observation: observation(auth, now), runtime: runtime(now), now: new Date(now), ...changes };
}

test("before 10:00 the source is random, the next programme is planned and evidence expires at the boundary", () => {
  const result = buildTestRadioNowNext(input("2026-10-24T07:59:59Z"));
  assert.equal(result.source.confirmed, true); assert.equal(result.source.phase, "RANDOM"); assert.equal(result.source.expiresInMs, 1000);
  assert.equal(result.plan.current, null);
  assert.deepEqual(result.plan.next, { kind: "PROGRAMME", label: "Saturday Dance & Pop Mix", startsAt: iso(start), endsAt: iso(end) });
  assert.equal(result.timezone, "Europe/Malta"); assert.equal(result.plan.horizonLabel, "next two calendar days");
});

test("exactly 10:00 old random evidence is hidden, while a fresh scheduled source report is confirmed", () => {
  const data = input(start); data.observation = observation(data.authorized, "2026-10-24T07:59:59Z");
  const waiting = buildTestRadioNowNext(data);
  assert.equal(waiting.source.confirmed, false); assert.equal(waiting.source.phase, "UNKNOWN");
  assert.equal(waiting.plan.current.label, "Saturday Dance & Pop Mix"); assert.match(waiting.warnings.join(" "), /handover/);
  data.observation = scheduled(data.authorized, start);
  const fresh = buildTestRadioNowNext(data);
  assert.equal(fresh.source.confirmed, true); assert.equal(fresh.source.phase, "SCHEDULED");
  assert.equal(fresh.source.label, "Scheduled programme: Saturday Dance & Pop Mix");
  assert.deepEqual(fresh.source.track, { title: "Song 1", artist: "Artist" });
  assert.deepEqual(fresh.plan.next, { kind: "RANDOM", label: "Random AutoDJ", startsAt: iso(end) });
});

test("exactly 11:00 old programme evidence disappears even when the runtime has removed ended occurrences", () => {
  const data = input(end, { runtime: runtime(end, []) });
  data.observation = scheduled(data.authorized, "2026-10-24T08:59:59Z");
  let result = buildTestRadioNowNext(data);
  assert.equal(result.source.confirmed, false); assert.equal(result.source.track, null); assert.equal(result.plan.current, null);
  data.observation = observation(data.authorized, end);
  result = buildTestRadioNowNext(data);
  assert.equal(result.source.confirmed, true); assert.equal(result.source.phase, "RANDOM"); assert.equal(result.plan.next, null);
});

test("overlap transitions choose the effective winner, ignore shadowed starts, and show a return to the interrupted programme", () => {
  const base = programme({ endsAt: "2026-10-24T10:00:00Z" });
  const overlay = programme({ id: "priority-bulletin", label: "Priority bulletin", startsAt: "2026-10-24T08:30:00Z", endsAt: "2026-10-24T08:40:00Z", priority: 90 });
  const shadowed = programme({ id: "lower-priority", label: "Hidden lower priority", startsAt: "2026-10-24T08:10:00Z", endsAt: "2026-10-24T08:20:00Z", priority: 10 });
  const cases = [
    ["2026-10-24T08:05:00Z", "Saturday Dance & Pop Mix", "Priority bulletin", "2026-10-24T08:30:00Z"],
    ["2026-10-24T08:30:00Z", "Priority bulletin", "Saturday Dance & Pop Mix", "2026-10-24T08:40:00Z"],
    ["2026-10-24T08:40:00Z", "Saturday Dance & Pop Mix", "Random AutoDJ", "2026-10-24T10:00:00Z"]
  ];
  for (const [now, current, next, at] of cases) {
    const result = buildTestRadioNowNext(input(now, { runtime: runtime(now, [shadowed, overlay, base]), observation: null }));
    assert.equal(result.plan.current.label, current); assert.equal(result.plan.next.label, next); assert.equal(result.plan.next.startsAt, iso(at));
    assert.equal(result.source.confirmed, false, "The plan alone is never audio evidence");
  }
});

test("the newest draft cannot replace approved current or next programmes", () => {
  const data = input(start), original = buildTestRadioNowNext(data);
  data.draft = { version: 99, items: [programme({ label: "UNAPPROVED_DRAFT_PROGRAMME" })] };
  data.runtime.draft = data.draft; data.authorized.latestDraft = data.draft;
  assert.deepEqual(buildTestRadioNowNext(data), original);
  assert.doesNotMatch(JSON.stringify(original), /UNAPPROVED/);
});

test("rights-removed tracks cannot appear as source evidence or keep an ineligible programme in the plan", () => {
  const data = input(start); data.observation = scheduled(data.authorized, start);
  data.authorized.tracks = [data.authorized.tracks[1]];
  data.runtime.occurrences[0].tracks = [descriptor(1)];
  const result = buildTestRadioNowNext(data);
  assert.equal(result.source.confirmed, false); assert.equal(result.source.track, null); assert.equal(result.plan.current, null);
  assert.match(result.warnings.join(" "), /eligible recordings/);
});

test("source status is hidden for stale, mismatched, expired, errored or unverified evidence", () => {
  for (const mutate of [
    d => { d.observation.observedAt = iso(new Date(start).getTime() - 15_000); },
    d => { d.observation.observedAt = iso(new Date(start).getTime() + 1); },
    d => { d.observation.grantId = "another-grant"; },
    d => { d.observation.leaseOwner = "another-worker"; },
    d => { d.authorized.source.encoderLeaseUntil = new Date(start); },
    d => { d.observation.state = "ERROR"; },
    d => { d.observation.audioBytesSent = 0; },
    d => { d.observation.trackId = "not-authorized"; },
    d => { d.authorized.grant.sourceFingerprint = "changed-source"; },
    d => { d.authorized.source.lastError = "CONTINUOUS_STOP_UNCONFIRMED"; },
    d => { d.observation.programme.scheduleRevision = "old-revision"; },
    d => { d.runtime.enabled = false; },
    d => { d.runtime.validUntil = start; }
  ]) {
    const data = input(start); data.observation = scheduled(data.authorized, start); mutate(data);
    const result = buildTestRadioNowNext(data);
    assert.equal(result.source.confirmed, false); assert.equal(result.source.track, null); assert.equal(result.source.expiresInMs, 0);
  }
});

test("fresh random source during a planned programme is reported as observed, with a handover warning", () => {
  const result = buildTestRadioNowNext(input("2026-10-24T08:00:02Z"));
  assert.equal(result.source.phase, "RANDOM"); assert.equal(result.source.confirmed, true);
  assert.equal(result.plan.current.label, "Saturday Dance & Pop Mix"); assert.match(result.warnings.join(" "), /still shows random AutoDJ/);
});

test("freshness is bounded by the active lease and next effective transition", () => {
  const data = input("2026-10-24T08:59:59Z"); data.observation = scheduled(data.authorized, data.now);
  assert.equal(buildTestRadioNowNext(data).source.expiresInMs, 1000);
  data.authorized.source.encoderLeaseUntil = new Date(data.now.getTime() + 500);
  assert.equal(buildTestRadioNowNext(data).source.expiresInMs, 500);
});

test("foreign scope, malformed schedules and equal-priority overlaps are never promoted to a usable plan", () => {
  for (const mutate of [
    d => { d.authorized.station.id = "another-station"; },
    d => { d.authorized.grant.organisationId = "another-organisation"; },
    d => { d.runtime.stationId = "another-station"; },
    d => { d.runtime.occurrences[0].endsAt = d.runtime.occurrences[0].startsAt; },
    d => { d.runtime.occurrences.push(programme({ id: "conflict" })); },
    d => { d.runtime.occurrences.push(programme()); }
  ]) {
    const data = input(start); mutate(data);
    const result = buildTestRadioNowNext(data); assert.equal(result.plan.enabled, false); assert.equal(result.plan.current, null); assert.equal(result.plan.next, null);
  }
  assert.throws(() => buildTestRadioNowNext({ now: new Date("invalid") }), /valid status-check time/);
});

test("the DTO is an explicit bounded allowlist and never exposes stored secrets, URLs, identities or diagnostic text", () => {
  const data = input(start); data.observation = scheduled(data.authorized, start);
  data.runtime.warnings = ["DO_NOT_RETURN_DIAGNOSTIC https://private.invalid?secret=yes"];
  data.authorized.secret = "DO_NOT_RETURN_SECRET"; data.observation.secret = "DO_NOT_RETURN_OBSERVATION";
  data.authorized.tracks[0].track.title = "Song\u0000\n" + "x".repeat(500);
  const result = buildTestRadioNowNext(data), json = JSON.stringify(result);
  assert.deepEqual(Object.keys(result), ["stationId", "checkedAt", "timezone", "source", "plan", "warnings"]);
  assert.deepEqual(Object.keys(result.source), ["confirmed", "phase", "label", "track", "observedAt", "expiresInMs"]);
  assert.doesNotMatch(json, /SECRET|DO_NOT_RETURN|UNTRUSTED|https?:|grant-private|worker-private|fingerprint|sourcePassword|storageKey|leaseOwner|occurrenceId|scheduleRevision/);
  assert.equal(result.source.track.title.length, 240); assert.doesNotMatch(result.source.track.title, /[\u0000-\u001f\u007f]/);
  assert.match(result.warnings.join(" "), /approved schedule has warnings/);
});
