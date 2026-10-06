import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GENERAL_STATION_MANAGEMENT_WHERE } from "@/lib/general-station-boundary.mjs";

export async function GET(request, { params }) {
  try {
    const station = await prisma.station.findFirst({
      where: {
        slug: params.slug,
        status: "ACTIVE",
        publicPlayerEnabled: true,
        ...GENERAL_STATION_MANAGEMENT_WHERE
      },
      select: { id: true, name: true, slug: true, description: true, logoUrl: true, publicPlayerTagline: true, publicPlayerAccent: true, stationWebsiteEnabled: true }
    });

    if (!station) {
      return NextResponse.json(
        { error: "Station not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: station.id,
      name: station.name,
      slug: station.slug,
      description: station.description,
      logoUrl: station.logoUrl,
      tagline: station.publicPlayerTagline,
      accent: station.publicPlayerAccent,
      listenUrl: `/listen/${station.slug}`,
      embedUrl: `/embed/${station.slug}`,
      websiteUrl: station.stationWebsiteEnabled ? `/radio/${station.slug}` : null
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Public station API error:", error);

    return NextResponse.json(
      { error: "Unable to load station." },
      { status: 500 }
    );
  }
}
