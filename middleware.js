import { NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigins(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([request.nextUrl.origin, ...configured]);
}

export function middleware(request) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");

    if (!origin || !allowedOrigins(request).has(origin)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "ORIGIN_REJECTED",
          requestId,
          method: request.method,
          path: request.nextUrl.pathname
        })
      );

      return NextResponse.json(
        { error: "This request did not originate from an approved Ruvanas site." },
        { status: 403, headers: { "x-request-id": requestId } }
      );
    }
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders }
  });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: "/api/:path*"
};
