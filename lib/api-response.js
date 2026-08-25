import { NextResponse } from "next/server";

export function accessDenied(access) {
  return NextResponse.json(
    { error: access.error },
    { status: access.status }
  );
}
