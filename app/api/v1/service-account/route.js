import { NextResponse } from "next/server";
import { authenticateServiceAccount } from "@/lib/service-account-auth";
import { consumeRateLimit } from "@/lib/rate-limit";

const API_LIMIT = 120;

function rateHeaders(rate) {
  return { "x-ratelimit-limit": String(API_LIMIT), "x-ratelimit-remaining": String(rate.remaining), ...(rate.allowed ? {} : { "retry-after": String(rate.retryAfterSeconds) }) };
}

export async function GET(request) {
  try {
    const access = await authenticateServiceAccount(request, "organisation:read");
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const rate = await consumeRateLimit({ key: `public-api:${access.key.id}`, limit: API_LIMIT, windowMs: 60_000 });
    if (!rate.allowed) return NextResponse.json({ error: "API rate limit exceeded." }, { status: 429, headers: rateHeaders(rate) });

    return NextResponse.json({
      serviceAccount: {
        id: access.serviceAccount.id,
        name: access.serviceAccount.name,
        scopes: access.serviceAccount.scopes,
        expiresAt: access.serviceAccount.expiresAt
      },
      organisation: {
        id: access.organisation.id,
        name: access.organisation.name,
        slug: access.organisation.slug
      }
    }, { headers: rateHeaders(rate) });
  } catch (error) {
    console.error("Service account authentication error:", error);
    return NextResponse.json({ error: "Unable to authenticate the service account." }, { status: 500 });
  }
}

