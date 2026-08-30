import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { normalizeStreamHealthSettings, normalizeStreamProviderKey } from "@/lib/stream-source-health.mjs";

function badRequest(error) {
  return NextResponse.json({ error }, { status: 400 });
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export async function POST(request, { params }) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const adminUser = access.user;

    const stationId = params.stationId;

    if (!stationId) {
      return badRequest("Station ID is required.");
    }

    const body = await request.json();

    const streamUrl =
      typeof body.streamUrl === "string" ? body.streamUrl.trim() : "";

    const backupStreamUrl =
      typeof body.backupStreamUrl === "string" ? body.backupStreamUrl.trim() : "";

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
    const providerKey = normalizeStreamProviderKey(body.providerKey);

    if (!streamUrl) {
      return badRequest("Public stream URL is required.");
    }

    const streamEndpoint = parseHttpUrl(streamUrl);
    const backupStreamEndpoint = backupStreamUrl ? parseHttpUrl(backupStreamUrl) : null;

    if (!streamEndpoint) {
      return badRequest("Enter a valid public stream URL beginning with http:// or https:// and without embedded credentials.");
    }

    if (backupStreamUrl && !backupStreamEndpoint) {
      return badRequest("Enter a valid backup stream URL beginning with http:// or https:// and without embedded credentials.");
    }

    if (providerKey === "CENTOVA_CAST" && !serverHost) {
      return badRequest("Server host is required.");
    }

    if (providerKey === "CENTOVA_CAST" && !centovaUsername) {
      return badRequest("Centova username is required.");
    }

    const serverPort = Number(body.serverPort);

    if (providerKey === "CENTOVA_CAST" && (
      !Number.isInteger(serverPort) ||
      serverPort < 1 ||
      serverPort > 65535
    )) {
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

    let healthSettings;
    try {
      healthSettings = normalizeStreamHealthSettings({
        providerKey,
        backupStreamUrl,
        probeEnabled: body.probeEnabled,
        probeIntervalSeconds: body.probeIntervalSeconds,
        probeTimeoutMs: body.probeTimeoutMs
      });
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "Enter valid stream health settings.");
    }

    const endpointPort = streamEndpoint.port
      ? Number(streamEndpoint.port)
      : streamEndpoint.protocol === "https:"
        ? 443
        : 80;
    const configData = {
      streamUrl,
      mountPoint: mountPoint || null,
      serverHost: serverHost || streamEndpoint.hostname,
      serverPort: providerKey === "CENTOVA_CAST"
        ? serverPort
        : Number.isInteger(serverPort) && serverPort >= 1 && serverPort <= 65535
          ? serverPort
          : endpointPort,
      bitrateKbps,
      centovaUsername,
      ...healthSettings
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
            sourcePasswordUpdated: Boolean(sourcePassword),
            providerKey: healthSettings.providerKey,
            backupStreamConfigured: Boolean(healthSettings.backupStreamUrl),
            probeEnabled: healthSettings.probeEnabled,
            probeIntervalSeconds: healthSettings.probeIntervalSeconds,
            probeTimeoutMs: healthSettings.probeTimeoutMs
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
