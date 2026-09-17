import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPartnerDemoToken, PARTNER_DEMO_COOKIE } from "@/lib/partner-demo-access.mjs";

export async function POST(request) {
  const token = request.cookies.get(PARTNER_DEMO_COOKIE)?.value;
  if (token) {
    await prisma.partnerDemoInvitation.updateMany({
      where: { sessionHash: hashPartnerDemoToken(token) },
      data: { sessionHash: null, sessionExpiresAt: new Date() }
    });
  }
  const response = NextResponse.redirect(new URL("/partner-demo/access", request.url), { status: 303 });
  response.cookies.set(PARTNER_DEMO_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
