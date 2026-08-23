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

    const membership = await prisma.organisationMember.findFirst({
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

    if (!membership) {
      return NextResponse.json(
        { error: "No organisation membership found for this user" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      organisation: membership.organisation,
      membership: {
        id: membership.id,
        role: membership.role
      }
    });
  } catch (error) {
    console.error("Unable to load current user:", error);

    return NextResponse.json(
      { error: "Unable to load the current session" },
      { status: 500 }
    );
  }
}
