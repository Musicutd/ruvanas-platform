import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import {
  registerPreprovisionedRadioStream,
  RadioStreamRegistrationError
} from "@/lib/preprovisioned-radio-stream-registration.mjs";

async function requireSuperAdmin() {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { response: accessDenied(access) };
  if (access.user.role !== "SUPER_ADMIN") {
    return { response: NextResponse.json({ error: "Super Admin access is required." }, { status: 403 }) };
  }
  return { user: access.user };
}

export async function GET() {
  const access = await requireSuperAdmin();
  if (access.response) return access.response;
  const slots = await prisma.preprovisionedRadioStream.findMany({
    select: {
      id: true, centovaUsername: true, streamUrl: true, serverHost: true,
      serverPort: true, sourcePort: true, listenerLimit: true,
      maxBitrateKbps: true, status: true, verifiedAt: true,
      stationId: true, createdAt: true
    },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ slots }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const access = await requireSuperAdmin();
  if (access.response) return access.response;
  try {
    const input = await request.json();
    const slot = await registerPreprovisionedRadioStream(prisma, {
      input,
      actorUserId: access.user.id
    });
    return NextResponse.json({
      slot,
      notice: "Stream recorded in quarantine. It cannot be assigned until its provider details and listener output are verified."
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RadioStreamRegistrationError && error.code === "INVALID_STREAM_SLOT") {
      return NextResponse.json({ error: "Enter a valid public HTTPS listener, Centova source details, capacity and source password." }, { status: 400 });
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    if (error?.code === "STREAM_SLOT_ALREADY_USED" || error?.code === "P2002") {
      return NextResponse.json({ error: "This account, listener URL or live-source endpoint is already registered or assigned." }, { status: 409 });
    }
    console.error("Radio stream registration failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "The stream could not be recorded." }, { status: 500 });
  }
}
