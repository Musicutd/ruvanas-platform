# Private Rewards pilot preparation fixes

These changes support an existing test shop and an already prepared disabled
shopper. They are local implementation work, not permission to enable Rewards
or activate hosted accounts. There is no schema migration, new service, plan
change, public registration change, encoder operation or automatic email.
Existing feature flags retain their default-off behavior.

## Account boundaries

- The business account is the test shop's Client Admin (`OWNER`). It can perform
  the owner checkout workflow; this does not demonstrate a separate cashier's
  least-privilege permissions.
- The shopper is a separate `RewardShopper`, without a business `User`, business
  session, organisation membership or back-office role. Use separate browser
  sessions for business and shopper acceptance testing.
- Keep the ordinary `invite` reserved-email guard. A prepared identity must be
  selected by its immutable shopper ID, never adopted because an email matches.

## Activate the existing location for Rewards

`activateLocation({ organisationId, locationId, confirm: true })` is a scoped
Super Admin pilot operation. It uses a dedicated `ReadCommitted` transaction,
locks the organisation, its bounded set of existing locations, the exact target
location and its zones, and checks the current subscription and Rewards grant.
The existing draft already counts towards physical site capacity.
Active and paused sites count towards the Rewards location allowance.

The isolation choice is deliberate. PostgreSQL tests reproduced two races where
an earlier Serializable snapshot missed newly committed zone/player rows after
waiting for an FK parent lock. `ReadCommitted` allows the delivery counts to see
those commits after the locks are obtained. The organisation lock blocks new
location FK inserts; ordered tenant-location locks prevent legacy status changes
from racing capacity checks; target location and zone locks prevent new delivery
FK inserts until completion. Both tenant-location and target-zone lock sets are
bounded at 1,000 rows. Oversized scopes fail closed. Other pilot operations,
including prepared shopper issuance, retain Serializable isolation.

Only `DRAFT` can transition to `ACTIVE`. A guarded retry of an already active
location adds no second write or audit. Closed, paused, foreign and Corrections
locations are refused. Any channel assignment, player or digital display tied to
the location's zones, including inactive history, prevents this narrow operation.
It does not create, assign, change or remove audio zones, channels or devices.

The write is the location status and one `REWARDS_PILOT_LOCATION_ACTIVATED`
ordinary audit event. The status is shared platform state; it is not a new
Rewards-specific status. Delivery checks are therefore required, and a failed
capacity, authority or audit check rolls the transaction back.
Entitlement and subscription allowance are checked again at the final clock
after the parent authority check. This includes a request that waits long enough
for its grant to expire. A database error leaves the mutation unconfirmed; refresh
and use the guarded retry rather than assuming activation succeeded.

Activation does not publish the shop. `publishShop` remains a separate explicit
consent step with reviewed public display name, locality, country and description.
Do not substitute the location's private street address. A simulated shop must
use clearly simulated public details and offers with no real monetary value.

## Invite the exact prepared shopper

The read-only overview now exposes `preparedShoppers`, restricted to untouched
disabled preparations in the selected allowed organisation:

```js
{ shopperId, email, displayName, authVersion: 1, preparedAt }
```

The new operation requires all displayed identity pins, an approved future expiry
and explicit confirmation:

```js
invitePrepared({
  organisationId, shopperId, email, authVersion: 1,
  preparedAt, expiresAt, confirm: true
})
```

Within the serializable transaction it locks the shopper before immutable setup
provenance, validates canonical email, exact workspace, preparation timestamp,
version 1 and the matching `DORMANT_SHOPPER_PREPARED` audit. Business-user,
credential, invitation and other preparation email collisions are checked
case-insensitively. Any existing credential, invitation, membership, session,
pilot enrollment, claim or redemption for this shopper blocks the operation,
including expired and revoked records.

Issuance creates only the bounded membership, hashed invitation, immutable pilot
enrollment and pilot audit. It preserves the shopper's disabled status, identity
and original setup provenance. No credential or session is created. A duplicate
issuance is rejected; recover a lost pending code with the existing `reissue`
operation rather than issuing another prepared invitation.

Membership is limited to 30 days and the grant expiry. The invitation lasts no
longer than 24 hours and never outlives membership. The raw code is returned once
through the protected, uncached administrator response. Do not place it in logs,
URLs, documentation, chat or ordinary email. Existing invitation acceptance lets
the shopper choose their own password and atomically activates their account.

`invitePrepared` also requires the shopper and shopper-auth feature policies. In
private-preview mode the existing pilot-preview bridge and exact organisation
allowlist must allow this organisation. These checks do not turn any flag on.
The current Super Admin session, entitlement, clocks and policies are rechecked
before the transaction completes.

## Hosted activation remains separate

Before a later authorised hosted rehearsal, review the exact organisation,
location and shopper again; approve the programme/grant limits and expiry; and
confirm that only the selected test shop enters the private pilot allowlist.
Keep public registration and public claims closed. Use simulated purchases.
Do not enable features or deploy merely because the local tests pass.

Revoking a pending invitation stops its use but does not revoke an already
accepted shopper account. Any rollback after acceptance needs a separately
reviewed targeted suspension and session-revocation action. Do not remove shared
flags or change unrelated shoppers as an automatic rollback.

## Local verification

Use Node 20. Run the focused service, location, HTTP and browser-safe contract
tests, plus the pilot component suite maintained by this repository:

```text
node --test tests/retail-rewards-pilot-admin-service.test.mjs tests/retail-rewards-pilot-location-activation.test.mjs tests/retail-rewards-pilot-admin-http.test.mjs tests/retail-rewards-pilot-admin-ui.test.mjs
git diff --check
```

`tests/retail-rewards-pilot-fixes-database.test.mjs` additionally checks real
PostgreSQL 16 behavior. Without its explicit test environment it skips integration
work. Its guard accepts only the isolated local `rewards_pilot_fixes_fixture`
cluster with a verified data directory, or the repository's isolated GitHub CI
database. Never point these tests at a hosted or ordinary development database.
Run through the locally prepared disposable cluster harness and retain its
redacted results. Passing unit tests is not proof of PostgreSQL lock behavior,
two-device QR use or hosted activation.
