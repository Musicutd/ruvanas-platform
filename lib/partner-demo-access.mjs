import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const PARTNER_DEMO_COOKIE = "ruvanas_partner_demo";
export const PARTNER_DEMO_CODE_HOURS = 48;
export const PARTNER_DEMO_SESSION_DAYS = 7;

export const createPartnerDemoSchema = z.object({
  partnerName: z.string().trim().min(2).max(120),
  recipientEmail: z.string().trim().toLowerCase().email().max(320)
});

export const redeemPartnerDemoSchema = z.object({
  code: z.string().trim().regex(/^RVDEMO-[A-Za-z0-9_-]{32}$/, "Enter the complete partner demo code."),
  email: z.string().trim().toLowerCase().email().max(320)
});

export function hashPartnerDemoToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function newPartnerDemoCode() {
  return `RVDEMO-${randomBytes(24).toString("base64url")}`;
}

export function newPartnerDemoSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function partnerDemoStatus(invitation, now = new Date()) {
  if (invitation.revokedAt) return "REVOKED";
  if (invitation.redeemedAt) {
    return invitation.sessionExpiresAt && invitation.sessionExpiresAt > now ? "ACTIVE" : "EXPIRED";
  }
  return invitation.codeExpiresAt > now ? "INVITED" : "EXPIRED";
}

export function partnerDemoSessionValid(invitation, now = new Date()) {
  return Boolean(
    invitation && !invitation.revokedAt && invitation.redeemedAt &&
    invitation.sessionHash && invitation.sessionExpiresAt && invitation.sessionExpiresAt > now
  );
}
