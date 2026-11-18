export function pilotPreviewOwnerContext(now = new Date()) {
  const user = { id: "preview-owner", email: "owner@example.invalid", role: "SUPER_ADMIN",
    privatePreviewAccess: { userId: "preview-owner", enabled: true, passwordEnabled: true,
      organisationId: null, expiresAt: null, pillars: [] } };
  return { user, session: { id: "preview-session", userId: user.id, authMethod: "PREVIEW_PASSWORD",
    createdAt: new Date(+now - 60_000), lastSeenAt: new Date(+now - 10_000),
    expiresAt: new Date(+now + 3_600_000), revokedAt: null, activeOrganisation: null,
    user: structuredClone(user) } };
}
