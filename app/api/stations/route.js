import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import slugify from "@/lib/slugify"; // adjust import if your existing slug helper differs

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json();

  // Only name and description are accepted from clients.
  // Any streaming-related fields sent in the body are ignored on purpose.
  const { name, description } = body;

  if (!name) {
    return NextResponse.json({ error: "Station name is required." }, { status: 400 });
  }

  const membership = await prisma.organisationMember.findFirst({
    where: { userId: user.id },
    include: { organisation: { include: { subscription: { include: { plan: true } }, stations: true } } }
  });

  if (!membership) {
    return NextResponse.json({ error: "No organisation found for this user." }, { status: 400 });
  }

  const org = membership.organisation;
  const plan = org.subscription?.plan;
  const stationCount = org.stations.length;

  if (plan && stationCount >= plan.stationLimit) {
    return NextResponse.json(
      { error: `Your ${plan.name} plan allows up to ${plan.stationLimit} station${plan.stationLimit === 1 ? "" : "s"}.` },
      { status: 403 }
    );
  }

  const station = await prisma.station.create({
    data: {
      organisationId: org.id,
      name,
      description: description || null,
      slug: slugify(name) + "-" + Math.random().toString(36).slice(2, 7),
      status: "PENDING_SETUP",
      listenerLimit: plan?.listenerLimit ?? 100,
      storageLimitGb: plan?.storageLimitGb ?? 2,
      maxBitrateKbps: plan?.maxBitrateKbps ?? 128
    }
  });

  return NextResponse.json({ success: true, station });
}
