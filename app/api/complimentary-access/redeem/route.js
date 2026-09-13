import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import {
  ComplimentaryRegistrationError,
  createComplimentaryRegistration,
  parseComplimentaryRegistrationRequest
} from "@/lib/complimentary-registration.mjs";
import { securityLog } from "@/lib/security-log";

const REGISTRATION_LIMIT = 5;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request) {
  try {
    const rateLimitKey = createRateLimitKey("complimentary-register", request);
    const rateLimit = await consumeRateLimit({
      key: rateLimitKey,
      limit: REGISTRATION_LIMIT,
      windowMs: REGISTRATION_WINDOW_MS
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const parsed = parseComplimentaryRegistrationRequest(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter the code and complete all required account details." }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const result = await createComplimentaryRegistration(prisma, {
      registration: parsed.data,
      passwordHash
    });
    await createSession(result.user.id, result.organisation.id);
    securityLog("info", "COMPLIMENTARY_REGISTRATION_SUCCEEDED", request, {
      userId: result.user.id,
      organisationId: result.organisation.id,
      productFamily: result.plan.productFamily,
      planCode: result.plan.code
    });

    return NextResponse.json({
      success: true,
      user: { id: result.user.id, name: result.user.name, email: result.user.email },
      organisation: { id: result.organisation.id, name: result.organisation.name },
      subscription: { status: result.subscription.status, complimentaryAccess: true, plan: result.plan },
      recommendedDashboardRoute: result.recommendedDashboardRoute
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ComplimentaryRegistrationError) {
      securityLog("warn", "COMPLIMENTARY_REGISTRATION_REJECTED", request, { reason: error.code });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "This code has already been used or the email already has an account." }, { status: 409 });
    }
    securityLog("error", "COMPLIMENTARY_REGISTRATION_ERROR", request, {
      error: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.json({ error: "Unable to create the free account. Please try again." }, { status: 500 });
  }
}
