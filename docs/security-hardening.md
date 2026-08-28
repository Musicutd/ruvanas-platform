# Phase 0 security controls

## Stage 5E enterprise identity boundary

- Session validation now honours revocation, maximum age, and organisation idle timeout.
- SSO enforcement is fail-closed until an identity provider has completed verification; draft provider metadata cannot change login behaviour.
- Service API keys are high-entropy bearer credentials stored only as HMAC-SHA-256 hashes.
- Service accounts are tenant-scoped, allow-listed to explicit scopes, expirable, rotatable, and revocable.
- Enterprise security mutations are Super Admin-only and recorded in the audit log without raw credentials.

## Browser origin and CSRF policy

All unsafe `/api/*` requests (`POST`, `PUT`, `PATCH`, and `DELETE`) must carry an
`Origin` header matching the deployed request origin or an entry in the optional
comma-separated `ALLOWED_ORIGINS` environment variable. Requests without an
approved origin are rejected before route code runs. Safe reads remain available
without an origin header.

Session cookies are HTTP-only, `SameSite=Lax`, and secure in production. A future
public API must use separate token authentication rather than weakening this
browser-origin policy.

## Authentication throttling

Login attempts are limited to 10 per IP-and-email pair per 15 minutes.
Registration attempts are limited to 5 per IP per hour. Counters live in
PostgreSQL so they survive application restarts and work across service instances.
Identifiers are SHA-256 hashed before storage.

## Request tracing and security events

Every API request receives an `x-request-id`. Authentication, rejected origins,
invalid uploads, and storage failures emit single-line JSON events without raw
passwords, session tokens, client IPs, or uploaded content.

## Audio validation and quarantine

Promotional uploads are limited to 50 MB and must have a supported extension,
compatible MIME type, and matching MP3, WAV, OGG, or M4A file signature. Accepted
bytes are first written below the private `quarantine/` prefix, copied to their
content-addressed final key only after validation, and then removed from quarantine.

Configure a private R2 lifecycle rule that deletes objects under `quarantine/`
after one day. This is a cleanup fallback for interrupted uploads; quarantine
objects must never be exposed by public routes.

Signature validation is not a replacement for malware scanning. Before opening
uploads to untrusted high-volume customers, add an asynchronous scanner between
the quarantine write and promotion step.
