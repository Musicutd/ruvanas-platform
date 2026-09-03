const AUTH_METHOD_LABELS = Object.freeze({
  PASSWORD: "Password",
  SSO: "Company sign-in"
});

export function normalizeSubscriberProfileName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new Error("Your display name must be between 2 and 80 characters.");
  }
  return name;
}

export function validateSubscriberPasswordChange(input = {}) {
  const currentPassword = String(input.currentPassword || "");
  const newPassword = String(input.newPassword || "");
  const confirmation = String(input.confirmation || "");

  if (!currentPassword || currentPassword.length > 128) {
    return { ok: false, error: "Enter your current password." };
  }
  if (newPassword.length < 12 || newPassword.length > 128) {
    return { ok: false, error: "Your new password must contain between 12 and 128 characters." };
  }
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return { ok: false, error: "Your new password must include at least one letter and one number." };
  }
  if (newPassword !== confirmation) {
    return { ok: false, error: "The new password confirmation does not match." };
  }
  if (newPassword === currentPassword) {
    return { ok: false, error: "Choose a new password that is different from your current password." };
  }
  return { ok: true, currentPassword, newPassword };
}

export function subscriberPasswordChangeAllowed(policy = null) {
  return !(policy?.ssoRequired && policy.passwordFallback === false);
}

export function subscriberSessionSummary(session, currentSessionId, now = new Date()) {
  const expiresAt = new Date(session.expiresAt);
  const lastSeenAt = new Date(session.lastSeenAt);
  return {
    id: session.id,
    current: session.id === currentSessionId,
    authentication: AUTH_METHOD_LABELS[String(session.authMethod || "PASSWORD").toUpperCase()] || "Secure sign-in",
    organisationName: session.activeOrganisation?.name || "No organisation selected",
    createdAt: new Date(session.createdAt).toISOString(),
    lastSeenAt: lastSeenAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    active: !session.revokedAt && expiresAt > new Date(now)
  };
}

export function canRevokeSubscriberSession(summary) {
  return Boolean(summary?.active && !summary.current);
}
