import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function getSessionUserAndOrganisation() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session_token")?.value;

  if (!sessionToken) {
    return { ok: false, error: "Not authenticated", status: 401 };
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: sessionToken },
    include: {
      user: {
        include: {
          memberships: {
            where: {
              organisation: {
                subscription: {
                  status: {
                    in: ["TRIAL", "ACTIVE", "PAST_DUE"]
                  }
                }
              }
            },
            include: {
              organisation: {
                include: {
                  subscription: {
                    include: {
                      plan: true
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!session) {
    return { ok: false, error: "Session not found", status: 401 };
  }

  if (session.expiresAt < new Date()) {
    return { ok: false, error: "Session expired", status: 401 };
  }

  const membership = session.user.memberships[0];
  if (!membership) {
    return {
      ok: false,
      error: "User has no organisation membership",
      status: 403
    };
  }

  const user = session.user;
  const organisation = membership.organisation;

  return { ok: true, user, organisation, membership };
}
