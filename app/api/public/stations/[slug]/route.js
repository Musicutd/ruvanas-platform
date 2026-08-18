import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request, { params }) {
  try {
    const station = await prisma.station.findFirst({
      where: {
        slug: params.slug,
        status: "ACTIVE"
      },
      include: {
        streamConfig: {
          select: {
            streamUrl: true
          }
        }
      }
    });

    if (!station) {
      return NextResponse.json(
        { error: "Station not found." },
        { status: 404 }
      );
    }

    if (!station.streamConfig?.streamUrl) {
      return NextResponse.json(
        { error: "This station does not have a public stream configured." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: station.id,
      name: station.name,
      slug: station.slug,
      streamUrl: station.streamConfig.streamUrl
    });
  } catch (error) {
    console.error("Public station API error:", error);

    return NextResponse.json(
      { error: "Unable to load station." },
      { status: 500 }
    );
  }
}
