# Test Radio: bounded owner catalogue diagnostic

This is a separate Super Admin diagnostic, not a new subscriber entitlement.
It is restricted to station `cmvcnbwi20008hr23sd76psi8`, Malta, FOCUSED catalogue
and a maximum 300-second absolute window including preparation. The normal
subscriber output flag, preview tester plan and catalogue output exclusions are
not changed. Nothing starts on import, build, deployment, GET, or preparation.

## Default release state

- `RUVANAS_CATALOGUE_TEST_START_ENABLED` is absent/false on the web service.
- No new worker or paid resource is created by this change.
- The web startup does not start the diagnostic worker.
- `node scripts/catalogue-test-worker.mjs` / `--check` validates and exits without
  opening a database, downloading media or making a source connection.
- The new Dockerfile also defaults to `--check`, not live output.

## Deliberate future activation

Before any actual start, verify costs and obtain the owner's separate explicit
approval for the bounded owner-only output capability and its actual audience.
The direct Centova listener URL is not access-controlled by Ruvanas. A hidden
directory entry or disabled Ruvanas public player does not make this stream
private. The documented Shoutcast v1 source on port8282 uses plaintext TCP
authentication; do not describe it as an encrypted source connection. If the
owner needs confidential source authentication, obtain a provider-supported TLS
source before running it. Never bypass browser/TLS certificate checks.
Malta catalogue filtering is not a listener geofence. Before enabling an actual
stream, verify that the intended audience and any provider-side listener access
or geographic restrictions satisfy the recordings' existing licences. Owner
approval of a test does not grant worldwide or additional music rights.

The only accepted target is existing `ruvanastestradio` on
`pollux.shoutca.st:8282`, MP3 128kbps, with Centova AutoDJ stopped and the existing
source password privately stored in Ruvanas. Do not reassign an unrelated
encoder, change passwords, create accounts, upgrade plans or enable normal
station output as an implementation shortcut.

Apply the reviewed additive Prisma migration on the verified intended database
before the new owner panel is used. The old one-off
`private-preview-access-migrate.mjs` intentionally refuses this later migration;
do not weaken or use that historical guard. Review the full live migration
history before the ordinary migration-deploy path. No automatic destructive
reset, history repair or seed is part of this feature.

For this release, `node scripts/catalogue-test-migrate.mjs --check` checks the
exact existing paid host, canonical origin, isolated database, disabled output
gates and the observed 128-entry migration baseline without writing. Only an
explicit `--apply` can invoke official Prisma deployment for the single pinned
new migration. It then verifies that the prior history is unchanged and the two
new tables and seven expected indexes exist. Imports, build and ordinary web
startup never run this command. Do not use reset, resolve, seed or substitute
credentials to make a failed preflight pass.

An existing, verified unused worker may deliberately run
`node scripts/catalogue-test-worker.mjs --serve-tests` only after both
`RUVANAS_CATALOGUE_TEST_ALLOW_LIVE=true` and
`RUVANAS_CATALOGUE_TEST_STATION_ID=cmvcnbwi20008hr23sd76psi8` are set. This
advertises a short dedicated lease but does not itself send audio. The web
service's separate start gate must then be deliberately enabled. An owner must
prepare a fresh random test, review its fixed songs, acknowledge public stream
exposure and click Start. A PREPARED row never runs; ARMED is single-use. A
crashed RUNNING test is never resumed or automatically retried.

## Rights and evidence

Every selected recording must retain an approved explicit rights declaration,
current licence window, Online Radio use, Malta territory, FOCUSED tier, approved
genre, private checksum-addressed media identity and unchanged stored fingerprint.
Only manually reviewed Ruvanas catalogue sources are allowed. Supplier-linked,
Promo Only and distributor-licence recordings remain excluded. This diagnostic
explicitly supports manually licensed catalogue assets using its own limited
owner grant; it does not relax `licensedCatalogue` exclusions in normal output.

The original owner password/SSO session, role, revocation, preview login state,
service window and current track/source approvals are checked repeatedly and
before each recording. Normal AutoDJ must remain off for the test. Socket and
decoder resources are independently force-closed at the earlier absolute or
monotonic deadline even if a database call, decoder or reporting operation hangs.
Unconfirmed closure quarantines the source for manual review, preserves its
temporary files and does not assert a successful stop.

The event log records observed source authentication and kernel-accepted MP3
bytes, including interrupted tracks. It does not claim that a listener heard
music and never fabricates Player/Zone identities, ProofOfPlayEvent or royalty
ledger rows. Listener audio and station source status must be verified separately
during an approved live test. This five-minute test does not demonstrate exact
schedule handovers, seamless song joins, or unattended 24/7 readiness.

The worker reads at most100MiB from existing R2 audio and writes no music to R2
or Centova storage. It uses verified local files and a fixed bundled FFmpeg
binary, with forced demuxers and a child environment containing no credentials.
This still uses public egress; do not promise it is free when the hosting account
has exhausted its included bandwidth.

## Owner listening panel (local fine-tuning)

The Test Radio-only owner panel uses the saved exact secure listener address,
`https://ruvanastestradio-radio105network.radioca.st/stream`. It does not substitute
the old HTTP player, accept a different station URL or enable any public player.
Native controls require the owner to press Play; `preload="none"` avoids fetching
audio merely by opening the setup page. Listening does not start an encoder or
arm a test. The direct Streamerr address remains unlisted, not access-controlled.

The displayed “Music sent to Streamerr” comes only from an observed `TRACK_AUDIO_SENT`
event mapped to its saved plan title and artist. Playlist elapsed time and source
authentication alone never become a song claim. The title is cleared on track
end, stop request, terminal test, deadline expiry or stale worker/polling data.
Every player snapshot expires within 15 seconds without a successful refresh;
the browser also stops local playback when the status becomes unavailable. This
does not replace the worker's independent source shutdown or suspend billing.

The HTTPS audio player may lag the encoder. Browser playback and source-send
records are diagnostics, not confirmation that a human heard music and not
royalty or device proof-of-play records. The existing owner, station, music-rights,
worker and separate start gates remain unchanged. This display does not update
Centova’s own now-playing metadata; that requires a separate source integration.

## Optional 90-second handover diagnostic

The owner may explicitly prepare `testMode=HANDOVER_90_SECONDS` with the existing
`FIVE_MINUTES` profile only. The server-issued authorization and fingerprint-bound
plan both record that exact mode. `durationSeconds` and `plan.targetSeconds` remain
300 seconds, including preparation and the absolute hard stop. Only this named
mode has `plan.audioDurationSeconds=90` and exactly three distinct approved media
recordings, each with a 30-second excerpt. No caller-supplied duration, timeline,
source URL or track list is accepted. Standard five-minute and one-hour plans are
unchanged, and no database migration or weekly-schedule write is needed.

The worker's bounded audio timeline demonstrates AutoDJ, a programme sample and
return to AutoDJ at 30-second boundaries; source-send observations, not a browser
timer, supply its phase/title display. It is a handover diagnostic, not a saved
weekly-planner programme and not proof of normal 24/7 scheduling readiness. The
existing rights, source, owner, lease, explicit-start and stop-confirmation checks
still apply, and rights must cover the whole five-minute maximum window.
