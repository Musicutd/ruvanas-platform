# Stream Source Incident Runbook

## Review source health

1. Open **Admin → Stations → Stream source health**.
2. Confirm whether the failure affects the public stream source while players are otherwise online.
3. Review the provider adapter, last probe time, HTTP result, latency, content type, consecutive failures, and incident severity.
4. Use **Probe now** once after checking that the configured public URL is expected. Repeated clicking is not a repair mechanism.

## Acknowledge

1. Add a short note naming the operational owner and the check underway.
2. Select **Acknowledge**.
3. Check the provider dashboard or streaming host outside Ruvanas. Do not copy credentials into the incident note.

## Recover

- A healthy Ruvanas probe automatically resolves the incident and resets the consecutive-failure count.
- If an operator resolves an incident manually, record the verified recovery evidence and continue monitoring the next scheduled probe.
- If a redirect, private address, unexpected content type, or HTTP error is reported, correct the station configuration or provider endpoint. Do not weaken endpoint restrictions.

## Backup and escalation

The optional backup URL is recorded for a later controlled failover stage; Stage 11C never switches playback automatically. Follow the provider outage procedure, communicate through approved operational channels, and escalate critical or repeated failures with the station ID, timestamps, public error code, and affected organisation. Never include source/admin passwords, session cookies, student information, or database details.
