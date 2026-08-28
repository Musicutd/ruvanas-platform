# Stage 5E — Enterprise identity and security

Stage 5E adds an enterprise security layer without replacing the existing authentication foundation.

## Delivered

- Organisation-scoped session policies with absolute and idle expiry limits.
- Revocable sessions and authentication-method tracking.
- An audited Super Admin emergency action to revoke active organisation sessions.
- Draft OIDC and SAML identity-provider metadata, isolated per organisation.
- A lockout guard: SSO cannot be required before a provider is verified and ready.
- Organisation-scoped service accounts with explicit read-only scopes.
- API keys that are revealed once, stored only as keyed hashes, rotatable, expirable, and revocable.
- A versioned service-account identity endpoint at `GET /api/v1/service-account`.
- Super Admin controls at `/admin/security`.
- Audit entries for policy changes, service-account creation, key rotation, and revocation.

## Compatibility and rollout

- Existing password login remains enabled.
- New security-policy defaults reproduce the existing 30-day session lifetime.
- Identity-provider records remain `DRAFT`; no customer is switched to SSO automatically.
- No provider secret is accepted by this stage. Secrets will be added only with the verified OIDC/SAML callback implementation and will use the existing encrypted-secret facility.
- Migrations are additive and forward-only.

## Service-account key contract

- Format: `rvsa_<public-prefix>_<private-secret>`.
- The public prefix is visible to administrators for identification.
- The private value is returned only at creation or rotation.
- Authentication uses `Authorization: Bearer <key>` and an exact required scope.
- Revoking an account revokes every active key; rotating a key revokes previous active keys.

## Deferred deliberately

- Live OIDC authorization-code and SAML assertion callbacks.
- Customer domain verification and provider metadata signature validation.
- SCIM provisioning.
- Public write APIs and webhook delivery, which belong to the later integration stage.
