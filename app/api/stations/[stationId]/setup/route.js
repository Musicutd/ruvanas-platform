import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verify } from "jsonwebtoken";
import prisma from "@/lib/prisma";

export async function POST(request, { params }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let adminId;
  try {
    const decoded = verify(token, process.env.JWT_SECRET);
    adminId = decoded.adminId;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await prisma.admin.findUnique({
    where: { id: adminId }
  });

  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stationId = params.stationId;

  const station = await prisma.station.findUnique({
    where: { id: stationId }
  });

  if (!station) {
    return NextResponse.json({ error: "Station not found" }, { status: 404 });
  }

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

  // Build update object
  const update = {
    streamUrl: streamUrl ?? null,
    mountPoint: mountPoint ?? null,
    serverHost: serverHost ?? null,
    serverPort: serverPort ? Number(serverPort) : null,
    bitrateKbps: bitrateKbps ? Number(bitrateKbps) : null,
    centovaUsername: centovaUsername ?? null
  };

  // Only update passwords if provided
  if (adminPassword && adminPassword.trim() !== "") {
    update.adminPassword = adminPassword;
  }
  if (sourcePassword && sourcePassword.trim() !== "") {
    update.sourcePassword = sourcePassword;
  }

  await prisma.streamingSetup.upsert({
    where: { stationId },
    update,
    create: {
      stationId,
      ...update
    }
  });

  return NextResponse.json({ ok: true });
}
