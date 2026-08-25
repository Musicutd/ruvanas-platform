import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const memberships = await prisma.organisationMember.findMany({
      where: {
        userId: user.id
      },
      orderBy: {
        createdAt: "asc"
      },
      include: {
        organisation: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (memberships.length === 0) {
      return NextResponse.json(
        { error: "No organisation membership found for this user" },
        { status: 403 }
      );
    }

    const primaryMembership = memberships[0];
    const organisations = memberships.map((membership) => ({
      ...membership.organisation,
      membership: {
        id: membership.id,
        role: membership.role
      }
    }));

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      organisation: primaryMembership.organisation,
      membership: {
        id: primaryMembership.id,
        role: primaryMembership.role
      },
      organisations
    });
  } catch (error) {
    console.error("Unable to load current user:", error);

    return NextResponse.json(
      { error: "Unable to load the current session" },
      { status: 500 }
    );
  }
}
