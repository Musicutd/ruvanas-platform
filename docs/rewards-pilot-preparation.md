# Read-only Rewards pilot preparation

The Super Admin can inspect a previously prepared internal Retail trial while Rewards is disabled. In **Organisations**, choose **Rewards pilot preparation** on the relevant trial row. The page shows stored owner, location, coupon, staff and shopper readiness, plus the saved access expiry and aggregate shopper/invitation counts.

This is a configuration snapshot. It does not establish successful Client Admin or shopper sign-in, coupon claiming, redemption, or report reconciliation. Those remain explicitly unverified until a separately authorised rehearsal records actual results.

## Scope and access

- Ordinary Super Admin sessions only, with current database authority rechecked before and after the reads. No pilot sign-in bridge is used.
- The global Rewards policy must be valid and disabled.
- Exactly one requested organisation; no default target, tenant listing or shopper lookup by email.
- Retail trial subscription, a matching internal trial grant, ordinary owner-creation audit, and dormant shopper setup/audit provenance are required. Cross-tenant shopper enrollment is rejected.
- Output is restricted to the workspace name/ID, checks, counts and times. It excludes shopper identifiers, email addresses, credentials, invitation tokens and renewal fingerprints.
- Reads are bounded and responses are private/no-store. Page loads and API refreshes share the same IP and principal rate limits.

Only **Refresh snapshot** is available. No account activation, renewal, invitation, entitlement change, environment change or audio control is invoked. Existing pilot mutation endpoints continue to require their original enabled policies.

“Read-only” refers to the shop, shopper, grant and other business records. Existing request throttling updates rate-limit buckets, and the surrounding site middleware/layout can record normal session activity. The preparation session loader itself does not extend or modify a session.

## Implementation and validation

- Page: `/admin/retail-rewards/preparation?organisationId=…`
- GET: `/api/admin/retail-rewards/preparation?organisationId=…`; all other HTTP methods are rejected.
- No Prisma schema or migration changes.
- Tests exercise actual service reads, tenant/provenance denials, revoked/changed authority, closed policies, safe output, HTTP limits, the ordinary session loader, UI refresh/error behaviour and private-preview route boundaries.
- Local runtime checks use an unused loopback database URL and disabled feature flags. They do not connect to the hosted database or encoders.
- The existing `rewards-pilot-renewal-database` GitHub CI job runs the preparation database test after renewal on its disposable PostgreSQL 16 service with Node 20. No extra job or service is created.
- Database tests require either an explicitly owned local fixture or the exact GitHub-hosted CI job and connection. They check the server's database, role, directory and PostgreSQL version before creating fixtures. The inspection must preserve every public table's row count and content digest.

Releasing this page does not authorise a hosted rehearsal. Extending saved access or enabling Rewards requires a separate decision with an explicit time window and closure checks.
