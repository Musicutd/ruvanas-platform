import { NextResponse } from "next/server";
import { publicRequestOrigin } from "@/lib/origin-policy.mjs";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isServiceAccountApiRequest(request) {
  return request.nextUrl.pathname.startsWith("/api/v1/") &&
    /^Bearer\s+rvsa_[a-f0-9]{12}_[a-f0-9]{64}$/i.test(request.headers.get("authorization") || "");
}

function allowedOrigins(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const publicOrigin = publicRequestOrigin({
    nextOrigin: request.nextUrl.origin,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto")
  });

  return new Set(
    [request.nextUrl.origin, publicOrigin, ...configured].filter(Boolean)
  );
}

export function middleware(request) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  if (!SAFE_METHODS.has(request.method) && !isServiceAccountApiRequest(request)) {
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

