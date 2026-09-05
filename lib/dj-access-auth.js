import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { validateDjAccessToken } from "./dj-access-service";

export const DJ_ACCESS_COOKIE = "ruvanas_dj_access";

export function setDjAccessCookie(rawToken, expiresAt) {
  cookies().set(DJ_ACCESS_COOKIE, rawToken, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(expiresAt) });
}

export function clearDjAccessCookie() {
  cookies().set(DJ_ACCESS_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function getCurrentDjAccessSession({ userId, organisationId = null, channelId = null, requiredCapability = "VIEW_CHANNEL", markUsed = false }) {
  const rawToken = cookies().get(DJ_ACCESS_COOKIE)?.value;
  if (!rawToken || !userId) return null;
  return validateDjAccessToken(prisma, { rawToken, userId, organisationId, channelId, requiredCapability, markUsed });
}

