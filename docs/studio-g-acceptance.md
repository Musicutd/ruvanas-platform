# Studio G — Acceptance and release gate

Studio G closes the basic Studio scope. It adds no new production capability. Further Studio expansion is blocked until this gate remains green.

## Automated acceptance

Run `npm run test:studio`, `npm run ci:media-toolchain`, `npm run ci:static`, `npm test` and `npm run build`.

The Studio suite verifies:

- deterministic waveform and multitrack render plans;
- the full 16-track, 100-clips-per-track bounded project shape;
- podcast, online-radio, retail-promo and school-programme LUFS, True Peak and loudness-range targets;
- current Chrome, Edge, Firefox and Safari recording capability contracts, including Safari's prefixed audio context and MP4 recording path;
- clear failure guidance when recording APIs are missing;
- organisation, role and product-entitlement boundaries;
- immutable uploaded source evidence, project versioning, edit invalidation of approved multitrack outputs, and approval before product handoff;
- private, non-billing handoff behaviour for Retail, School and Online Radio.

## Manual release evidence

Before a production release, test with a real microphone in the supported desktop browsers available to the release operator:

1. Record clean speech, pause, resume and stop; refresh and confirm local recovery.
2. Keep the raw take, make non-destructive waveform edits and preview Voice Cleanup bypass on and off.
3. Mix voice, music and a jingle, then render twice from the same saved version and compare the resulting checksum.
4. Confirm the loudness report passes the chosen preset before approval.
5. Edit the project after approval and confirm the earlier approved output is superseded.
6. Send a newly approved output to each entitled product and confirm it remains private to the correct organisation.
7. Try the same media identifier from another organisation and from a product without the entitlement; both must be rejected.
8. Complete the workflow in Beginner mode with a non-engineering operator and record any unclear wording as a release blocker.

Microphone permission and device-driver behaviour cannot be fully proven by headless CI. The manual browser run is therefore required release evidence, not a substitute for the automated gate.
