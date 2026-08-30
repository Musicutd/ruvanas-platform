# Stage 13C: player lifecycle and offline-recovery assurance

Stage 13C closes the master specification's remaining player end-to-end regression gap. It proves that the existing player services operate as one controlled lifecycle against a clean PostgreSQL database and a production build, without changing customer data, the database schema, or the player protocol.

## Acceptance path

The integration suite now verifies the complete operational path:

1. A pending player enrols with a valid, expiring, single-use code.
2. The enrolment code is cleared, a protected session is issued, the player becomes online, and an audit record is retained.
3. The authenticated player receives its assigned location, zone, channel, stream URL, heartbeat interval, and manifest endpoint.
4. A command created while the player is offline remains queued until the player reconnects.
5. The reconnecting heartbeat records bounded diagnostics, recovery evidence, analytics, source address, and user agent without retaining arbitrary submitted fields.
6. The queued command is delivered once, acknowledged once, and stores only the approved operational result fields.
7. An offline proof-of-play event is accepted after reconnect, while a replay of the same event is counted as a duplicate rather than inserted twice.
8. A disabled player is rejected by state, heartbeat, command, and proof endpoints.

## Release gate

The lifecycle test runs with the route-level security suite after the production build starts in CI. A pull request cannot pass when any lifecycle transition, access boundary, assignment, stream configuration, recovery signal, command state, proof idempotency rule, or disabled-player rejection changes unexpectedly.

## Privacy and safety boundary

- Fixtures use generated names, addresses, identifiers, and media metadata only.
- No audio is uploaded, downloaded, decoded, or transmitted.
- No customer, student, school, listener, or production data is used.
- No external notification, streaming, storage, or analytics provider is contacted.
- The fixture organisation and operator are removed after the test, including proof and audit evidence created for the test.

## No database migration

This stage adds integration assurance, CI wording, and operational documentation only. It does not alter the Prisma schema, rewrite existing records, or introduce a new production dependency.

