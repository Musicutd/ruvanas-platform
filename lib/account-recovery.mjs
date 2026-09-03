import crypto from "node:crypto";
import { isEmailAddress } from "./notification-email.mjs";

export const ACCOUNT_RECOVERY_TTL_MINUTES = 30;
export const ACCOUNT_RECOVERY_MESSAGE = "If an eligible Ruvanas account uses that email address, a secure recovery link will be sent shortly.";

export function normalizeRecoveryEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!isEmailAddress(email)) throw new Error("Enter a valid email address.");
  return email;
}

export function createAccountRecoveryToken(now = new Date()) {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashAccountRecoveryToken(token),
    expiresAt: new Date(now.getTime() + ACCOUNT_RECOVERY_TTL_MINUTES * 60 * 1_000)
  };
}

export function hashAccountRecoveryToken(token) {
  const value = String(token || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("This recovery link is incomplete or invalid.");
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function validateRecoveryPassword(input = {}) {
  const password = String(input.password || "");
  const confirmation = String(input.confirmation || "");
  if (password.length < 12 || password.length > 128) {
    return { ok: false, error: "Your new password must contain between 12 and 128 characters." };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, error: "Your new password must include at least one letter and one number." };
  }
  if (password !== confirmation) {
    return { ok: false, error: "The new password confirmation does not match." };
  }
  return { ok: true, password };
}

export function accountAllowsPasswordRecovery(user) {
  if (!user || user.role === "STUDENT") return false;
  if (user.role === "SUPER_ADMIN") return true;
  return (user.memberships || []).some(({ organisation }) => {
    const policy = organisation?.enterpriseSecurityPolicy;
    return !(policy?.ssoRequired && policy.passwordFallback === false);
  });
}

export function passwordRecoveryOrganisationId(user) {
  const membership = (user?.memberships || []).find(({ organisation }) => {
    const policy = organisation?.enterpriseSecurityPolicy;
    return !(policy?.ssoRequired && policy.passwordFallback === false);
  });
  return membership?.organisationId || null;
}

export function resolveRecoveryOrigin(requestUrl, env = process.env) {
  const configured = String(env.RUVANAS_PUBLIC_URL || "").trim();
  const candidate = new URL(configured || requestUrl);
  const local = candidate.hostname === "localhost" || candidate.hostname === "127.0.0.1";
  if ((candidate.protocol !== "https:" && !(local && candidate.protocol === "http:")) || candidate.username || candidate.password) {
    throw new Error("RUVANAS_PUBLIC_URL must be a public HTTPS origin.");
  }
  return candidate.origin;
}

export function buildAccountRecoveryEmail({ recipientEmail, from, resetUrl, tokenId, expiresAt }) {
  if (!isEmailAddress(recipientEmail) || !isEmailAddress(from)) throw new Error("A valid recovery email address is required.");
  const link = new URL(resetUrl);
  const local = link.hostname === "localhost" || link.hostname === "127.0.0.1";
  if ((link.protocol !== "https:" && !(local && link.protocol === "http:")) || link.username || link.password) {
    throw new Error("Recovery links must use HTTPS.");
  }
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) throw new Error("A valid recovery expiry is required.");
  const idempotencyKey = crypto.createHash("sha256")
    .update(`account-recovery:${tokenId}:${recipientEmail.toLowerCase()}`)
    .digest("hex");
  return {
    from,
    to: recipientEmail.toLowerCase(),
    subject: "Reset your Ruvanas password",
    text: [
      "A password reset was requested for your Ruvanas account.",
      "",
      `Open this private link within ${ACCOUNT_RECOVERY_TTL_MINUTES} minutes:`,
      link.href,
      "",
      "The link works once. If you did not request this, you can safely ignore this message. Your password has not changed.",
      "Ruvanas will never ask you to send this link or your password by email."
    ].join("\n"),
    idempotencyKey
  };
}
