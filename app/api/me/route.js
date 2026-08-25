import { NextResponse } from "next/server";
import { getActiveOrganisationContext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await getActiveOrganisationContext();

    if (!context) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { user, membership: activeMembership, memberships } = context;

    if (memberships.length === 0) {
      return NextResponse.json(
        { error: "No organisation membership found for this user" },
        { status: 403 }
      );
    }

    const organisations = memberships.map((membership) => ({
      id: membership.organisation.id,
      name: membership.organisation.name,
      slug: membership.organisation.slug,
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
      organisation: activeMembership.organisation,
      membership: {
        id: activeMembership.id,
        role: activeMembership.role
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

