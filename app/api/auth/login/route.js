import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { clearRateLimit, consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request) {
  try {
    const body = await request.json();
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
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    if (!email || !password) {
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
      return NextResponse.json(
        { error: "Incorrect email address or password." },
        { status: 401 }
      );
    }

    await createSession(user.id);
    await clearRateLimit(rateLimitKey);
    securityLog("info", "LOGIN_SUCCEEDED", request, { userId: user.id });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    securityLog("error", "LOGIN_ERROR", request, {
      error: error instanceof Error ? error.message : "unknown"
    });

    return NextResponse.json(
      { error: "Unable to sign in. Please try again." },
      { status: 500 }
    );
  }
}
