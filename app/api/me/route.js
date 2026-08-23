import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/auth";

export async function GET(request) {
  const auth = await authFromRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  }

  const { user, organisation, membership } = auth;

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
