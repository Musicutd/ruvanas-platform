import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  try {
    const body = await request.json();

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

    const stationId = params.stationId;

    if (!stationId) {
      return NextResponse.json(
        {
          error: "Station ID is required."
        },
        {
          status: 400
        }
      );
    }

    if (!streamUrl?.trim()) {
      return NextResponse.json(
        {
          error: "Stream URL is required."
        },
        {
          status: 400
        }
      );
    }

    if (!serverHost?.trim()) {
      return NextResponse.json(
        {
          error: "Server host is required."
        },
        {
          status: 400
        }
      );
    }

    if (!centovaUsername?.trim()) {
      return NextResponse.json(
        {
          error: "Centova username is required."
        },
        {
          status: 400
        }
      );
    }

    const parsedServerPort = Number(serverPort);
    const parsedBitrateKbps =
      bitrateKbps === null || bitrateKbps === undefined || bitrateKbps === ""
        ? null
        : Number(bitrateKbps);

    if (
      !Number.isInteger(parsedServerPort) ||
      parsedServerPort < 1 ||
      parsedServerPort > 65535
    ) {
      return NextResponse.json(
        {
          error: "Server port must be a whole number from 1 to 65535."
        },
        {
          status: 400
        }
      );
    }

    if (
      parsedBitrateKbps !== null &&
      (!Number.isInteger(parsedBitrateKbps) || parsedBitrateKbps < 1)
    ) {
      return NextResponse.json(
        {
          error: "Bitrate must be a whole number of at least 1 kbps."
        },
        {
          status: 400
        }
      );
    }

    const station = await prisma.station.findUnique({
      where: {
        id: stationId
      },
      select: {
        id: true
      }
    });

    if (!station) {
      return NextResponse.json(
        {
          error: "Station not found."
        },
        {
          status: 404
        }
      );
    }

    const configData = {
      streamUrl: streamUrl.trim(),
      mountPoint: mountPoint?.trim() || null,
      serverHost: serverHost.trim(),
      serverPort: parsedServerPort,
      bitrateKbps: parsedBitrateKbps,
      centovaUsername: centovaUsername.trim()
    };

    /*
      The schema stores encrypted password fields. This temporary version
      maps the submitted passwords to those schema fields so the station
      configuration can save. Replace this with real encryption before
      production use.
    */
    if (adminPassword?.trim()) {
      configData.adminPasswordEncrypted = adminPassword.trim();
    }

    if (sourcePassword?.trim()) {
      configData.sourcePasswordEncrypted = sourcePassword.trim();
    }

    await prisma.stationStreamConfig.upsert({
      where: {
        stationId
      },
      update: configData,
      create: {
        stationId,
        ...configData
      }
    });

    return NextResponse.json({
      success: true,
      message: "Streaming configuration saved successfully."
    });
  } catch (error) {
    /*
      Never log the submitted request body, as it can contain passwords.
    */
    console.error("Streaming setup save error:", error);

    return NextResponse.json(
      {
        error: "Unable to save streaming configuration."
      },
      {
        status: 500
      }
    );
  }
}
