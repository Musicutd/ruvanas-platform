import { cookies } from "next/headers";
import { getCurrentUser } from "./auth";
import { prisma } from "./prisma";
import { hashPartnerDemoToken, partnerDemoSessionValid, PARTNER_DEMO_COOKIE } from "./partner-demo-access.mjs";

export async function getPartnerDemoAccess() {
  const user = await getCurrentUser();
  if (user?.role === "SUPER_ADMIN") return { type: "SUPER_ADMIN", partnerName: "Super Admin preview" };

  const token = cookies().get(PARTNER_DEMO_COOKIE)?.value;
  if (!token) return null;
  const invitation = await prisma.partnerDemoInvitation.findUnique({
    where: { sessionHash: hashPartnerDemoToken(token) },
    select: { id: true, partnerName: true, redeemedAt: true, revokedAt: true, sessionHash: true, sessionExpiresAt: true }
  });
  if (!partnerDemoSessionValid(invitation)) return null;
  return { type: "PARTNER", partnerName: invitation.partnerName };
}
