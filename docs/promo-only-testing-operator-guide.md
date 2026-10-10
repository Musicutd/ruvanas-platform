# Promo Only catalogue sync — testing operator guide

This is an additive testing integration for the existing Ruvanas Super Admin **Licensed Music Catalogue**. It does not create subscriber-owned libraries or replace playlists, scheduling, AutoDJ, rights review, media storage, or the generic distributor framework. It is **not a production licence or production rollout**.

Subscribers can request a safe, tier-filtered catalogue list at `GET /api/catalogue/music` (optional `channelId`, `q`, `genre`, `limit`). This returns labels and track IDs only, not audio or provider details. Existing playlist and AutoDJ paths continue to apply their server-side music eligibility rules. Promo Only requires an explicit country context; broad WORLDWIDE/EUROPE approval is not accepted. Germany remains excluded.

## Development recovery checkpoint

C8/C9 physical acceptance and external Pillar 7 approvals are deferred independently of this main-based development. No C8/C9 code, migration or deployment is needed for these supplier adapter corrections. Existing seven-family pricing and 127 main migrations are preserved.

This adapter accepts documented supplier IDs, not same-title recording guesses. Release responses retain their own ID, title and date. Metadata updates preserve takedowns and reviewed rights; stale revisions cannot replace newer metadata. Imported global tracks may be quarantined, but customer-owned media and playlist identities are not overwritten. Artwork URLs and audio formats are retained as metadata, not fetched or treated as rights grants.

Token expiry and positive download acknowledgement are checked. JSON is bounded to 2 MiB; metadata retries honor bounded Retry-After, and ambiguous queue/confirmation failures are not automatically replayed. Provider OFF or a paused/revoked connection denies existing imports at selection and final player delivery. An old playback intent is not sufficient authority.

`node scripts/promo-only-connectivity.mjs --check` checks only environment prerequisites and makes no request. Explicit `--live` performs the documented authentication and token-validation calls only, with no catalogue import, audio download, database write or secret output. Use only approved server environment credentials; do not paste secrets into chat or browser fields. Connectivity success does not prove commercial rights.

The [public API terms](https://api.promoonly.com/doc/tos) restrict commercial streaming and third-party webcasting integration. Before licensed playback, verify the separate written agreement, exact countries and expiry, supplier product-to-tier mapping, and storage/delivery rights. Empty approved connection scopes intentionally block ENABLE. Top 40, Audio Silver and Audio Gold are Ruvanas tier labels, not assumed supplier products. Offline supplier delivery remains unavailable without separate caching permission.

## Safe rollout

1. Keep `PROMOONLY_ENABLED=false` until the Promo Only agreement, API account, approved feed URL and rights for the intended Ruvanas product uses and territories are confirmed. The examples in `.env.example` contain no secrets.
2. Apply the migration `20261124000000_promo_only_testing_sync` in a test database and run the existing operations worker. Never run a production migration from a local test merely to inspect the UI.
3. Set `PROMOONLY_ENABLED=true`, `PROMOONLY_MODE=DISCOVERY`, and a vetted HTTPS `PROMOONLY_RSS_URL` on the server and worker. Inspect `/admin/promo-only` as Super Admin. This phase fetches RSS only; it does not authenticate to the POOL API or download audio.
4. When API access is authorised, set server-only `PROMOONLY_USER_ID`, `PROMOONLY_API_KEY`, `PROMOONLY_API_SECRET`, and `PROMOONLY_MODE=METADATA`. RSS items are enriched in batches with provider IDs, title, artist, mix, BPM, genre and other available metadata. Missing metadata remains a safe failed/retryable item. Existing DISCOVERY records are picked up after switching modes.
5. Review provider genre mappings. Existing genre names are reused where possible; new source genres retain their original spelling and provenance. If `PROMOONLY_GENRE_REVIEW_REQUIRED=true`, new genres remain pending until reviewed. Remap, alias, rename, merge, approve or deactivate only in Super Admin. Review tier assignments separately from provider ingestion.
6. To test *one* audio item, explicitly set `PROMOONLY_MODE=AUDIO_TEST` and `PROMOONLY_AUDIO_DOWNLOAD_ENABLED=true` on the server. As Super Admin choose **Import test audio**. The provider must accept its queue request for that track and grant an audio media type; server hosts are allow-listed, redirects are refused, and bytes are capped. For the provider's bare server hostname, Ruvanas tries HTTPS only by default. Files enter protected master catalogue storage as **draft/unapproved**, never subscriber playback automatically. Check the stored metadata and licence evidence before any approval.
7. **Approve rights and enable** only when the rights reference genuinely authorises storage, delivery, territory, tier and the applicable Ruvanas uses. Enter those uses and territories explicitly; no use or worldwide territory is inferred from the feed. A test API credential or downloaded file by itself is not such authorisation. A provider metadata change after import quarantines the track for reconciliation. Use the existing protected master catalogue and normal playback eligibility checks to verify the allowed tier; lower tiers and other tenants must not gain access.
8. To stop: set `PROMOONLY_ENABLED=false` and `PROMOONLY_AUDIO_DOWNLOAD_ENABLED=false`; retain run, audit and reconciliation records. `PROMOONLY_MODE=PRODUCTION` is deliberately rejected by code, not a switch to try.

## Configuration and privileges

The dedicated worker uses the same server-only environment settings. A Super Admin is required for manual synchronisation, genre management, tier changes, metadata refresh and audio import. No subscriber route can invoke provider credentials or download operations. `PROMOONLY_DOWNLOAD_ROLE` is fixed to `SUPER_ADMIN`; an invalid value fails closed. `PROMOONLY_MAX_DOWNLOADS_PER_RUN` is reserved for a future bounded batch download; this build allows only one explicitly selected audio import per request and has **no automated audio batch**. RSS discovery and metadata run on the existing operations worker (no new paid service).

The Promo Only documentation specifies an HTTP media-server download URL while its API endpoints are HTTPS. Ruvanas requires HTTPS by default and does not silently fall back. Verify supplier HTTPS delivery before audio testing. The legacy server-only HTTP testing flag is preserved for compatibility, but enabling it is not authorised by this recovery scope; never use it for live or commercial rollout. Host and redirect checks do not encrypt HTTP traffic or prove DNS results cannot change.

The first available server hostname from the queue response must match the provider's separate available-server list with a positive server ID. An acknowledgement failure leaves the item for reconciliation, not another blind download. Provider responses are kept in the admin-only integration records, never in subscriber DTOs. A rejected rights/genre record is not AutoDJ-ready.

## Troubleshooting and recovery

- `PROMOONLY_CONFIG_INVALID` or a mode error: inspect server environment settings, not browser input. No secrets are shown in the panel.
- RSS error: check a vetted HTTPS feed, timeout, response size, XML validity, or a feed with more than 250 entries (the testing build fails rather than silently truncating it). A 304 response still allows pending DISCOVERY/FAILED_RETRYABLE metadata items to be processed.
- API authentication error: confirm the three server credentials and Promo Only account entitlements; do not paste them into support requests or a subscriber page.
- Genre pending/unmapped: approve or remap the source genre; do not manufacture a genre from a filename or infer an audio right from RSS.
- Queue or media error: confirm the track is in that POOL account's distribution and is an audio format; inspect the safe error code. Duplicate checks reject an existing protected checksum.
- `RECONCILIATION_REQUIRED`: compare imported evidence and provider metadata, resolve the acknowledgement or rights issue manually. Never re-download a linked item merely to retry an acknowledgement.
- A stalled sync may retain a lease for up to one hour. Investigate the run and worker before retrying. Do not erase records or force a production mode.

## Local verification and release gate

`node --test tests/promo-only-testing.test.mjs` covers disabled defaults, production lock, RSS entities and unsafe XML, metadata fields, token expiry, media-server allow-list, documented server ID/acknowledgement path, role checks and tier/Studio fail-closed behavior. Run the full suite, Prisma validation/generation, static checks and build before proposing deployment.

Not verified by local tests: a real Promo Only account/contract, actual RSS shape and distribution entitlement, real audio download, database migration against a production-like copy, rights scope for commercial streaming, browser end-to-end acceptance, operations worker live polling and rollback. These are release gates. Do not represent the integration as live until each passes with provider approval.

Official API contracts: [authentication](https://api.promoonly.com/doc/token), [track information](https://api.promoonly.com/doc/track_info), [queue](https://api.promoonly.com/doc/queue_download), [available servers](https://api.promoonly.com/doc/download_servers), [media download](https://api.promoonly.com/doc/download_file), [acknowledgement](https://api.promoonly.com/doc/download_success).
