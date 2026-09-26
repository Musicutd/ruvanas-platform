import { cookies } from "next/headers";
import { findCorrectionsContributorSession, safeCorrectionsStudioSession } from "@/lib/corrections-studio-service";
import { correctionsStudioCan } from "@/lib/corrections-studio-policy.mjs";

export const CORRECTIONS_STUDIO_COOKIE = "ruvanas_inside_studio";

export async function currentCorrectionsContributorSession(capability) {
  const jar = await cookies();
  if (jar.get("ruvanas_session")) return null;
  const access = await findCorrectionsContributorSession(jar.get(CORRECTIONS_STUDIO_COOKIE)?.value || "");
  return access && (!capability || correctionsStudioCan(access.session, capability)) ? access : null;
}

export function safeContributorWorkspace(access) {
  return { session: safeCorrectionsStudioSession(access.session), studioLevel: access.entitlements.studioLevel, studioProEnabled: access.entitlements.studioProEnabled };
}

export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
