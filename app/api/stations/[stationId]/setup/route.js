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

    if (!streamUrl || !serverHost || !serverPort || !centovaUsername) {
      return NextResponse.json(
        {
          error:
            "Stream URL, server host, server port, and Centova username are required."
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
          error: "Server port must be a whole number between 1 and 65535."
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

    const existingConfig = await prisma.streamConfig.findUnique({
      where: {
        stationId
      },
      select: {
        id: true
      }
    });

    const streamConfigData = {
      streamUrl: streamUrl.trim(),
      mountPoint: mountPoint?.trim() || null,
      serverHost: serverHost.trim(),
      serverPort: parsedServerPort,
      bitrateKbps: parsedBitrateKbps,
      centovaUsername: centovaUsername.trim()
    };

    /*
      The Prisma schema does not contain an `adminPassword` field.
      Therefore, it must never be passed to prisma.streamConfig.create()
      or prisma.streamConfig.update().

      sourcePassword is added only when the user supplies a new value.
      This allows a blank password field to preserve the existing value.
    */
    if (sourcePassword?.trim()) {
      streamConfigData.sourcePassword = sourcePassword.trim();
    }

    if (existingConfig) {
      await prisma.streamConfig.update({
        where: {
          stationId
        },
        data: streamConfigData
      });
    } else {
      await prisma.streamConfig.create({
        data: {
          stationId,
          ...streamConfigData,
          sourcePassword: sourcePassword?.trim() || null
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: "Streaming configuration saved successfully."
    });
  } catch (error) {
    /*
      Do not log `body`, passwords, or full submitted configuration.
      The error itself is enough for Render diagnostics.
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
