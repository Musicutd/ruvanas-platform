import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { getAdminUser } from "@/lib/requireAdmin";

function badRequest(error) {
  return NextResponse.json({ error }, { status: 400 });
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request, { params }) {
  try {
    const adminUser = await getAdminUser();

    if (!adminUser) {
      return NextResponse.json(
        {
          error: "You are not authorised to update streaming configuration."
        },
        {
          status: 403
        }
      );
    }

    const stationId = params.stationId;

    if (!stationId) {
      return badRequest("Station ID is required.");
    }

    const body = await request.json();

    const streamUrl =
      typeof body.streamUrl === "string" ? body.streamUrl.trim() : "";

    const mountPoint =
      typeof body.mountPoint === "string" ? body.mountPoint.trim() : "";

    const serverHost =
      typeof body.serverHost === "string" ? body.serverHost.trim() : "";

    const centovaUsername =
      typeof body.centovaUsername === "string"
        ? body.centovaUsername.trim()
        : "";

    const sourcePassword =
      typeof body.sourcePassword === "string"
        ? body.sourcePassword.trim()
        : "";

    if (!streamUrl) {
      return badRequest("Public stream URL is required.");
    }

    if (!isValidHttpUrl(streamUrl)) {
      return badRequest("Enter a valid public stream URL beginning with http:// or https://.");
    }

    if (!serverHost) {
      return badRequest("Server host is required.");
    }

    if (!centovaUsername) {
      return badRequest("Centova username is required.");
    }

    const serverPort = Number(body.serverPort);

    if (
      !Number.isInteger(serverPort) ||
      serverPort < 1 ||
      serverPort > 65535
    ) {
      return badRequest(
        "Server port must be a whole number from 1 to 65535."
      );
    }

    const bitrateKbps =
      body.bitrateKbps === null ||
      body.bitrateKbps === undefined ||
      body.bitrateKbps === ""
        ? null
        : Number(body.bitrateKbps);

    if (
      bitrateKbps !== null &&
      (!Number.isInteger(bitrateKbps) ||
        bitrateKbps < 8 ||
        bitrateKbps > 320)
    ) {
      return badRequest(
        "Bitrate must be a whole number from 8 to 320 kbps."
      );
    }

    const station = await prisma.station.findUnique({
      where: {
        id: stationId
      },
      select: {
        id: true,
        organisationId: true
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
      streamUrl,
      mountPoint: mountPoint || null,
      serverHost,
      serverPort,
      bitrateKbps,
      centovaUsername
    };

    if (sourcePassword) {
      configData.sourcePasswordEncrypted = encryptSecret(sourcePassword);
    }

    await prisma.$transaction(async (tx) => {
      await tx.stationStreamConfig.upsert({
        where: {
          stationId
        },
        update: configData,
        create: {
          stationId,
          ...configData
        }
      });

      await tx.auditLog.create({
        data: {
          organisationId: station.organisationId,
          actorUserId: adminUser.id,
          action: "STATION_STREAM_CONFIG_UPDATED",
          entityType: "Station",
          entityId: station.id,
          details: {
            streamUrlUpdated: true,
            mountPointUpdated: true,
            serverHostUpdated: true,
            serverPortUpdated: true,
            bitrateUpdated: true,
            centovaUsernameUpdated: true,
            sourcePasswordUpdated: Boolean(sourcePassword)
          }
        }
      });
    });

    return NextResponse.json({
      success: true,
      message: "Streaming configuration saved successfully."
    });
  } catch (error) {
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
