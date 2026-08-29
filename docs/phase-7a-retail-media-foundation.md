# Phase 7A — retail-media commercial and approval foundation

Phase 7A adds a controlled commercial layer above the existing campaign, targeting, scheduling, and proof-of-play systems. It preserves the subscriber as the owner of its inventory and the final approver of every sponsored order.

## Delivered scope

- Super Admin can enable or disable Retail Media per organisation without changing a shared plan.
- Enabled subscribers receive a Retail Media workspace in their dashboard. Content editors may prepare records, while organisation owners and managers control activation and approval decisions.
- Tenant-owned advertiser and agency records store commercial contacts only. They are not user accounts and cannot sign in, schedule, approve, or publish content.
- Inventory packages define effective dates, maximum plays, commercial terms, eligible brands, location groups or zones, and permitted weekday/daypart windows.
- Supplier campaign orders link an advertiser, optional agency, inventory package, approved immutable promo versions, and optionally an existing campaign draft.
- Orders follow an audited `DRAFT → SUBMITTED → APPROVED` workflow, with explicit creative review and reject/cancel states.
- A campaign linked to a retail-media order cannot be published until the subscriber approval is recorded. Existing campaign guardrails still apply after that approval.
- Order proof is derived from the linked campaign's existing immutable playout intents and device-confirmed proof events, so delivery can be reported by advertiser and order without creating a second playback truth.

## Safety and tenant boundaries

- Every partner, package, order, creative, target, campaign, and proof lookup is organisation-scoped.
- Target ownership is checked before inventory creation.
- Only approved, ready promo versions owned by the organisation may be attached to an order.
- Organisation content roles may prepare records; organisation management roles make approval decisions.
- Database constraints protect date ranges, dayparts, positive play limits, currency shape, and exactly one target type per target row.
- All material commercial and approval transitions create audit records.

## Reporting language

Retail-media reports use device-confirmed playback only. A play is not a listener, viewer, impression, reach estimate, or proof that media caused an operational or commercial outcome.

## Deferred from this increment

Digital-signage devices, visual creative, layouts, visual scheduling, and combined audio/visual reporting remain separate Stage 7B+ work. This keeps audio delivery stable and prevents unverified audience claims from entering the existing proof system.
