import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session_token")?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
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
    return NextResponse.json(
      { error: "Session not found" },
      { status: 401 }
    );
  }

  if (session.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "Session expired" },
      { status: 401 }
    );
  }

  const membership = session.user.memberships[0];
  if (!membership) {
    return NextResponse.json(
      { error: "No organisation membership" },
      { status: 403 }
    );
  }

  const user = session.user;
  const organisation = membership.organisation;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    },
    organisation: {
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug
    },
    membership: {
      role: membership.role
    }
  });
}
