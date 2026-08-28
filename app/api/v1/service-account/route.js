import { NextResponse } from "next/server";
import { authenticateServiceAccount } from "@/lib/service-account-auth";

export async function GET(request) {
  try {
    const access = await authenticateServiceAccount(request, "organisation:read");
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    return NextResponse.json({
      serviceAccount: {
        id: access.serviceAccount.id,
        name: access.serviceAccount.name,
        scopes: access.serviceAccount.scopes,
        expiresAt: access.serviceAccount.expiresAt
      },
      organisation: {
        id: access.organisation.id,
        name: access.organisation.name,
        slug: access.organisation.slug
      }
    });
  } catch (error) {
    console.error("Service account authentication error:", error);
    return NextResponse.json({ error: "Unable to authenticate the service account." }, { status: 500 });
  }
}
