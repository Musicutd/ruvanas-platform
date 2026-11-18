import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionFromToken, SESSION_COOKIE } from "@/lib/session-lookup";
import { readPilotPreviewPolicy } from "./pilot-preview-policy.mjs";
import { pilotPreviewBusinessIdentity } from "./pilot-preview-business.mjs";

export async function loadPilotPreviewBusinessSession() {
  if (!readPilotPreviewPolicy(process.env).enabled) return null;
  const session = await getSessionFromToken((await cookies()).get(SESSION_COOKIE)?.value,
    { db: prisma, env: process.env, allowRewardsPilot: true });
  const identity = pilotPreviewBusinessIdentity(session, process.env);
  return identity ? { ...session, pilotLanding: identity.landing } : null;
}
