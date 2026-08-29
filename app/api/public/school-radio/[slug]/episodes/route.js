import { NextResponse } from "next/server";
import { loadPublicSchoolPage } from "@/lib/public-school-podcast";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { slug: routeSlug } = await params;
  const slug = String(routeSlug || "").trim().toLowerCase();
  const rateLimit = await consumeRateLimit({ key: createRateLimitKey("public-school-podcast", request, slug), limit: 120, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  const page = await loadPublicSchoolPage(slug);
  if (!page) return NextResponse.json({ error: "This public school radio page is not available." }, { status: 404 });
  return NextResponse.json(page, { headers: { "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300" } });
}
