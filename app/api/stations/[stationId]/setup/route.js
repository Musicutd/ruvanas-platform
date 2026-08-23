import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { getAdminUser } from "@/lib/requireAdmin";

function invalid(message) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request, { params }) {
  try {
    const adminUser = await getAdminUser();

    if (!adminUser) {
      return NextResponse.json(
        { error: "You are not authorised to update streaming configuration." },
        { status: 403 }
      );
    }

    const stationId = params.stationId;

    if (!stationId) {
      return invalid("Station ID is required.");
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
      typeof body.sourcePassword === "string" ? body.sourcePassword.trim() : "";

    if (!streamUrl) {
      return invalid("Stream URL is required.");
    }

    try {
      const parsedUrl = new URL(streamUrl);

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return invalid("Stream URL must use http or https.");
      }
    } catch {
      return invalid("Enter a valid public stream URL.");
    }

    if (!serverHost) {
      return invalid("Server host is required.");
    }

    if (!centovaUsername) {
      return invalid("Centova username is required.");
    }

    const parsedServerPort = Number(body.serverPort);

    if (
      !Number.isInteger(parsedServerPort) ||
      parsedServerPort < 1 ||
      parsedServerPort > 65535
    ) {
      return invalid("Server port must be a whole number from 1 to 65535.");
    }

    const parsedBitrateKbps =
      body.bitrateKbps === null ||
      body.bitrateKbps === undefined ||
      body.bitrateKbps === ""
        ? null
        : Number(body.bitrateKbps);

    if (
      parsedBitrateKbps !== null &&
      (!Number.isInteger(parsedBitrateKbps) ||
        parsedBitrateKbps < 8 ||
        parsedBitrateKbps > 320)
    ) {
      return invalid("Bitrate must be a whole number from 8 to 320 kbps.");
    }

    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: {
        id: true,
        organisationId: true,
        streamConfig: {
          select: {
            sourcePasswordEncrypted: true
          }
        }
      }
    });

    if (!station) {
      return NextResponse.json({ error: "Station not found." }, { status: 404 });
    }

    const configData = {
      streamUrl,
      mountPoint: mountPoint || null,
      serverHost,
      serverPort: parsedServerPort,
      bitrateKbps: parsedBitrateKbps,
      centovaUsername
    };

    if (sourcePassword) {
      configData.sourcePasswordEncrypted = encryptSecret(sourcePassword);
    }

    await prisma.$transaction(async (tx) => {
      await tx.stationStreamConfig.upsert({
        where: { stationId },
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
      { error: "Unable to save streaming configuration." },
      { status: 500 }
    );
  }
}
