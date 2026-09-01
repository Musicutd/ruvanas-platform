# Stage 15F — Guided shop activation and go-live readiness

## Purpose

Stage 15F turns subscriber player creation into a guided, observable shop launch. Owners and managers can follow the one-time setup steps and see whether the enrolled device is connected, assigned to a channel, connected to its audio source, and producing recent proof-of-play evidence.

## Subscriber experience

- The one-time enrolment result includes a copy action, direct player link, expiry time, and four short installation steps.
- The **Shop go-live readiness** panel refreshes automatically every 15 seconds and also supports a manual refresh.
- Each configured player shows a five-part checklist: enrolment, device connection, channel assignment, audio-source connection, and recent playback confirmation.
- Readiness states distinguish waiting conditions from issues that require action, including an offline device, missing channel, degraded source, and failed playback.
- View-only organisation members may inspect readiness, while player creation and replacement remain restricted to owners and managers.

## Evidence and boundaries

Readiness is derived only from existing tenant-scoped operational evidence: player enrolment, the 90-second heartbeat rule, the active zone assignment, bounded heartbeat diagnostics, and proof-of-play events received in the last 15 minutes. It does not claim audience reach, microphone output, speaker volume, or physical sound in the shop.

No new device fingerprint, customer credential, network identifier, or database table is introduced. Stage 15B stream quotas, Stage 15D one-device locks, and Stage 15E replacement controls remain the authority for access and capacity.

## Operator interpretation

- **READY** means the enrolled player is online, has an active channel, reports a connected source, and has recent successful playback evidence.
- **WAITING** means the normal setup sequence has not yet produced all required evidence.
- **ACTION REQUIRED** identifies a specific operational problem without exposing private device data.
- **RETIRED** identifies a disabled player retained only for historical evidence.
