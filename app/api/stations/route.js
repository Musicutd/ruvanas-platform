import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function createSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const membership = await prisma.organisationMember.findFirst({
      where: {
        userId: user.id
      }
    });

    if (!membership) {
      return NextResponse.json(
        { error: "Organisation membership not found." },
        { status: 403 }
      );
    }

    const stations = await prisma.station.findMany({
      where: {
        organisationId: membership.organisationId
      },
      include: {
        streamConfig: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return NextResponse.json({ stations });
  } catch (error) {
    console.error("Failed to load stations:", error);

    return NextResponse.json(
      { error: "Unable to load stations." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();

    if (!name) {
      return NextResponse.json(
        { error: "Station name is required." },
        { status: 400 }
      );
    }

    const membership = await prisma.organisationMember.findFirst({
      where: {
        userId: user.id
      },
      include: {
        organisation: {
          include: {
            subscription: {
              include: {
                plan: true
              }
            }
          }
        }
      }
    });

    if (!membership) {
      return NextResponse.json(
        { error: "Organisation membership not found." },
        { status: 403 }
      );
    }

    const organisation = membership.organisation;
    const plan = organisation.subscription?.plan;

    if (!plan) {
      return NextResponse.json(
        { error: "Your organisation does not have an active plan." },
        { status: 403 }
      );
    }

    const stationCount = await prisma.station.count({
      where: {
        organisationId: organisation.id
      }
    });

    if (stationCount >= plan.stationLimit) {
      return NextResponse.json(
        {
          error: `Your ${plan.name} plan allows up to ${plan.stationLimit} station.`
        },
        { status: 403 }
      );
    }

    const baseSlug = createSlug(name) || "radio-station";
    let slug = baseSlug;
    let attempt = 1;

    while (await prisma.station.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${attempt}`;
      attempt += 1;
    }

    const station = await prisma.station.create({
      data: {
        organisationId: organisation.id,
        name,
        slug,
        description: description || null,
        status: "PENDING_SETUP",
        listenerLimit: plan.listenerLimit,
        storageLimitGb: plan.storageLimitGb,
        maxBitrateKbps: plan.maxBitrateKbps,
        providerName: "streamerr"
      }
    });

    await prisma.auditLog.create({
      data: {
        organisationId: organisation.id,
        actorUserId: user.id,
        action: "STATION_CREATED",
        entityType: "Station",
        entityId: station.id,
        details: {
          name: station.name,
          slug: station.slug,
          provider: "streamerr"
        }
      }
    });

    return NextResponse.json({ station }, { status: 201 });
  } catch (error) {
    console.error("Failed to create station:", error);

    return NextResponse.json(
      { error: "Unable to create station. Please try again." },
      { status: 500 }
    );
  }
}
