import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPlayerToken } from "@/lib/player-tokens.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

export const SIGNAGE_DEVICE_COOKIE = "ruvanas_signage";
const DEVICE_SESSION_DAYS = 180;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return secret;
}

export function digitalSignageTokenHash(token) {
  return hashPlayerToken(token, sessionSecret());
}

export function setDigitalSignageDeviceCookie(token) {
  cookies().set(SIGNAGE_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: DEVICE_SESSION_DAYS * 24 * 60 * 60,
    path: "/"
  });
}

export async function getCurrentDigitalSignageDevice() {
  const token = cookies().get(SIGNAGE_DEVICE_COOKIE)?.value;
  if (!token) return null;
  const device = await prisma.digitalSignageDevice.findUnique({
    where: { sessionTokenHash: digitalSignageTokenHash(token) },
    include: {
      organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } },
      zone: { include: { location: { select: { id: true, name: true, timezone: true } } } }
    }
  });
  if (!device || device.status === "DISABLED") return null;
  return resolveEntitlements(device.organisation.subscription).digitalSignageEnabled ? device : null;
}
