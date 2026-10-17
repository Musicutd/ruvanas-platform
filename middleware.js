import { NextResponse } from "next/server";
import { publicRequestOrigin } from "@/lib/origin-policy.mjs";
import { readPrivatePreviewPolicy, isPrivatePreviewPublicPath, isPrivatePreviewRegistrationPath, privatePreviewSessionLanding, isPrivatePreviewAdminSession, isPrivatePreviewOwnerBootstrapSession } from "@/lib/private-preview-policy.mjs";
import { privatePreviewTesterRequestAllowed, isPrivatePreviewOnlineDraftSession } from "@/lib/private-preview-tester-policy.mjs";
import { getSessionFromToken, SESSION_COOKIE } from "@/lib/session-lookup.js";
import { catalogueRequestSizePolicy } from "@/lib/catalogue-request-limits.mjs";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LEGACY_MATCHER = (path) => path === "/" || path === "/api" || path.startsWith("/api/");
const PREVIEW_ASSET_PREFIXES = ["/_next/", "/assets/", "/fonts/", "/images/", "/static/"];

function previewResponse(response, requestId) {
  response.headers.set("x-request-id", requestId);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

function previewAsset(path) {
  return PREVIEW_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    path.split("/").at(-1).includes(".");
}

function previewBootstrap(request) {
  const path = request.nextUrl.pathname;
  const method = request.method;
  return ((method === "GET" || method === "HEAD") &&
    (path === "/preview-login" || path === "/login" || path === "/api/private-preview/health")) ||
    (method === "POST" && ["/api/auth/preview-code", "/api/auth/preview-password", "/api/auth/login", "/api/auth/logout"].includes(path));
}

async function previewSessionFromRequest(request) {
  const rawToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (!rawToken || !/^[a-f0-9]{64}$/.test(rawToken)) return null;
  const { prisma } = await import("@/lib/prisma");
  return getSessionFromToken(rawToken, { db: prisma });
}

function previewDenied(request, policy, requestId) {
  const path = request.nextUrl.pathname;
  if ((request.method === "GET" || request.method === "HEAD") && path === "/") {
    return previewResponse(NextResponse.redirect(policy.publicUrl), requestId);
  }
  if (path === "/api" || path.startsWith("/api/")) {
    return previewResponse(NextResponse.json({ error: "Private preview sign-in required." }, { status: 401 }), requestId);
  }
  if (previewAsset(path)) {
    return previewResponse(new NextResponse(null, { status: 404 }), requestId);
  }
  if (request.method === "GET" || request.method === "HEAD") {
    // Keep browser navigation on the configured preview origin, not an
    // internal or client-supplied host from a reverse-proxy request.
    return previewResponse(NextResponse.redirect(new URL(policy.publicSite ? "/login" : "/preview-login", policy.previewOrigin)), requestId);
  }
  return previewResponse(new NextResponse(null, { status: 401 }), requestId);
}

function isServiceAccountApiRequest(request) {
  return request.nextUrl.pathname.startsWith("/api/v1/") &&
    /^Bearer\s+rvsa_[a-f0-9]{12}_[a-f0-9]{64}$/i.test(request.headers.get("authorization") || "");
}

function allowedOrigins(request, preview) {
  // In consolidated public-site mode, neither a client-supplied host header
  // nor a stale Render origin in ALLOWED_ORIGINS can expand the CSRF boundary.
  if (preview?.publicSite) return new Set([preview.previewOrigin]);
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

function requestHostname(request) {
  const value = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  return value.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

function mayBeStationDomain(hostname) {
  return hostname && hostname !== "localhost" && hostname !== "127.0.0.1" && !hostname.endsWith(".onrender.com") && !hostname.endsWith(".ruvanas.com");
}

export async function middleware(request) {
  const preview = readPrivatePreviewPolicy(process.env);
  // The expanded matcher must not change how non-root, non-API requests behave
  // when private preview is disabled.
  if (!preview.enabled && !LEGACY_MATCHER(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  if (preview.enabled) {
    if (!preview.valid) {
      return previewResponse(NextResponse.json({ error: "Private preview is unavailable." }, { status: 503 }), requestId);
    }
    if (isPrivatePreviewRegistrationPath(request.nextUrl.pathname)) {
      return previewResponse(new NextResponse(null, {
        status: request.nextUrl.pathname.startsWith("/api/") ? 403 : 404
      }), requestId);
    }
    if (preview.publicSite) {
      const path = request.nextUrl.pathname;
      const readOnly = request.method === "GET" || request.method === "HEAD";
      let incomingOrigin;
      try {
        incomingOrigin = publicRequestOrigin({ nextOrigin: request.nextUrl.origin,
          host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"),
          forwardedProto: request.headers.get("x-forwarded-proto") });
      } catch { incomingOrigin = null; }
      const knownOrigins = new Set([preview.previewOrigin]);
      if (preview.previewOrigin === "https://www.ruvanas.com") {
        knownOrigins.add("https://ruvanas-platform.onrender.com");
        knownOrigins.add("https://ruvanas.com");
      }
      if (!knownOrigins.has(incomingOrigin)) {
        return previewResponse(new NextResponse(null, { status: 404 }), requestId);
      }
      // Render health probes retain their explicit, non-session bootstrap path
      // on the known service hostname as well as the canonical domain.
      if (readOnly && path === "/api/private-preview/health") {
        return previewResponse(NextResponse.next({ request: { headers: requestHeaders } }), requestId);
      }
      if (incomingOrigin !== preview.previewOrigin) {
        if (!readOnly) return previewResponse(new NextResponse(null, { status: 403 }), requestId);
        // The destination always comes from validated configuration, never
        // request host/userinfo. Set pathname instead of resolving a supplied
        // path; do not carry possible credentials or codes in query strings.
        const canonical = new URL(preview.previewOrigin);
        canonical.pathname = path;
        return previewResponse(NextResponse.redirect(canonical), requestId);
      }
      if (isPrivatePreviewPublicPath(path, preview)) {
        if (!readOnly) return previewResponse(new NextResponse(null, { status: 403 }), requestId);
        const documentPath = path === "/" ? "/public-marketing/index.html" :
          ["/how-it-works", "/how-it-works/"].includes(path) ? "/public-marketing/how-it-works/index.html" : path;
        const documentUrl = new URL(request.url);
        documentUrl.pathname = documentPath;
        documentUrl.search = "";
        const response = documentPath === path ? NextResponse.next({ request: { headers: requestHeaders } }) :
          NextResponse.rewrite(documentUrl, { request: { headers: requestHeaders } });
        response.headers.set("x-request-id", requestId);
        response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
        // The raw public-document handler owns its cache/CSP headers. Return
        // before session/database work; never render the ordinary app home.
        return response;
      }
    }
    const loginEntry = (request.method === "GET" || request.method === "HEAD") &&
      (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/preview-login");
    if (loginEntry || !previewBootstrap(request)) {
      let session = null;
      try {
        session = await previewSessionFromRequest(request);
      } catch {
        return previewResponse(NextResponse.json({ error: "Private preview is unavailable." }, { status: 503 }), requestId);
      }
      const destination = privatePreviewSessionLanding(session, preview);
      if (loginEntry) {
        if (destination) {
          return previewResponse(NextResponse.redirect(new URL(destination, preview.previewOrigin)), requestId);
        }
        if (request.nextUrl.pathname === "/login") {
          return previewResponse(NextResponse.rewrite(new URL("/preview-login", request.url),
            { request: { headers: requestHeaders } }), requestId);
        }
      } else if (!destination) {
        return previewDenied(request, preview, requestId);
      } else if (!isPrivatePreviewAdminSession(session, preview)) {
        const path = request.nextUrl.pathname;
        const staticAsset = (request.method === "GET" || request.method === "HEAD") &&
          ["/_next/static/", "/fonts/", "/images/"].some((prefix) => path.startsWith(prefix));
        const bootstrap = isPrivatePreviewOwnerBootstrapSession(session, preview);
        const bootstrapAllowed = (path === "/admin/private-preview" && ["GET", "HEAD"].includes(request.method)) ||
          (path === "/api/admin/private-preview/password" && request.method === "POST");
        if (!staticAsset && !(bootstrap ? bootstrapAllowed :
          privatePreviewTesterRequestAllowed({ session, pathname: path, method: request.method }))) {
          return previewResponse(NextResponse.json({ error: bootstrap ?
            "Set your admin password in Private access before continuing." : isPrivatePreviewOnlineDraftSession(session) ?
              "This action is unavailable in draft-only Online Radio testing. Broadcasting, publishing, uploads, downloads and paid actions remain blocked." :
              "This page is not included in your read-only tester access." },
          { status: 403 }), requestId);
        }
      }
    }
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  const requestSizePolicy = catalogueRequestSizePolicy(request.nextUrl.pathname, request.method);
  if (Number.isFinite(contentLength) && contentLength > requestSizePolicy.maxBytes) {
    const response = NextResponse.json(
      { error: requestSizePolicy.error },
      { status: 413, headers: { "x-request-id": requestId } }
    );
    return preview.enabled ? previewResponse(response, requestId) : response;
  }

  if (!SAFE_METHODS.has(request.method) && !isServiceAccountApiRequest(request)) {
    const origin = request.headers.get("origin");

    if (!origin || !allowedOrigins(request, preview).has(origin)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "ORIGIN_REJECTED",
          requestId,
          method: request.method,
          path: request.nextUrl.pathname
        })
      );

      const response = NextResponse.json(
        { error: "This request did not originate from an approved Ruvanas site." },
        { status: 403, headers: { "x-request-id": requestId } }
      );
      return preview.enabled ? previewResponse(response, requestId) : response;
    }
  }

  if (request.method === "GET" && request.nextUrl.pathname === "/") {
    const hostname = requestHostname(request);
    if (mayBeStationDomain(hostname)) {
      try {
        const lookup = new URL(`/api/public/station-websites/domains/${encodeURIComponent(hostname)}`, request.nextUrl.origin);
        const headers = { "x-ruvanas-domain-resolution": "1" };
        if (preview.enabled && request.headers.get("cookie")) headers.cookie = request.headers.get("cookie");
        const result = await fetch(lookup, { headers });
        if (result.ok) {
          const body = await result.json();
          if (/^[a-z0-9-]{1,120}$/i.test(body.slug || "")) {
            const destination = request.nextUrl.clone();
            destination.pathname = `/radio/${body.slug}`;
            const rewritten = NextResponse.rewrite(destination, { request: { headers: requestHeaders } });
            rewritten.headers.set("x-request-id", requestId);
            return preview.enabled ? previewResponse(rewritten, requestId) : rewritten;
          }
        }
      } catch {
        // Unknown and temporarily unavailable domains safely receive the Ruvanas homepage.
      }
    }
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders }
  });
  response.headers.set("x-request-id", requestId);
  return preview.enabled ? previewResponse(response, requestId) : response;
}

export const config = {
  runtime: "nodejs",
  matcher: ["/:path*"]
};

