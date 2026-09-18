# Online Radio: Ruvanas AutoDJ → Centova Cast

This integration separates three things that used to be conflated:

1. The **public listener URL** is what the Ruvanas player relays (for example `https://plus-radio105network.radioca.st/stream`).
2. The **Centova live-source connection** is where the Ruvanas encoder sends audio. Its host, source port, optional username and source password come from Centova Cast → Quick Links → Live Source Connections. Do not infer the source port from the listener URL; it can coincide with the listener port.
3. The **Ruvanas rotation** is an ACTIVE music mode assigned to an ACTIVE Online Radio channel through Continuous AutoDJ. The source is always rights-checked when the worker refreshes it.

## Setup order

1. Super Admin: save the listener URL and Centova connection in `/admin/stations/<station-id>/setup`. The admin password is never stored. For this station, with Centova AutoDJ **off**, the supplied live-source details are Shoutcast v1, `pollux.shoutca.st`, port `8393`, MP3 at 128 kbps, source password, and **no source username**. The alternative port `8395` and DJ-account credentials apply when Centova AutoDJ is running and are not the Ruvanas AutoDJ route. Enable outgoing AutoDJ only after entering the source password privately in the admin form.
2. Super Admin: select **Prepare Online Radio channel**. This does not claim that audio is live and does not require a healthy listener stream.
3. Subscriber owner/manager: open **Programming → Schedule**, select that channel, the active rights-approved music mode, and **Run continuously, 24/7**. Save Continuous AutoDJ. Online Radio does not require a retail location or listening zone.
4. Operations: run one dedicated encoder worker for this station. It is a long-running background process, not a request handler or cron job. Keep outbound AutoDJ disabled while preparing the worker and verifying its logs. Centova's own AutoDJ or another source must be disconnected before allowing Ruvanas to connect; coordinate this cutover so the existing stream is not interrupted prematurely.
5. Once the listener URL returns real audio, Super Admin checks and activates the station. The subscriber can then publish the public player and open `/listen/<station-slug>`.

## Worker requirements

Use one dedicated Render background worker per station, built from `Dockerfile.online-radio-worker` with one `RUVANAS_AUTODJ_STATION_ID` per instance. The container installs Liquidsoap with MP3 support and validates the generated script during its build. It needs `DATABASE_URL`, `SECRET_ENCRYPTION_KEY`, and the four R2 variables used by the audio worker (`R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). `LIQUIDSOAP_BIN` is optional. The worker is **not** included in the existing paid web service or operations worker. Do not copy secret values into the repository or Docker build arguments; set them only as runtime environment variables in the dedicated worker. For a local runtime with Liquidsoap installed, use `npm run worker:online-radio`.

The worker uses a database lease to avoid two encoders for one station, pins a public source IP before connecting, caches only the eligible protected R2 tracks in a private temporary directory, never logs source credentials, rechecks rights and configuration every 15 seconds, and stops the encoder on a policy, entitlement, station, or rights change. It handles SIGTERM/SIGINT and removes temporary media on exit. If Liquidsoap or the source details are wrong, the worker fails without publishing an alternate or unapproved source.

## Release gate and current limits

- The local code and static tests do not prove a real Centova source connection. Verify with the actual Live Source Connections details and a non-production test account before production use.
- The worker currently rotates the approved music-mode tracks. It does not yet reproduce the full Ruvanas schedule, promotions, live overrides, Studio handoff, metadata updates or per-track proof-of-play/usage ledger at the Centova output. Do not claim that those features are delivered through this encoder yet.
- Licensed distributor catalogue use must remain disabled for production output until the output generates complete, reconciled play evidence and distributor usage reports. An approved catalogue track in a music mode is not, by itself, evidence of an actual Centova play.
- Run database migrations before starting the new web and encoder code. Do not enable outgoing AutoDJ before the dedicated worker is provisioned and tested.
