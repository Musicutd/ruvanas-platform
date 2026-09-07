import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationProductAccess, ORGANISATION_CONTENT_ROLES } from "@/lib/access-control";
import { LISTENER_REQUEST_STATUSES, safeListenerRequest } from "@/lib/listener-interaction.mjs";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const station = await prisma.station.findUnique({ where: { id: String(params.stationId || "") }, select: { id: true, organisationId: true } });
    if (!station) return NextResponse.json({ error: "Station not found." }, { status: 404 });
    const access = await requireOrganisationProductAccess(station.organisationId, "ONLINE", ORGANISATION_CONTENT_ROLES);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const status = new URL(request.url).searchParams.get("status")?.toUpperCase();
    const where = { stationId: station.id, organisationId: station.organisationId, ...(LISTENER_REQUEST_STATUSES.includes(status) ? { status } : {}) };
    const records = await prisma.listenerRequest.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
    const hashes = [...new Set(records.map((item) => item.sessionHash))];
    const blocks = hashes.length ? await prisma.listenerRequestBlock.findMany({ where: { stationId: station.id, sessionHash: { in: hashes }, active: true }, select: { sessionHash: true } }) : [];
    const blocked = new Set(blocks.map((item) => item.sessionHash));
    return NextResponse.json({ requests: records.map((item) => safeListenerRequest(item, blocked.has(item.sessionHash))) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Listener request queue failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "Unable to load listener requests." }, { status: 500 });
  }
}
