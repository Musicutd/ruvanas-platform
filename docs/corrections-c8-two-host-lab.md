# C8 two-host LAN/TLS lab (synthetic only, not a release approval)

This is a no-Render-cost validation recipe for **two physical PCs** on a
private LAN. PC A runs the disposable C8 database, local cloud app, synthetic
object store and two browser players. PC B runs the Edge and its isolated
cloud-link process. The browser on A reaches the Edge on B over HTTPS. The
Edge reaches only five machine API routes on A through a separate HTTPS
gateway. Stopping the link process on B interrupts Edge-to-cloud traffic
without taking down the app, players or LAN. No DNS, production service,
production database, Render setting or general firewall rule is changed.

The prior one-computer loopback replay remains valid evidence but **does not
count as this two-host gate**. This recipe itself is preparation only; record
an actual two-PC run before marking any live result PASS.

## Prerequisites and stop conditions

- Use only two explicit, **different RFC1918 IPv4 addresses** on an isolated
  network. Do not use `ruvanas.com`, `onrender.com`, a public IP, VPN exit,
  port-forward or `0.0.0.0`. Permit only A↔B on the chosen lab ports in any
  existing host firewall; the scripts make **no firewall changes**.
- PC A must have the **exact disposable** `DATABASE_URL`:
  `postgresql://c8lab@127.0.0.1:5548/ruvanas_c8_migration_clean`. Verify
  that this is a fresh synthetic database before applying migrations. Never
  copy or point at production data, media, signing keys or credentials.
- Prepare separate short-lived PEM TLS key/certificate pairs for A's private
  IP and B's private IP, each with the **IP address in subjectAltName**. Keep
  keys outside this repository. Supply the matching CA/certificate PEM to
  the other host. Verify certificate fingerprints out of band, explicitly
  trust B's certificate in A's test browser, and remove that trust afterward.
  Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` or bypass a browser warning.
- Use the existing synthetic C8 signing key and mock object-store settings
  from the disposable CI fixture, not a real Ruvanas key or bucket. Keep
  `C8_TWO_HOST_LAB=true`, `C8_SYNTHETIC_ONLY=true`, `C8_LOCAL_INTEGRATION=true`,
  `C8_AUDIBLE_LAB=true`, and `NODE_ENV` non-production. The test harness
  rejects any other database URL for this mode.
- If a second physical PC, trusted IP-SAN TLS, synthetic database or safe
  transfer of the **synthetic** bootstrap bundle is unavailable, stop. Do not
  substitute a same-host loopback test and call it a two-host pass.

## Start and verify

1. On **A**, migrate only the disposable database, start the built app on
   `127.0.0.1:3108` and set the synthetic storage endpoint to
   `http://127.0.0.1:9108`. The app's Edge signing private key must be the
   deterministic **test** key used by `tests/integration/corrections-c8-manifest.test.mjs`.
   Keep the browser at `http://127.0.0.1:3108/player`; localhost is the
   browser's secure context. The app is **not** exposed by the gateway.
2. On **A**, set `C8_LAN_PROXY_MODE=cloud`, `C8_LAN_CLOUD_IP=<A private IP>`,
   `C8_LAN_EDGE_IP=<B private IP>`, `C8_LAN_CLOUD_PORT=9443`,
   `C8_LAN_TLS_KEY_FILE=<A key PEM>`, `C8_LAN_TLS_CERT_FILE=<A cert PEM>`,
   and the exact disposable `DATABASE_URL`; start
   `node scripts/c8-lan-proxy.mjs`. It binds only A's explicit IP, accepts
   only B's IP and forwards only the Edge heartbeat, manifest, media, sync
   and proof routes to the local app. Verify no router port-forward exists.
3. On **A**, set `C8_LAN_CLOUD_ORIGIN=https://<A-IP>:9443` and
   `C8_LAN_EDGE_ORIGIN=https://<B-IP>:8443`; run
   `node --test tests/integration/corrections-c8-manifest.test.mjs` with the
   exact disposable lab flags. The `C8_AUDIBLE_LAB_READY` line prints two
   **one-time synthetic player enrolment codes**, the localhost control URL,
   and a path to `synthetic-edge-bootstrap.json` under the system temp
   directory. It does **not** print the machine credential or private key.
   Leave this test process running. The bundle is deleted when `/stop` ends
   the fixture.
4. Transfer that one synthetic bootstrap file to **B** using a trusted,
   private method. Do not email, upload, commit, screenshot or paste its
   contents. Restrict its filesystem ACL to the lab operator on both PCs;
   the requested `0600` file mode is not a Windows ACL guarantee. On **B**,
   set `C8_LAN_PROXY_MODE=edge-link`, the same A/B IPs
   and cloud port, `C8_LAN_LINK_PORT=3118`, and
   `C8_LAN_CA_CERT_FILE=<A CA/cert PEM>`; start
   `node scripts/c8-lan-proxy.mjs`. It binds **only**
   `127.0.0.1:3118`, validates A's HTTPS certificate **for A's IP**, and
   forwards only Edge machine calls.
5. On **B**, provision `edge/run.mjs` from the synthetic bundle: use its
   node/organisation/facility IDs, machine credential, base64url cache key,
   cloud public key and proof private key. Set `EDGE_CLOUD_URL` to
   `http://127.0.0.1:3118`, `EDGE_LISTEN_HOST=<B-IP>`,
   `EDGE_LISTEN_PORT=8443`, `EDGE_PLAYER_ORIGIN=https://<B-IP>:8443`,
   `EDGE_CLOUD_PLAYER_ORIGIN=http://127.0.0.1:3108`, and the B TLS key/cert
   PEM. Use a new local cache directory outside the repo. Start
   `node edge/run.mjs`. No production credential should appear in its
   environment or the bundle.
6. On **B**, set `C8_LAN_CLOUD_ORIGIN`, `C8_LAN_EDGE_ORIGIN`,
   `C8_LAN_CA_CERT_FILE`, `C8_LAN_EDGE_CA_CERT_FILE=<B CA/cert PEM>`, and
   `C8_LAN_BOOTSTRAP_FILE=<transferred synthetic bundle>`; run
   `node scripts/c8-lan-preflight.mjs`. It must report both PASS results.
   This verifies A's HTTPS certificate/unauthenticated machine-route denial
   and B's HTTPS certificate, exact CORS origin and signed node/facility/
   endpoint attestation. It does **not** verify audio or cloud proof by itself.
7. On **A**, enrol the two synthetic player codes in separate browser tabs.
   Confirm both hear the middle Central tone. Use only the localhost control
   URL's `/schedule-local`, `/priority`, `/clear-priority`, `/emergency`,
   `/clear-emergency` and `/withdraw` test actions. Allow up to 30 seconds
   for B's normal signed sync; confirm the new manifest/player state before
   each cut. Call `/status` for cloud accepted-proof count. The two-host
   status intentionally reports remote pending proof and Edge link state as
   `null`, not invented telemetry.
8. For the offline transition, stop **only** B's `edge-link` process. Verify
   its loopback health address is unreachable while A's local cloud page and
   both players remain reachable. Confirm Central→Local→Central and queued
   signed proof on B while disconnected; never infer audible success from
   page text alone. Withdraw in A's cloud while still offline; previously
   signed content may continue only within its 24-hour validity. Restart
   **only** the B link process. Confirm signed proof uploads once, current
   withdrawal stops both players, and repeat sync adds no duplicate proof.
   Also test expiry, corruption/repair, credential rotation/revocation,
   cross-facility denial, Priority/Emergency ordering and return separately.
9. Record exact times, both host/IP identities, certificate fingerprints,
   control responses, Edge logs (with secrets redacted), cloud proof counts,
   player state and human audible observations. Stop Edge and link on B,
   call `/stop` on A, stop A's gateway/app, remove the transferred bootstrap,
   local cache and temporary browser trust **only after preserving required
   synthetic test evidence**. Do not delete any real customer or production
   data. The test has not run until those observations are actually captured.

If any preflight or isolation check fails, do not continue to audible testing.
This no-cost lab is still not a physical facility appliance/security review
and is not authority to merge PR #217 or expose Inside to customers.
