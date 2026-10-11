import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { loginLandingRoute } from "@/lib/login-routing.mjs";
import { isPrivatePreviewUserAllowed, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { clearRateLimit, consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_PREVIEW_FORM_BYTES = 16 * 1024;

function previewFormRedirect(reason) {
  const code = ["credentials", "rate-limited", "unavailable"].includes(reason) ? reason : "unavailable";
  return new Response(null, {
    status: 303,
    headers: { location: `/preview-login?error=${code}`, "cache-control": "no-store" }
  });
}

function safeRelativeLanding(route) {
  if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(route)) {
    return "/dashboard";
  }
  return route;
}

async function readPreviewForm(request) {
  const advertised = request.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_PREVIEW_FORM_BYTES)) {
    throw new Error("Preview form exceeds the permitted size.");
  }
  const reader = request.body?.getReader?.();
  if (!reader) return { email: "", password: "" };
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_PREVIEW_FORM_BYTES) {
      void reader.cancel().catch(() => {});
      throw new Error("Preview form exceeds the permitted size.");
    }
    chunks.push(Buffer.from(value));
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  const keys = [...params.keys()];
  if (keys.some((key) => !["email", "password"].includes(key)) || params.getAll("email").length !== 1 || params.getAll("password").length !== 1) {
    throw new Error("Preview form fields are invalid.");
  }
  return { email: params.get("email"), password: params.get("password") };
}

export async function POST(request) {
  const previewPolicy = readPrivatePreviewPolicy(process.env);
  const previewEnabled = previewPolicy.enabled;
  const previewForm = previewEnabled && /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get("content-type") || "");
  if (previewEnabled && !previewPolicy.valid) {
    return NextResponse.json({ error: "Private preview is unavailable." }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
  try {
    const body = previewForm ? await readPreviewForm(request) : await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const rateLimitKey = createRateLimitKey("login", request, email);
    const rateLimit = await consumeRateLimit({
      key: rateLimitKey,
      limit: LOGIN_LIMIT,
      windowMs: LOGIN_WINDOW_MS
    });

    if (!rateLimit.allowed) {
      securityLog("warn", "LOGIN_RATE_LIMITED", request, { rateLimitKey });
      if (previewForm) return previewFormRedirect("rate-limited");
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    if (!email || !password) {
      if (previewForm) return previewFormRedirect("credentials");
      return NextResponse.json(
        { error: "Enter your email address and password." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      securityLog("warn", "LOGIN_FAILED", request, { reason: "invalid_credentials" });
      if (previewForm) return previewFormRedirect("credentials");
      return NextResponse.json(
        { error: "Incorrect email address or password." },
        { status: 401 }
      );
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      securityLog("warn", "LOGIN_FAILED", request, {
        reason: "invalid_credentials",
        userId: user.id
      });
      if (previewForm) return previewFormRedirect("credentials");
      return NextResponse.json(
        { error: "Incorrect email address or password." },
        { status: 401 }
      );
    }

    if (previewEnabled && !isPrivatePreviewUserAllowed(user, previewPolicy)) {
      securityLog("warn", "LOGIN_FAILED", request, { reason: "invalid_credentials" });
      if (previewForm) return previewFormRedirect("credentials");
      return NextResponse.json(
        { error: "Incorrect email address or password." },
        { status: 401 }
      );
    }

    const membership = await prisma.organisationMember.findFirst({
      where: { userId: user.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        organisation: {
          include: {
            subscription: { include: { plan: true, billingContract: true } }
          }
        }
      }
    });
    const recommendedDashboardRoute = loginLandingRoute({
      role: user.role,
      hasMembership: Boolean(membership),
      entitlements: membership
        ? resolveEntitlements(membership.organisation.subscription)
        : {}
    });

    await createSession(user.id, membership?.organisationId || null);
    await clearRateLimit(rateLimitKey);
    securityLog("info", "LOGIN_SUCCEEDED", request, { userId: user.id });

    if (previewForm) {
      return new Response(null, {
        status: 303,
        headers: { location: safeRelativeLanding(recommendedDashboardRoute), "cache-control": "no-store" }
      });
    }

    return NextResponse.json({
      success: true,
      recommendedDashboardRoute,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    securityLog("error", "LOGIN_ERROR", request, {
      error: previewEnabled ? "preview_login_failed" : error instanceof Error ? error.message : "unknown"
    });

    if (previewForm) return previewFormRedirect("unavailable");

    return NextResponse.json(
      { error: "Unable to sign in. Please try again." },
      { status: 500 }
    );
  }
}
