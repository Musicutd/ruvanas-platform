# Phase 3C: Campaign playout intents and playback evidence

Phase 3C compiles each applicable published campaign into immutable, player-specific promo insertions and carries those insertions through the existing signed player manifest and offline proof-of-play pipeline.

## Deterministic campaign compilation

- Every five-minute manifest window evaluates the player's organisation, brand, location groups, location, zone, local timezone, and opening hours.
- Published campaign dates, weekday windows, plays-per-hour, interval, exact-time, advanced-daypart, and smart-priority rules compile into local-time occurrences.
- Mandatory and higher-priority campaigns win deterministic conflicts while same-promo and any-promo separation limits remain enforced.
- Each accepted occurrence receives a globally unique, deterministic `scheduleItemId` bound to the player, campaign publication revision, published configuration hash, and planned start.
- Campaigns retain the exact approved promo version selected at publication. A later approved replacement does not silently change an already-published campaign.

## Immutable playout intent

`PlayoutIntent` records the organisation, player, zone, active channel, campaign, promo version, media asset, publication revision, source revision, and planned start. The player manifest exposes only same-origin media URLs and safe display metadata; storage keys remain private.

The player keeps normal music rotation active, interrupts music when a campaign insertion becomes due, records the interruption, plays the promotional asset, and resumes music. Campaign insertions already started on the device are remembered so a manifest refresh or page reload does not intentionally replay the same schedule item.

## Secure playback evidence

- Manifest proof tokens are signed for the player, manifest, schedule item, and exact content identity.
- Players report `STARTED`, `COMPLETED`, `FAILED`, or `INTERRUPTED` with a UUID event ID, schedule item ID, occurrence time, and device position.
- Offline events remain queued and retry in batches of at most 100.
- Event UUIDs are globally unique and duplicate retries are ignored by the database.
- Promo evidence must reference an existing player-specific playout intent, match the organisation, zone, and active channel assignment, and fall inside the permitted playback time boundary.
- Music and promo evidence share one ingestion endpoint and one reporting table without trusting campaign or promo attribution supplied by the browser.

## Compatibility and next milestone

Existing catalogue playback remains compatible and now also carries a signed schedule item ID. The Proof of Play operations page distinguishes music from promotions and shows campaign attribution and planned time.

Phase 3D adds organisation-scoped campaign aggregates by campaign, promo version, location, group, date, and hour, with planned-versus-started-versus-completed-versus-failed totals and asynchronous CSV export. See `docs/phase-3d-campaign-proof-reports.md`.

