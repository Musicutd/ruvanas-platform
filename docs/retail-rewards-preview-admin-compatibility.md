# Rewards pilot administration with the existing preview owner

The configured private-preview Super Admin can use the existing established password session for pilot administration when an independently authorised pilot is enabled. No extra administrator account or credential conversion is needed.

## Sign-in flow

1. Sign in through `/login` with the existing private-preview owner account.
2. Open the Rewards pilot link in administration. The link and page remain unavailable while Rewards is disabled.
3. Pilot actions remain restricted to the exact configured organisation allowlist and their existing entitlement checks.

The `/rewards/pilot-sign-in` form continues to accept only ordinary business accounts. Its guidance links preview administrators to the normal admin login. Shopper sign-in and merchant permissions remain separate.

## Authority boundary

The preview-admin identity requires valid private-preview configuration, the exact configured owner email, role `SUPER_ADMIN`, an unexpired and unrevoked `PREVIEW_PASSWORD` session, and the existing enabled owner grant with password access, no organisation binding, no expiry and no tester pillars. Existing enterprise session age and idle limits remain enforced. Bootstrap `PREVIEW_CODE` sessions, tester grants, ordinary merchant roles, another admin email and malformed grants are refused.

The main Rewards flag, pilot-admin flag and preview bridge must all be enabled, with a valid exact organisation allowlist. This helper is used only for ADMIN admission; it does not broaden the merchant business-identity helper. With Rewards disabled, the admin guard and context loader deny access before loading a session or querying the database.

The server loads the current user and complete owner grant, and the service rechecks authority inside its transaction. Administrator, session and existing preview-grant rows are locked for mutations; session identity and authentication method must remain the same. Revocation or a disabled policy cancels the operation. Ordinary PASSWORD/SSO administration retains its existing separate path.

## Rollout

This compatibility change does not set flags, provision accounts, start a rehearsal, or alter registration, streaming or billing. Deploying code and enabling a hosted pilot remain separate decisions. Local tests use synthetic identities and explicitly injected hypothetical policies; the website configuration remains disabled.

Before release, run the Node 20 unit and middleware checks, the website build, and isolated PostgreSQL 16 migration and authentication tests. Never load production credentials into the local checks.
