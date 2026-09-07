# Stage 29R.2 — Product capabilities and authoritative plan catalogue

Status: **READY TO PUBLISH**

## Outcome

Ruvanas now has one server-owned commercial catalogue covering all fifteen approved Retail Radio, School Radio and Online Radio tiers. Product access is explicit, Licensed Music Catalogue access is levelled, and complimentary access preserves the same authority snapshot.

## Product authority

The effective entitlement service now resolves these capabilities independently:

- `retailRadioEnabled`
- `schoolRadioEnabled`
- `onlineRadioEnabled`
- `licensedMusicCatalogueLevel`: `NONE`, `FOCUSED`, `PROFESSIONAL` or `PREMIUM`
- `includesRuvanasCatalogue`, retained as a separate core-catalogue entitlement

A subscription may override the three product capabilities without modifying its shared plan. Product access is denied whenever billing or complimentary access does not enable the underlying service.

Existing generic plans are deliberately left private and receive neither Retail Radio nor Online Radio authority automatically. An existing School Radio flag remains authoritative. This prevents a schema deployment from silently widening any customer's access.

## Public commercial catalogue

| Product | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
| --- | --- | --- | --- | --- | --- |
| Retail Radio | Retail Start — €14.90 | Retail Business — €49 | Retail Professional — €149 | Retail Advanced — €399 | Retail Enterprise — from €999 |
| School Radio | School Start — €19.90 | School Create — €49 | School Pro — €99 | School Academy — €249 | Education Enterprise — from €599 |
| Online Radio | Online Hobby — €14.90 | Online Starter — €39 | Online Professional — €89 | Online Station Pro — €199 | Online Network — from €499 |

Every product contains exactly five numbered tiers. Tier 1 and Tier 2 have no Licensed Music Catalogue access, Tier 3 receives `FOCUSED`, Tier 4 receives `PROFESSIONAL`, and Tier 5 receives `PREMIUM`. Tier 5 pricing is presented as a starting price and remains subject to an enterprise conversation.

Stable plan codes and slugs are defined in `lib/product-plan-catalogue.mjs`. The database migration creates or reconciles those records from the same approved catalogue contract. Public wording consistently uses **Licensed Music Catalogue** and does not expose any third-party supplier identity.

## Complimentary access

Complimentary codes continue to be issued and revoked by Ruvanas. Their immutable activation snapshot now includes:

- all three product capabilities;
- the Licensed Music Catalogue level;
- the separate Ruvanas core catalogue flag;
- all existing limits and optional feature flags.

This ensures a later plan edit does not unexpectedly change an already-issued complimentary service.

## Super Admin visibility

The Super Admin navigation now includes **Plan catalogue** at `/admin/plans`. It provides a read-only view of:

- public tier count and five-tier product families;
- stable code, tier, price and product access;
- Licensed Music Catalogue level;
- station, listener, storage and bitrate allowances;
- any private or legacy records that still require a deliberate migration decision.

The organisation list also distinguishes Retail, School and Online access instead of treating an active generic subscription as all three products.

## Validation

Automated coverage protects:

- all fifteen names, codes, families, tier numbers and approved prices;
- five ordered tiers per product;
- the catalogue level ladder;
- exactly one primary product capability on every public plan;
- safe plan lookup and database mapping;
- independent subscription overrides;
- fail-closed legacy and unknown catalogue behaviour;
- complimentary snapshot, restoration and clearing;
- Super Admin-only access to the plan catalogue navigation.

## Next milestone

Stage 29R.3 can now build the public product-registration API against stable plan codes and explicit server-side product authority. Route and dashboard isolation remain separate later milestones and must enforce both product access and role membership before customer launch.
