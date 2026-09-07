import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function POST() {
  try {
    await destroySession();

    return new NextResponse(null, {
      status: 303,
      headers: { location: "/login" }
    });
  } catch (error) {
    console.error("Logout failed:", error);

    return NextResponse.json(
      { error: "Unable to sign out. Please try again." },
      { status: 500 }
    );
  }
}
