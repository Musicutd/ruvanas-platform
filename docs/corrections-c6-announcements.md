# Ruvanas Inside C6: announcements and facility overrides

This is a private-facility extension of the existing Ruvanas channel, zone,
player manifest, playout intent, proof, audit and notification paths. It does
not create a second playback engine or authorise public Corrections output.

## Authority and content

- Announcements reference an exact current, approved and QC-passed organisation
  promo version. The source must be a ready organisation announcement/voiceover
  asset. Replacing its approved version does not silently replace a scheduled
  announcement; the old reference fails closed until staff make a new draft.
- Facility policy chooses creator/publisher, independent explicit approval, or
  two independent approvals. A draft never plays. The staff role and current
  facility grant are re-read server-side for every action.
- Priority requires an enabled facility policy and owner/explicit manager
  authority. Tier 1 is limited to one zone per activation. Emergency requires
  tier 2+, enabled facility policy, an explicit owner/manager emergency grant,
  and a separate confirmation step. Generic editors/viewers cannot operate it.
- A facility configured for emergency dual control currently fails closed on
  activation; it cannot silently fall back to single-person control. The
  policy field is an extension point, not a claim that dual activation exists.

## Precedence, return, and failure

`EMERGENCY > PRIORITY > normal private programming`. Facility-row locking and
serializable transactions make a multi-zone activation atomic. An Emergency
may supersede Priority; Priority cannot supersede an active Emergency. Request
keys make retries idempotent. Targets, initiator, source and activation time
are retained in the override record.

The shared signed manifest selects the active override for each targeted
player. The browser player interrupts its current insertion when the signed
manifest changes. At completion, authorised clear, or expiry, the server
re-resolves the **current approved private schedule** for the same
player/channel/zone. Thus AutoDJ, a playlist, or another scheduled programme
returns only if it is still authorised and valid; the system does not replay
a stale browser snapshot or jump to an arbitrary default. Exact in-track
playhead position is not restored. If no valid normal source remains, the
private facility returns no playable insertion rather than a generic public
stream fallback. Subsequent normal STARTED proof is audited as restoration.

Offline players are reported as unavailable at activation. They do not count
as delivered and do not replay an expired override upon reconnection. The
workspace shows per-player events rather than a false whole-facility success.
An override whose window closes without all completion proofs is marked
`EXPIRED`, audited and notified; expiry is not labelled `COMPLETED`.

Player proofs are signed and tied to the player, exact intent, source and
window. Started, completed, failed and interrupted events are device-delivery
evidence only. A normal completion claimed during an active override is
rejected. None of this asserts that a person heard, understood or acknowledged
the message.

## Scope and release

The C6 API remains under `/api/corrections/`. Standard announcements are
scheduled as private playout intents. Priority/Emergency override those
intents in the existing manifest. No multi-facility C7 control is included.
The production Render service has Auto-Deploy disabled. This migration is
for code review and isolated validation only until a separate production
release is approved.
