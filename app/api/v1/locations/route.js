import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateServiceAccount } from "@/lib/service-account-auth";
import { consumeRateLimit } from "@/lib/rate-limit";

const API_LIMIT = 120;
const MAX_PAGE_SIZE = 100;

function rateHeaders(rate) {
  return { "x-ratelimit-limit": String(API_LIMIT), "x-ratelimit-remaining": String(rate.remaining), ...(rate.allowed ? {} : { "retry-after": String(rate.retryAfterSeconds) }) };
}

export async function GET(request) {
  try {
    const access = await authenticateServiceAccount(request, "locations:read");
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const rate = await consumeRateLimit({ key: `public-api:${access.key.id}`, limit: API_LIMIT, windowMs: 60_000 });
    if (!rate.allowed) return NextResponse.json({ error: "API rate limit exceeded." }, { status: 429, headers: rateHeaders(rate) });

    const url = new URL(request.url);
    const take = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), MAX_PAGE_SIZE);
    const cursor = url.searchParams.get("cursor");
    const locations = await prisma.location.findMany({
      where: { organisationId: access.organisation.id },
      select: { id: true, name: true, slug: true, timezone: true, status: true, createdAt: true, updatedAt: true },
      orderBy: { id: "asc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    const hasMore = locations.length > take;
    const data = hasMore ? locations.slice(0, take) : locations;
    await prisma.auditLog.create({ data: { organisationId: access.organisation.id, actorServiceAccountId: access.serviceAccount.id, action: "PUBLIC_API_LOCATIONS_READ", entityType: "Location", details: { count: data.length } } });
    return NextResponse.json({ data, nextCursor: hasMore ? data.at(-1)?.id : null }, { headers: rateHeaders(rate) });
  } catch (error) {
    if (error?.code === "P2025") return NextResponse.json({ error: "The pagination cursor is invalid." }, { status: 400 });
    console.error("Public locations API error:", error);
    return NextResponse.json({ error: "Unable to load locations." }, { status: 500 });
  }
}

