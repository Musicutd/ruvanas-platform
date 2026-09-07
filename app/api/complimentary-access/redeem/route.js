import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  return NextResponse.json({
    error: "Client activation is disabled. Only a Ruvanas Super Admin can grant complimentary access."
  }, { status: 403 });
}
