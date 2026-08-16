import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { callCentovaAuthenticated } from "@/lib/centova";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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
