import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    let organisations;

    if (user.role === "SUPER_ADMIN") {
      organisations = await prisma.organisation.findMany({
        select: {
          id: true,
          name: true,
          slug: true
        },
        orderBy: {
          name: "asc"
        }
      });
    } else {
      const memberships = await prisma.organisationMember.findMany({
        where: {
          userId: user.id
        },
        select: {
          organisation: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      });

      organisations = memberships.map((membership) => membership.organisation);
    }

    return NextResponse.json({ organisations });
  } catch (error) {
    console.error("Unable to load organisations for media upload:", error);

    return NextResponse.json(
      { error: "Unable to load organisations." },
      { status: 500 }
    );
  }
}
