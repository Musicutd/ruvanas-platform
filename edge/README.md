# Ruvanas Inside Secure Edge (C8 Draft)

This is a facility-bound, non-production runtime until the C8 live release
gates pass. It is not a second Ruvanas database or an open media server.
Cloud approval, subscription, rights, Corrections Guard and policy remain
authoritative. Do not connect a real facility or production catalogue.

## Isolated provisioning sequence

1. A Super Admin prepares one Edge node for one active Corrections facility.
   The one-time enrolment credential expires in 15 minutes and is never
   retrievable from the fleet list.
2. On the isolated Edge host, create an Ed25519 proof key pair. POST to
   `/api/corrections/edge/enrol` with the one-time credential in both the
   JSON `enrolmentCredential` field and `Authorization: Bearer rvee.…` header;
   no browser Origin header is needed. Send **only the public PEM** in the
   JSON `proofPublicKeyPem` field. Keep its private PEM separate
   from the media-cache directory. The cloud returns the node-bound machine
   credential once. Do not use a user password, player cookie or shared
   organisation API key.
3. Provision the Edge with the cloud's Ed25519 **public** manifest/grant key,
   a separate random 32-byte AES cache key, proof private key, and the scoped
   machine credential. Keep all keys in a host secret store or protected
   environment, never in the repository, container image or cache volume.
4. Set `EDGE_NODE_ID`, `EDGE_ORGANISATION_ID`, `EDGE_FACILITY_ID`,
   `EDGE_CLOUD_URL`, `EDGE_MACHINE_CREDENTIAL`, `EDGE_CACHE_DIR`,
   `EDGE_CACHE_KEY` (base64url-encoded 32 bytes), `EDGE_CLOUD_PUBLIC_KEY`,
   `EDGE_PROOF_PRIVATE_KEY`, `EDGE_LISTEN_HOST`, `EDGE_LISTEN_PORT`, and
   `EDGE_SOFTWARE_VERSION`. Non-loopback listener use also requires
   `EDGE_LOCAL_TLS_KEY` and `EDGE_LOCAL_TLS_CERT`. The runtime rejects
   non-HTTPS cloud origins except isolated loopback testing.
5. Mount a dedicated writable cache/proof volume owned by the non-root Edge
   user. Do not expose it as a shared music folder. The `edge/Dockerfile` is
   a packaging starting point and is **not** approved for a real facility.

The machine syncs every 30 seconds. It activates only a signed, fully staged
manifest and continues offline only until that manifest expires. A local
player must present a bounded cloud-signed grant for the exact node,
facility, zone and player. Opaque media URLs are not reusable downloads.

## Container packaging check

CI runs `docker build --file edge/Dockerfile --tag ruvanas-c8-edge:ci .` from the
repository root. It only builds a local image: there is no image push or
deployment. The Dockerfile also parses the Edge entry point and loads its
service and sync module graphs during the build. A passing job establishes
that the Node 22 Alpine image can be assembled from the checked-out sources
and that those modules and their relative imports are present and loadable.

The check does not start the Edge, provision credentials or a writable cache
volume, connect to cloud or player services, validate browser-to-Edge TLS or
facility networking, or prove playback, offline recovery, security hardening
or production readiness. Those still require the separate C8 release gates.

## Recovery and decommissioning

- A 401/403 from an authenticated cloud call persists a local playback
  suspension. Updating a rotated machine credential and completing a fresh
  valid cloud sync is required before playback resumes.
- A corrupt proof journal or trusted-clock record fails startup. Preserve it
  for incident review; do not delete it to make a machine appear healthy.
- Edge proof remains in a signed append-only journal until cloud confirms
  the exact sequence and hash. Cloud preserves offline occurrence time and
  separate ingestion time. A browser/player's claimed completion is not
  evidence that a human heard the audio.
- Revocation stops cloud sync, media and proof ingestion immediately. If the
  node is offline, a previously signed manifest can remain effective only
  until its expiry. Super Admin decommission records the action but **cannot
  prove remote erasure**. A trusted on-site operator must verify removal of
  the cache, cache key, proof key and machine credential under the facility's
  media-retention policy; retain audit and proof evidence as required.

No arbitrary remote shell command, unrestricted local admin UI, catalogue
browsing endpoint or supplier credential is supplied by this runtime.
