import { NextResponse } from "next/server";
import { setActiveOrganisation } from "@/lib/auth";

export async function POST(request) {
  try {
    const body = await request.json();
    const organisationId =
      typeof body.organisationId === "string" ? body.organisationId.trim() : "";

    if (!organisationId) {
      return NextResponse.json(
        { error: "Choose an organisation." },
        { status: 400 }
      );
    }

    const result = await setActiveOrganisation(organisationId);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      ok: true,
      organisation: {
        id: result.membership.organisation.id,
        name: result.membership.organisation.name,
        slug: result.membership.organisation.slug
      }
    });
  } catch (error) {
    console.error("Unable to change active organisation:", error);
    return NextResponse.json(
      { error: "Unable to change organisation." },
      { status: 500 }
    );
  }
}

