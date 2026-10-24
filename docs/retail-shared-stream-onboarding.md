# Retail shared stream onboarding

## Agreed product behaviour

Each Retail subscriber has one shared music programme and one streaming output for all of its shops. Different subscribers have separate programmes and credentials. The first pilot account is `retail@manuelchircop.com`; an account identifier is not permission to provision paid capacity or start broadcasting.

Retail Enterprise may support multiple independent streams in a later release. Keep the organisation-to-stream relationship extensible, but reject multiple outputs in this first increment, including for Enterprise. Adding a shop or digital display must not create another encoder or stream.

Reuse the central Ruvanas music catalogue, including eligible Promo Only recordings, without duplicating music files or R2 credentials for each customer. Existing product, plan, territory and provider permissions remain playback requirements. Catalogue visibility alone does not authorize Retail playback.

## Draft implementation boundary

This increment provides a reusable Super Admin draft form, an organisation-scoped API and a transactional persistence service. Website publication and any real subscriber save must be verified separately in the release evidence. Publishing this code does not configure Retail credentials, provider accounts or workers.

`/admin/retail-stream` resolves the existing `retail@manuelchircop.com` account to a unique eligible Retail organisation. Missing or ambiguous memberships require review; the page does not create accounts, change membership or switch the subscriber's active organisation. The reusable organisation screen is `/admin/organisations/[organisationId]/retail-stream`.

The form saves only connection details through `/api/admin/organisations/[organisationId]/retail-stream`. The server rechecks the current Super Admin role, Retail service and plan, encrypts the exact source-password bytes, and creates one private, disconnected Retail draft. It does not collect the Centova administrator password. Saved credentials are represented only by a configured indicator; changing a saved destination identity or replacing its password requires a separate review.

An unchanged retry preserves the saved draft without another write or audit entry. An uncertain browser save clears the entered password and requires a reload rather than automatically retrying. Existing station limits are never reconciled silently to revised plan values: a mismatch blocks the connection form for review.

A valid plan means its input passed local policy and syntax checks only. It does not prove that DNS is public, a password works, the listener endpoint returns audio, a worker has capacity, music is cleared, or streaming fits an approved budget. It must never be treated as permission to start audio.

This increment leaves Test Radio, registration, existing channels, published plans, subscription records and live services unchanged. Test Radio's monthly allowance does not authorize additional Retail hosting costs.

## Independent plan allowances

The owner will revise site counts, bitrate and digital-display allowances. Keep current public values unchanged until those revisions are supplied and approved.

The future plan model needs independent fields for:

- Sites: how many shop locations the subscriber may manage.
- Streams: how many independent programmes can be delivered simultaneously; one for the initial shared-stream product.
- Bitrate: the maximum permitted output quality, checked against the actual connection and capacity.
- Displays: how many digital-signage displays may be connected.

`lib/entitlements.mjs` currently derives both `streamLimit` and `digitalSignageDisplayLimit` from `plan.stationLimit`. The new draft helper must not silently migrate those values or infer a stream count from shop or display counts. Optional explicit site and display values are metadata, not new commercial entitlements. Missing values require plan review.

## Implemented draft safeguards

The intended administrator workflow is to select an authorised Retail organisation, enter its Centova connection details once, validate the connection, and activate only after approval. Shared platform configuration and catalogue storage stay server-side. The local draft increment implements these boundaries:

1. Fresh server authority and plan checks, including the existing organisation-wide station allowance across products. Client-supplied permissions, plan ceilings, activation flags and tenant ownership are rejected. POST requests require the configured site origin and a bounded, allowlisted body; responses are private and uncached.
2. Explicit Retail draft creation. Output, probing, public players, station websites and listener requests are false, with no channel or encoder lease. The schema's default for `probeEnabled` is true, so the writer sets it to false explicitly.
3. A deterministic organisation identity, serializable transactions and an advisory lock shared by this new writer. Current Retail duplicates, reserved Test Radio targets, conflicting station sources and Studio destinations block saving. Ambiguous legacy inventory requires review. Running or leased profiles cannot be adopted or reset.
4. Exact source-password encryption with secret-free response projection and audit details. Only synthetic credentials are used in local tests.
5. Exact-identity lifecycle restrictions. These new managed Retail drafts cannot use generic setup, manual probing, station activation or streaming-profile writes. Their subscriber Listen and station screens do not offer playback or present a saved draft as live. Existing Retail stations and Test Radio retain their current paths.

Existing required station limits, including listener, storage and bitrate limits, must come from the fresh authorised plan. Missing limits block setup rather than creating guessed defaults. An unchanged retry must be safe; changed credentials or an existing running profile require an explicit update path.

## Required before live Retail activation

The new writer's lock is not used by all legacy writers, and the schema has no global source-assignment uniqueness constraint. Before activation, all relevant writers must share a collision strategy or database constraint; draft validation does not certify global uniqueness or provider ownership.

Readiness checks must validate DNS, redirects and endpoints through the existing SSRF-safe network boundary. Syntax validation alone is insufficient. Those checks must not start Centova, AutoDJ or an encoder.

A reusable capacity manager must allocate an isolated Retail output. That manager does not yet exist. Do not widen Test Radio's dedicated worker or repurpose its credentials, account or port. Adding a shop must not create a paid worker.

Check capacity and estimated recurring costs, obtain approval before any additional cost, then run a separately authorised Retail pilot. Verify audible output, exact-time handovers, recovery and stopping behaviour before unattended service. Website publication alone must not activate Retail streaming.

## Catalogue and playback integration

`app/api/catalogue/music/route.js` already supports Retail catalogue selection under its organisation, location, entitlement and rights checks. Reuse those checks, not the Online Radio preview exception. Promo Only production playback remains subject to `lib/promo-only-playback.mjs`.

The current Retail playback path uses protected location and zone players. `lib/retail-area-channel.mjs` and `lib/retail-music-setup.mjs` must not be relabelled as Online Radio or attached to Test Radio to obtain streaming. The shared Centova output needs its own deliberate integration, while preserving shop ownership, device reporting and existing customer behaviour.

## Release acceptance

Before a Retail release, verify cross-organisation isolation, repeated and concurrent setup requests, duplicate endpoints, stale permissions, missing plan limits, secret redaction and protected live configurations. Verify that multiple shops share one programme without consuming multiple outputs, while Enterprise multi-stream remains disabled.

Integration acceptance must also cover catalogue eligibility, output-capacity allocation, exact-time programme handovers, return to random AutoDJ, recovery after interruption, and cost estimation. Test Radio must remain running throughout Retail preparation; registration remains closed and unrelated channels must not be modified.

## Local verification on 24 October 2026

The focused regression run passed 184 tests with no failures or skips. It covers the new policy, persistence service, HTTP boundary, actual rendered form and pages, managed-draft lifecycle restrictions, existing Retail features, player and station behaviour, Test Radio's continuous policy, plan entitlements and closed registration. Persistence tests use an injected transactional simulation, not a real PostgreSQL instance or subscriber records.

Repository static integrity checks passed. Production compilation was checked with telemetry disabled and an intentionally unreachable local database address. Existing static pages logged unavailable-database messages and existing Online Radio/Studio CSS warnings; this does not establish live database, provider or audio readiness. Visual browser inspection and a real draft-save acceptance check remain part of a controlled release.

No migration, dependency upgrade, live account change, credential entry, deployment or new paid resource is included in this local work. Preserve unrelated working-tree edits when preparing a release.
