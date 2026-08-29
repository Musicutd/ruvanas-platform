# Player Diagnostic and Replacement Runbook

## Request a diagnostic

1. Open **Admin → Players and health → Diagnostics and replacement**.
2. Select the enrolled player and the least invasive diagnostic that answers the operational question.
3. Queue the command and wait for `ACKNOWLEDGED`, `FAILED`, or `EXPIRED`.
4. Record remediation in the related health incident or support ticket. Do not repeatedly queue duplicate commands.

`DELIVERED` means the player collected the command. `ACKNOWLEDGED` means it completed successfully. `FAILED` includes explicit failure and unsupported-client results. `EXPIRED` means no valid result arrived before the deadline.

## Revoke a player

Use **Revoke and disable** only when a device is lost, compromised, retired, or must immediately stop authenticating. Add a clear operational reason. The action invalidates the existing player session and cannot be undone by the device.

## Replace a player

1. Select the old player and add the reason for replacement.
2. Choose **Revoke and create replacement**.
3. Copy the one-time code immediately; it is displayed only in the success panel and expires after 24 hours.
4. Open `/player` on the replacement device and enter the code.
5. Confirm the new player reports online and receives its expected playback plan.
6. Confirm the old player remains disabled. Never delete it to tidy the player list; it anchors historical evidence.

## Escalation

Do not use database edits to re-enable retired devices or manufacture acknowledgements. If enrolment fails, create a new replacement workflow or escalate with the player ID, command ID, timestamps, and the visible result code. Do not copy session tokens, enrolment hashes, or database credentials into support notes.
