import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "@/lib/crypto";
import { getAdminUser } from "@/lib/requireAdmin";

const prisma = new PrismaClient();

export async function POST(request, { params }) {
  const { stationId } = params;

  // --- Admin gate: only SUPER_ADMIN / SUPPORT may configure streaming ---
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json(
      { error: "Forbidden. Only administrators can configure streaming settings." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();

    const {
      centovaUsername,
      serverHost,
      serverPort,
      mountPoint,
      streamUrl,
      bitrateKbps,
      adminPassword,
      sourcePassword
    } = body;

    if (!streamUrl) {
      return NextResponse.json(
        { error: "Public stream URL is required." },
        { status: 400 }
      );
    }
    if (!centovaUsername) {
      return NextResponse.json(
        { error: "Centova username is required." },
        { status: 400 }
      );
    }
    if (!serverHost) {
      return NextResponse.json(
        { error: "Server host is required." },
        { status: 400 }
      );
    }

    const station = await prisma.station.findUnique({
      where: { id: stationId }
    });

    if (!station) {
      return NextResponse.json(
        { error: "Station not found." },
        { status: 404 }
      );
    }

    const parsedPort = serverPort ? parseInt(serverPort, 10) : null;
    const parsedBitrate = bitrateKbps ? parseInt(bitrateKbps, 10) : null;

    const adminPasswordEncrypted = adminPassword
      ? encryptSecret(adminPassword)
      : null;
    const sourcePasswordEncrypted = sourcePassword
      ? encryptSecret(sourcePassword)
      : null;

    await prisma.stationStreamConfig.upsert({
      where: { stationId },
      update: {
        centovaUsername,
        serverHost,
        serverPort: parsedPort,
        mountPoint: mountPoint || null,
        streamUrl,
        bitrateKbps: parsedBitrate,
        ...(adminPasswordEncrypted ? { adminPasswordEncrypted } : {}),
        ...(sourcePasswordEncrypted ? { sourcePasswordEncrypted } : {})
      },
      create: {
        stationId,
        centovaUsername,
        serverHost,
        serverPort: parsedPort,
        mountPoint: mountPoint || null,
        streamUrl,
        bitrateKbps: parsedBitrate,
        adminPasswordEncrypted,
        sourcePasswordEncrypted
      }
    });

    const updatedStation = await prisma.station.update({
      where: { id: stationId },
      data: { status: "ACTIVE" }
    });

    return NextResponse.json({
      success: true,
      station: {
        id: updatedStation.id,
        name: updatedStation.name,
        status: updatedStation.status
      }
    });
  } catch (err) {
    console.error("Error saving station stream config:", err);
    return NextResponse.json(
      { error: "Failed to save streaming configuration." },
      { status: 500 }
    );
  }
}
