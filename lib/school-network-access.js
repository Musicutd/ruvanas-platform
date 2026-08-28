import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageSchoolNetwork, canViewSchoolNetwork } from "@/lib/school-network.mjs";

export async function requireSchoolNetworkAccess(schoolNetworkId, { manage = false } = {}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "Your session has expired. Please sign in again." };

  const membership = await prisma.schoolNetworkMember.findUnique({
    where: { schoolNetworkId_userId: { schoolNetworkId, userId: user.id } }
  });
  const allowed = manage
    ? canManageSchoolNetwork({ platformRole: user.role, networkRole: membership?.role })
    : canViewSchoolNetwork({ platformRole: user.role, networkRole: membership?.role });

  if (!allowed) return { ok: false, status: 403, error: "You do not have access to this academy network." };
  return { ok: true, user, membership };
}

