# Music distributor integration foundation

## Purpose and release boundary

Ruvanas can connect one or more approved music distributors to the central Licensed Music Catalogue. The connection imports supplier identifiers, metadata, delivery references and rights—not customer accounts. Ruvanas still enforces each subscriber's plan, product use, territory and licence window before a track can become eligible.

This foundation is provider-neutral. It is ready for a supplier sandbox and mapping adapter, but it does **not** make supplier audio playable automatically. Download ingestion into protected Ruvanas storage or supplier-authorised protected streaming must be completed and accepted against the distributor's actual API, delivery rules and licence before linking a distributor record to a production `Track`.

API access is not itself a music licence. The signed agreement must grant the relevant reproduction, storage, streaming, public-performance and reporting uses in every enabled product and territory.

## Authentication and secret handling

- OAuth 2.0 client credentials is the only supported authentication type.
- The client ID and client secret are encrypted at rest with the existing Ruvanas AES-256-GCM secret facility.
- Credentials are never returned to the browser, audit log or worker log.
- Token and API endpoints must use HTTPS, the standard HTTPS port and no embedded credentials.
- Redirects are refused and requests have a 30-second timeout.
- New connections are `DRAFT`; a Super Admin must pass an OAuth authentication test within the previous 24 hours before deliberately activating them. Rotating credentials returns the connection to Draft and requires a fresh test.
- Use separate sandbox and production credentials. Give Ruvanas only the catalogue-read, delivery-read and usage-write scopes actually required.

## Ruvanas distributor contract v1

The generic catalogue endpoint is requested with a bearer token and an `Accept` profile of `ruvanas-distributor-v1`. Pagination uses `?cursor=...&limit=2000`.

```json
{
  "cursor": "opaque-next-cursor",
  "hasMore": false,
  "releases": [
    {
      "id": "release-123",
      "title": "Release title",
      "label": "Label name",
      "releaseDate": "2026-09-15",
      "status": "ACTIVE"
    }
  ],
  "collections": [
    {
      "id": "collection-focused",
      "name": "Focused catalogue",
      "minimumCatalogueLevel": "FOCUSED",
      "permittedTerritories": ["MT", "GB"],
      "permittedUses": ["RETAIL_RADIO"],
      "active": true
    }
  ],
  "tracks": [
    {
      "id": "track-123",
      "recordingId": "recording-123",
      "releaseId": "release-123",
      "collectionIds": ["collection-focused"],
      "isrc": "MTABC2600001",
      "title": "Track title",
      "artist": "Artist name",
      "album": "Album title",
      "label": "Label name",
      "genres": ["Pop"],
      "explicit": false,
      "delivery": {
        "mode": "DOWNLOAD",
        "url": "https://supplier.example/delivery/track-123",
        "checksumSha256": "64-lowercase-hex-characters",
        "mimeType": "audio/flac",
        "sizeBytes": 12345678
      },
      "minimumCatalogueLevel": "FOCUSED",
      "permittedTerritories": ["MT", "GB"],
      "permittedUses": ["RETAIL_RADIO"],
      "licenceStartsAt": "2026-01-01",
      "licenceExpiresAt": "2027-12-31",
      "rightsHolder": "Rights holder",
      "rightsReference": "agreement-or-grant-id",
      "status": "ACTIVE",
      "takedownReason": null
    }
  ]
}
```

Accepted values:

- Delivery: `DOWNLOAD`, `PROTECTED_STREAM`
- Catalogue: `FOCUSED`, `PROFESSIONAL`, `PREMIUM`
- Status: `ACTIVE`, `TAKEN_DOWN`, `UNAVAILABLE`
- Product use: `RETAIL_RADIO`, `SCHOOL_RADIO`, `ONLINE_RADIO`, `HEALTH_RADIO`, `FAITH_RADIO`, `ORGANISATIONS_RADIO`
- Territory: ISO 3166-1 alpha-2 code or `WORLDWIDE`

Ruvanas rejects unknown fields, invalid dates, invalid ISRCs, missing delivery URLs, duplicate response IDs, reversed licence windows, unsafe URLs and over-sized pages.

## Tier policy

The supplier can map a collection or individual track to the minimum catalogue level. Track-level values take precedence; a connection default is used only when the supplier omits a value.

| Subscriber plan entitlement | Supplier catalogue access |
| --- | --- |
| `NONE` | No distributor catalogue |
| `FOCUSED` | Focused tracks only |
| `PROFESSIONAL` | Focused and Professional tracks |
| `PREMIUM` | Focused, Professional and Premium tracks |

Catalogue tier never overrides territory, product-use, licence-window, explicit-content or takedown controls. All controls must pass.

## Synchronisation and reconciliation

- Full and cursor-based delta synchronisation are supported.
- Active connections are polled by the existing operations worker at the configured interval (minimum 15 minutes).
- Every release, collection and track has an external supplier ID and a deterministic metadata checksum.
- Reconciliation records distinguish created, updated, unchanged, rights-changed, taken-down, restored, duplicate and rejected states.
- Duplicates are detected by audio SHA-256 first, then ISRC. They are recorded and rejected rather than silently merged.
- Rights or metadata changes increment the track revision and leave an audit trail.
- A supplier or Super Admin takedown immediately makes the distributor item ineligible and archives any linked production track.
- Restoration does not silently re-enable a production track; it remains subject to review and production linkage.
- Failed syncs use bounded exponential backoff, mark the connection degraded and expose a safe error code.
- Work leases prevent multiple operations workers from running the same catalogue sync simultaneously.

For genuinely immediate takedowns, the distributor should provide a signed webhook specification. Until that adapter is agreed, the configured polling interval and Super Admin emergency-takedown action are the available paths.

## Usage reporting

Reports contain only the distributor track ID, ISRC, event ID, playback time, duration, territory and rights use. Subscriber names, listener identities and email addresses are excluded.

The first delivery freezes an immutable report payload and SHA-256 hash. Retries use the exact same payload and idempotency key. Failed deliveries retry with bounded exponential backoff and are abandoned after five failed attempts for Super Admin review.

The distributor must confirm reporting period, timezone, accepted event granularity, response/acknowledgement semantics, corrections and retention requirements before production use.

## Super Admin workflow

1. Open **Administration → Platform operations → Music distributors**.
2. Enter the supplier's sandbox endpoints, OAuth scopes, credentials, default tier, territories and product uses.
3. Create the connection as a Draft.
4. Test OAuth authentication.
5. Run a small sandbox catalogue sync and review rejected/duplicate/reconciliation records.
6. Confirm the signed licence and audio delivery model.
7. Activate scheduled synchronisation only after acceptance.
8. Deliver a test usage period and have the distributor confirm reconciliation.

## Information required from the distributor

Bring these decisions out of the technical and commercial meeting:

1. Sandbox and production base URLs, OAuth token URL, client-authentication method and scopes.
2. OpenAPI specification plus sample catalogue, delta, takedown and usage payloads.
3. Stable release, recording, track and collection identifier definitions.
4. Audio delivery method, formats, checksums, URL lifetime, CDN allow-listing and storage permission.
5. Tier/collection definitions and whether individual tracks can override them.
6. Exact territory and permitted-use vocabulary, licence windows and explicit-content policy.
7. Update frequency, cursor semantics, historical backfill and new-release timing.
8. Immediate takedown SLA and signed-webhook authentication/replay rules.
9. Duplicate, replacement, re-release, remaster and changed-ISRC rules.
10. Usage-report schema, frequency, acknowledgements, corrections and dispute process.
11. Rate limits, retry guidance, maintenance windows, support escalation and audit retention.
12. The executed licence schedule covering all proposed Ruvanas product families and countries.

## Implemented coverage of the requested areas

1. OAuth 2.0 client credentials: implemented.
2. Distributor release/recording/track IDs: implemented.
3. Strict metadata and ISRC validation: implemented.
4. Download/protected-stream delivery references: modelled and encrypted; provider-specific production transport remains gated.
5. Track/collection tier mapping: implemented.
6. Territory and product-use mapping: implemented.
7. Full/delta update synchronisation: implemented.
8. Takedown processing: implemented through sync and emergency Super Admin control; webhook adapter awaits supplier contract.
9. Licence-window updates: implemented.
10. Duplicate detection: implemented.
11. Privacy-safe usage reporting: implemented.
12. Metadata/rights reconciliation: implemented.
13. Monitoring, retry and audit records: implemented through the operations worker and Super Admin console.
