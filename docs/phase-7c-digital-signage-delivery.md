# Phase 7C — secure Digital Signage delivery

Phase 7C turns the tenant-safe Stage 7B visual library, layouts, and display registrations into a controlled delivery system. It remains separate from the existing audio player so a signage failure cannot alter audio schedules, manifests, or proof-of-play records.

## Delivered scope

- Organisation content roles can prepare visual playlist drafts using tenant-owned ready images and regions from one tenant-owned layout.
- Playlists are assigned only to display devices owned by the same organisation.
- Daily local-time windows support all-week and overnight operation. Optional absolute start/end windows and explicit priority provide deterministic conflict resolution.
- Organisation management roles explicitly publish or pause a playlist. Draft content never reaches a display.
- A dedicated `/signage` application enrols with a single-use, 24-hour code and receives its own HTTP-only device session. Audio-player sessions are not accepted.
- The display manifest includes only safe layout geometry and same-origin media URLs. Storage keys and raw device credentials are never returned.
- Every visual item receives a device-, manifest-, item-, and asset-bound HMAC proof token.
- Displays refresh manifests regularly, cache verified images, retain the last verified manifest for a bounded 24-hour offline grace period, and queue a maximum of 500 display events for retry.
- STARTED, COMPLETED, and FAILED evidence is stored idempotently using device-generated event IDs.
- Heartbeats update the registered display's health information without affecting audio-player analytics.

## Security and evidence rules

- Every management route requires an authenticated, entitled organisation role and revalidates tenant ownership for layouts, regions, assets, and devices.
- A display can download only ready images referenced by a published playlist assigned to that exact device.
- Proof ingestion rejects invalid signatures, mismatched playlist items/assets/devices, events more than 30 days old, and excessive future clock skew.
- Cached delivery is bounded by the manifest offline-grace timestamp. Draft or unassigned content is never cached by the player.
- Display evidence means that a registered device reported a rendering event. It is not an audience count, impression, viewability measurement, or proof of commercial outcome.

## Deferred from this increment

Video upload/transcoding, emergency takeover workflows, visual Retail Media order fulfilment, multi-device bulk assignment, visual proof dashboards/exports, and combined audio/visual reporting remain Stage 7D work.
