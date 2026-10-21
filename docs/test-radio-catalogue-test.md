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

The only accepted target is existing `ruvanas_test_radio` on
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
