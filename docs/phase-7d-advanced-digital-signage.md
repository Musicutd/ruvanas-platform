# Phase 7D — Advanced Digital Signage

Stage 7D completes the advanced delivery layer introduced in Stages 7B and 7C without changing the existing audio player.

## Delivered scope

- Signature-validated MP4 and WebM upload with protected, queued server-side normalization to a browser-safe MP4 output.
- Processing-state enforcement: a video cannot enter or publish in a playlist until the worker has probed, normalized, and verified it.
- Image and video playback in the dedicated `/signage` player, with device-confirmed start, completion, and failure events.
- Bulk playlist assignment to multiple tenant-owned display devices.
- Explicit, manager-controlled visual takeovers with a maximum 24-hour window, automatic expiry, device-specific scope, conflict prevention, and a complete audit trail.
- Takeover precedence in the signed signage manifest. Offline grace cannot outlive an active takeover's end time.
- Retail Media orders with separately reviewed audio and visual creative.
- Approved-order visual fulfilment that only links published playlists containing approved order assets and devices inside the purchased inventory targets.
- Combined audio and visual delivery evidence with separate totals, bounded date ranges, protected CSV download, and export hashing in the audit log.

## Safety and evidence boundaries

Visual takeovers supplement operational communication. They are not a certified fire, security, evacuation, or other life-safety alarm system. An authorised manager must activate every draft, active takeovers cannot overlap on the same display, and each takeover expires automatically.

Audio and visual proof records are device-confirmed technical delivery events. They are not listener or viewer counts, audience impressions, reach estimates, or proof of commercial impact. The application deliberately reports each medium separately.

## Operational notes

The existing protected media worker now processes both School Radio audio jobs and signage video jobs. A failed video remains unavailable to playlists and retains a safe error state for administrators. Source objects are removed after a normalized output has been safely stored and committed.

The Stage 7D database migration is `20260912000000_stage_7d_advanced_digital_signage`.
