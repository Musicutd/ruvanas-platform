import { NextResponse } from "next/server";
import { callCentovaAuthenticated } from "@/lib/centova";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";

export async function GET() {
  const access = await requirePlatformAdmin();

  if (!access.ok) {
    return accessDenied(access);
  }

  try {
    const result = await callCentovaAuthenticated("server.getstatus");

    return NextResponse.json({
      success: true,
      result
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message
      },
      { status: 500 }
    );
  }
}
