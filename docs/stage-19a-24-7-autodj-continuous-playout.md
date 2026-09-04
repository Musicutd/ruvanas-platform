# Stage 19.1 — 24/7 AutoDJ continuous playout

## Outcome

Stage 19.1 (originally prepared as Stage 19A) adds an optional, channel-owned Continuous AutoDJ policy. A published schedule remains authoritative whenever it has a valid playable programme. When no schedule applies, or a scheduled music mode becomes unavailable, the resolver can continue with a configured default music mode and then an optional backup music mode.

The change is additive. Existing schedules, campaigns, School Radio insertions, synchronized channel clocks, two-second transitions, listener limits and proof-of-play behaviour remain in place.

## Explicit operator controls

Organisation owners and managers configure each active channel from **Programming → Continuous scheduling fallback**:

- Continuous AutoDJ: on or off.
- Default music mode: required when AutoDJ is enabled. It must be active and contain at least one currently playable, licensed Ruvanas catalogue track.
- Backup music mode: optional, distinct from the default, and subject to the same validation.
- Playback hours:
  - **Follow location / school hours** preserves intentional silence outside configured hours.
  - **Run continuously, 24/7** continues scheduled or fallback programming even when a linked retail location is closed.

The weekly preview identifies scheduled periods and automatically covered gaps before the operator publishes a plan.

## Resolution order

Stage 19.1 does not weaken or reorder existing higher-priority programming. Emergency, live, exact-time, School Radio and campaign insertion behaviour remains with its existing resolver and player rules. The music-bed resolver follows this order:

1. Valid zone schedule (`ZONE_SLOT`).
2. Valid location schedule (`LOCATION_SLOT`).
3. Default Continuous AutoDJ (`DEFAULT_AUTODJ`).
4. Backup Continuous AutoDJ (`BACKUP_AUTODJ`).
5. Closed-hours state when the policy follows location hours (`LOCATION_CLOSED`).
6. Explicit critical no-programming state (`NO_PROGRAMMING`).

A normal uncovered schedule period that is filled by a valid default mode does not create an operational warning.

## Product behaviour

### Retail and in-house radio

Retail channels can follow the location’s opening hours or run continuously. Published location and zone schedules always override AutoDJ while they are valid.

### Online radio

An online-radio channel can use **Run continuously, 24/7** as a first-class always-on policy. It does not require synthetic weekly schedule blocks merely to prevent gaps.

### School Radio

School channels can follow the school/location hours or run continuously when authorised. Approved School Radio content and safeguarding rules remain unchanged and retain their existing insertion priority.

## Continuous player behaviour

The player receives a stable channel-based manifest and joins the shared live clock at the current position. A deterministic weighted music rotation repeats indefinitely; it is not exhausted after one pass. The player refreshes its manifest before expiry, keeps the two-second transition model, and retains campaign and School Radio insertions.

Each music item carries an authenticated programming-source classification. Proof-of-play ingestion verifies that classification as part of the signed proof token and stores it as one of:

- `ZONE_SLOT`
- `LOCATION_SLOT`
- `DEFAULT_AUTODJ`
- `BACKUP_AUTODJ`

Campaign and School Radio insertions use their own authenticated source labels.

## Failover and operational warnings

- Scheduled mode unavailable + valid default: playback continues on the default; one deduplicated warning is recorded.
- Default unavailable + valid backup: playback continues on the backup; one deduplicated warning is recorded.
- Default and backup unavailable: the player receives a critical no-programming state and the account receives a critical notification.
- Ordinary schedule gap + valid default: playback continues without schedule-gap alert noise.

Warning notifications are deduplicated by channel, warning code and local day. A corresponding audit record captures the channel, player, severity, source and warning code. Schedule failure, backup activation and critical programming failure use distinct audit actions. Enabling, disabling, changing the default or backup and changing the playback-hours policy are also recorded as distinct audit actions with their previous and new non-secret settings.

## Security and tenancy

- Policy reads and writes are derived from the authenticated active organisation.
- The API never accepts a client-supplied organisation identity.
- Only owners and managers can update policy settings.
- The existing radio-service entitlement must be active.
- Channels and music modes must belong to the same organisation.
- Composite database relationships enforce the same-organisation boundary for the policy, channel, default mode and backup mode even if a future caller bypasses the current route validation.
- Default and backup modes are revalidated server-side against catalogue, media, rights and licence state.
- Proof source labels are signed; the player cannot change a scheduled event into an AutoDJ event without invalidating its proof token.

## Data model and migration

The additive migration introduces:

- `AutoDjPlaybackPolicy`
- `AutoDjPolicy`, uniquely attached to a channel
- optional `ProofOfPlayEvent.programmingSource`
- `AUTODJ_FAILURE` notification support

It does not drop, rename or rewrite existing production data.

Stage 19.1 deliberately supports approved Ruvanas-catalogue music only. Organisation-owned music expansion belongs to the shared Media Library Pro eligibility work in Stage 19.2; the interface and validation therefore do not imply that organisation promo uploads are currently eligible as AutoDJ music.

## Verification coverage

Automated coverage includes policy validation, gap filling, overnight schedules, scheduled priority, default fallback, backup fallback, both-fallback failure, opening-hours behaviour, 24/7 behaviour, stable recurring channel playback, safe manifest output, tenant-derived API access, role controls and catalogue eligibility.

The release gate includes Prisma formatting and validation, migration testing against a disposable PostgreSQL database, the full automated suite, static checks, production build and route-security checks.

## Honest service statement

Continuous AutoDJ prevents scheduling-induced dead air while a valid default or backup music mode and playable media remain available. It does not claim that network, browser, device, infrastructure or upstream media failures can never interrupt audio.

## Deployment notes

1. Take and verify the normal pre-deployment database snapshot for the paid service.
2. Run the existing forward migration command before the new web process starts.
3. Deploy the approved application commit only to the paid `ruvanas-platform` service; keep the retired free staging service suspended.
4. Sign in as an organisation owner or manager, open Programming and configure each channel deliberately. Existing channels remain disabled by default until configured.
5. Confirm a channel with no matching slot resolves to `DEFAULT_AUTODJ`, and review notifications for any eligibility warning.

No new environment variable, external provider or storage bucket is required.

## Rollback

If application rollout fails, redeploy the preceding application release and leave the additive migration in place. The preceding release ignores the new policy table, notification enum value and nullable proof field. Preserve any policy, proof, notification and audit evidence already created. Use a new corrective migration for a later database correction; do not edit an applied migration or destructively remove production evidence.
