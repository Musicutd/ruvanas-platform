import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function POST(request) {
  try {
    await destroySession();

    return NextResponse.redirect(new URL("/login", request.url), 303);
  } catch (error) {
    console.error("Logout failed:", error);

    return NextResponse.json(
      { error: "Unable to sign out. Please try again." },
      { status: 500 }
    );
  }
}
