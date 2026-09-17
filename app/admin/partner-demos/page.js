import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { partnerDemoStatus } from "@/lib/partner-demo-access.mjs";
import PartnerDemoAdmin from "./PartnerDemoAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partner demos | Ruvanas Super Admin" };

export default async function PartnerDemosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");

  const invitations = await prisma.partnerDemoInvitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, partnerName: true, recipientEmail: true, codeSuffix: true,
      codeExpiresAt: true, sessionExpiresAt: true, redeemedAt: true, revokedAt: true, createdAt: true
    }
  });

  return <PartnerDemoAdmin invitations={invitations.map((invitation) => ({
    id: invitation.id,
    partnerName: invitation.partnerName,
    recipientEmail: invitation.recipientEmail,
    codeSuffix: invitation.codeSuffix,
    status: partnerDemoStatus(invitation),
    codeExpiresAt: invitation.codeExpiresAt.toISOString(),
    sessionExpiresAt: invitation.sessionExpiresAt?.toISOString() || null,
    createdAt: invitation.createdAt.toISOString()
  }))} />;
}
