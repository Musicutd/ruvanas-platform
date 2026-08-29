# Runbook — Player Heartbeat Incident

Use this runbook when the Ruvanas Admin **Players & health** screen reports an unresolved heartbeat incident. Do not enter passwords, customer content, student identities, or private contact details in incident notes.

## 1. Confirm the signal

1. Check the player name, organisation, location, zone, last heartbeat, and incident start time.
2. Confirm the player has remained offline beyond the 90-second operational threshold.
3. Check whether the location has an expected power, network, or maintenance interruption.
4. Acknowledge the incident with a short factual note so another operator knows it is being handled.

## 2. Diagnose without changing content

1. Confirm the playback device is powered and the browser/player application is open.
2. Confirm the location network can reach the Ruvanas player and media endpoints.
3. Confirm the device clock is correct and the player session has not been manually cleared.
4. Review current platform and stream-provider health separately; do not assume a missed heartbeat proves a stream outage.
5. Do not alter schedules, campaigns, school publishing, or media merely to clear the incident.

## 3. Recover and verify

1. Restore the device/network/browser using the organisation's approved local procedure.
2. Wait for the heartbeat to resume. Ruvanas should automatically resolve the missed-heartbeat incident and record a recovery sample.
3. Confirm the player returns to ONLINE and the intended channel is playing.
4. If automatic resolution does not occur, refresh the admin screen and verify the last heartbeat before resolving manually.
5. A manual resolution note must state what was checked and how playback was confirmed.

## 4. Escalate

- MEDIUM: investigate during the active support window.
- HIGH: notify the responsible operations lead through the approved support process.
- CRITICAL: use the organisation's approved major-incident process and preserve external communication evidence outside Ruvanas where required.

Ruvanas severity is an operational indicator, not proof that emergency services, regulators, customers, parents, distributors, or other third parties were notified.

## 5. Record follow-up

If the same device repeatedly fails, create a support ticket linked to the player ID and record the proposed replacement or local remediation. Stage 11A does not execute restart or replacement commands.

