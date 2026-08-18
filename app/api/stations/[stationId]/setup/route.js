import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  try {
    const stationId = params.stationId;
    const body = await request.json();

    const station = await prisma.station.findUnique({
      where: {
        id: stationId
      },
      include: {
        streamConfig: true
      }
    });

    if (!station) {
      return NextResponse.json(
        { error: "Station not found." },
        { status: 404 }
      );
    }

    const {
      streamUrl,
      mountPoint,
      serverHost,
      serverPort,
      bitrateKbps,
      centovaUsername,
      adminPassword,
      sourcePassword
    } = body;

    const configData = {
      streamUrl: streamUrl?.trim() || null,
      mountPoint: mountPoint?.trim() || null,
      serverHost: serverHost?.trim() || null,
      serverPort: serverPort ? Number(serverPort) : null,
      bitrateKbps: bitrateKbps ? Number(bitrateKbps) : null,
      centovaUsername: centovaUsername?.trim() || null
    };

    if (adminPassword && adminPassword.trim() !== "") {
      configData.adminPassword = adminPassword;
    }

    if (sourcePassword && sourcePassword.trim() !== "") {
      configData.sourcePassword = sourcePassword;
    }

    await prisma.station.update({
      where: {
        id: stationId
      },
      data: {
        streamConfig: {
          upsert: {
            update: configData,
            create: configData
          }
        }
      }
    });

    return NextResponse.json({
      ok: true,
      message: "Streaming configuration saved successfully."
    });
  } catch (error) {
    console.error("Streaming setup save error:", error);

    return NextResponse.json(
      {
        error: "Unable to save streaming configuration."
      },
      { status: 500 }
    );
  }
}
