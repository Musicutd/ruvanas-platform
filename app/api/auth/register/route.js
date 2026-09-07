import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import {
  createProductRegistration,
  parseRegistrationRequest,
  ProductRegistrationError
} from "@/lib/product-registration.mjs";
import { securityLog } from "@/lib/security-log";

const REGISTRATION_LIMIT = 5;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request) {
  try {
    const rateLimitKey = createRateLimitKey("register", request);
    const rateLimit = await consumeRateLimit({
      key: rateLimitKey,
      limit: REGISTRATION_LIMIT,
      windowMs: REGISTRATION_WINDOW_MS
    });

    if (!rateLimit.allowed) {
      securityLog("warn", "REGISTRATION_RATE_LIMITED", request, { rateLimitKey });
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const parsed = parseRegistrationRequest(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please complete all required fields and choose a valid Ruvanas service and plan." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const result = await createProductRegistration(prisma, {
      registration: parsed.data,
      passwordHash
    });

    await createSession(result.user.id, result.organisation.id);
    securityLog("info", "REGISTRATION_SUCCEEDED", request, {
      userId: result.user.id,
      organisationId: result.organisation.id,
      productFamily: result.plan.productFamily,
      planCode: result.plan.code,
      registrationSource: parsed.data.source
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email
        },
        organisation: {
          id: result.organisation.id,
          name: result.organisation.name
        },
        subscription: {
          status: result.subscription.status,
          trialEndsAt: result.trialEndsAt,
          plan: result.plan
        },
        recommendedDashboardRoute: result.recommendedDashboardRoute
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ProductRegistrationError) {
      securityLog("warn", "REGISTRATION_REJECTED", request, {
        reason: error.code
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    securityLog("error", "REGISTRATION_ERROR", request, {
      error: error instanceof Error ? error.message : "unknown"
    });

    return NextResponse.json(
      { error: "Unable to create your account. Please try again." },
      { status: 500 }
    );
  }
}

