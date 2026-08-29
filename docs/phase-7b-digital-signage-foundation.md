# Phase 7B — digital-signage foundation

Phase 7B establishes a tenant-safe visual-content and display-device foundation alongside the existing audio platform. It does not alter audio scheduling, player manifests, proof-of-play, or Stage 7A Retail Media approval behaviour.

## Delivered scope

- Super Admin can enable or disable Digital Signage per organisation without changing a shared plan.
- Enabled organisations receive an administration workspace for visual assets, reusable layouts, and display devices.
- PNG and JPEG uploads are verified by file signature and decoded dimensions before storage. Extension-only validation is not accepted.
- Visual storage counts against the organisation's existing storage entitlement together with its audio library.
- Layouts define an audited canvas, background, orientation, and one or more bounded regions. Region coordinates cannot escape the canvas and region names must be unique.
- Display devices belong to exactly one organisation and one existing location zone. Device creation returns a one-time enrolment code that expires after 24 hours.
- Tenant content roles prepare visual assets and layouts. Tenant management roles control display-device registration.
- All material uploads, layout creation, device creation, and entitlement changes produce audit records.

## Safety and tenant boundaries

- Asset, layout, zone, and device access is organisation-scoped and entitlement-gated.
- Device creation confirms that the selected zone belongs to the same organisation.
- Image dimensions, pixel count, MIME claim, file extension, and binary signature are checked before storage.
- Database constraints protect positive dimensions, safe colour syntax, bounded region geometry, fit modes, and immutable storage checksums.
- Raw enrolment and session tokens are never stored; only hashes are persisted.

## Deferred from this increment

The dedicated signage player, visual playlists, time-window scheduling, asset-to-region assignment, offline-safe delivery, and device-confirmed evidence are delivered in Stage 7C. Video transcoding, emergency takeovers, Retail Media visual-order fulfilment, and combined audio/visual delivery reports remain Stage 7D work. Delivery evidence continues to mean device-confirmed events only; it is not audience reach or a commercial outcome.
