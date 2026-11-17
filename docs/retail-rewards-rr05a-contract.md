# RR-05a: private shop redemption reports

Local candidate only. Rewards and public registration remain disabled in production; both encoders, live accounts, billing, plans and other channels remain untouched. Preserve RR04a and its preview. Use synthetic fixtures and owned loopback services only.

## Authority and scope

The new strict default-off `RUVANAS_RETAIL_REWARDS_REPORTS_ENABLED` requires the main Rewards flag. Reporting does not enable checkout or require checkout to remain enabled. Reuse `VIEW_INSIGHTS` for reports and both `VIEW_INSIGHTS` and `EXPORT` for exports, with the current export allowance. Retain current role ceilings, exact tenant selection, staff grants and active-shop requirements. No private-preview, platform administrator, shopper or cashier bypass.

Each report concerns exactly one authorised active shop. Every query and relation is tenant/shop scoped. Locations return only currently authorised shops. Recheck current identity, permissions, selected-shop scope, retention, programme timezone and feature gate after the read; a revoked permission cannot yield a stale report or CSV. Do not widen grants or access to archived shops.

## Dates and consistency

From/To are valid inclusive YYYY-MM-DD calendar dates in the server-owned RewardProgram timezone, no earlier than 1970. Convert them to [local midnight, midnight after To), using existing timezone conversion without modifying streaming/scheduler code. Maximum interval is 31 calendar dates; To cannot exceed today. The first selectable date is the first local midnight at or after the rolling retention floor. Very large retention grants must not overflow Date arithmetic. Default to the last seven permitted dates.

The server chooses `asOf` for a new report. A continuation may supply that canonical UTC timestamp only while it is no more than 15 minutes old, not in the future and within the selected interval's lower bound. Apply the current retention floor on every request. Historical receipt corrections are included through asOf, even if they follow the selected period's end.

Use a bounded RepeatableRead transaction for consistency within each response, followed by a fresh authority check outside that snapshot. A timestamp cutoff is not a durable database snapshot across requests: late commits can introduce records bearing earlier timestamps. Pages and exports are rechecked, and must not be described as immutable or guaranteed byte-identical. No materialised snapshots or reporting writes in this stage.

## Metrics and projection

- Coupons issued: actual RewardClaim rows created in the interval through asOf. Do not count retry mappings or credential rotations.
- Successful uses: receipt cohort recorded in the interval through asOf.
- Corrected uses: only that receipt cohort's corrections recorded through asOf.
- Net uses: successful uses minus corrected uses. A correction to an older, out-of-period receipt cannot make this period's net negative.

These independent counts are not conversion rates, visits, sales or payments. Corrections do not restore gross monthly service usage. No monetary totals, shopper segmentation or personal identity data in RR05a.

Receipt rows contain only opaque receipt ID, recorded time, immutable issued offer title/version and public shop name, status, and correction time/reason. Do not expose shopper/staff IDs, names, emails, tokens, hashes, request mappings, private drafts or raw database errors. Use pinned issued terms, never the current mutable offer draft.

Read at most 1,001 claims and 1,001 cohort receipts. More than 1,000 of either returns REPORT_TOO_LARGE and asks for a narrower interval. Counts are exact within the accepted bound; never silently truncate totals or exports. Report pages contain 25 receipts, ordered by recorded time and ID. CSV contains the complete accepted receipt cohort, at most 1,000 rows.

## API and UI contract

`createRewardReportingService({db,env,loadContext,clock})`: `locations({page?})`, `report({locationId,fromDate,toDate,page?,asOf?})`, `exportReport({locationId,fromDate,toDate,asOf?})`.

GET `/api/retail-rewards/reports/locations?page` returns `{ok,locations:[{id,name,canExport}],page,hasMore,defaults:{fromDate,toDate},bounds:{earliestDate,latestDate,maxRangeDays:31},timezone,checkedAt}`.

POST `/api/retail-rewards/reports/query` returns `{ok,location:{id,name},filters:{fromDate,toDate,timezone},window:{fromInclusive,toExclusive},asOf,checkedAt,summary:{issued,successfulUses,correctedUses,netUses},receipts,page,hasMore,totalRows,exportAllowed}`. A receipt is `{id,redeemedAt,offerTitle,revision,shopName,status:REDEEMED|CORRECTED,correction:null|{reversedAt,reason}}`.

POST `/api/retail-rewards/reports/export` takes the same filters/cutoff without a page. Require same-origin JSON with strict fields and byte limits; independently recheck both permissions. Return a privacy-whitelisted CSV with fixed filename, quoted fields, escaped quotes, neutralised spreadsheet formulas, bounded bytes, private no-store and nosniff headers. Errors remain JSON with sanitised codes. No external spreadsheet service or new dependency is needed.

The page offers shop/date selection, four metric cards, receipt pagination and an explicitly authorised export button. Changed filters clear old results; aborted/late responses cannot replace a new selection or trigger a stale download. Exports require a click and object URLs are revoked. Navigation is independently gated by report access, never checkout or offer-publishing permission.

## Verification and release limits

Test strict date/retention/cutoff boundaries, Malta DST, tenant/shop/grant isolation, mid-read revocation, immutable cohort metrics, cap failures, safe projections, CSV formulas and stale UI requests. Use actual PostgreSQL and built HTTP endpoints with synthetic identities, and actual React browser workflows with no external requests. Preserve schema and all 139 historical migrations. Supporting indexes require separate evidence before adding any migration; exact-shop queries already have location/tenant access paths.

This local reporting stage does not complete public merchant routing, shopper provisioning/recovery, billing, campaign attribution or production launch readiness. Production publication, migration compatibility, PostgreSQL16 CI and operational approval remain separate release gates.
