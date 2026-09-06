import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { createStationDomainVerificationToken, normalizeStationDomain, stationDomainDnsName, stationDomainDnsValue } from "@/lib/station-website.mjs";

export async function POST(request, { params }) {
  try {
    const station = await prisma.station.findUnique({ where: { id: String(params.stationId || "") }, select: { id: true, organisationId: true } });
    if (!station) return NextResponse.json({ error: "Station not found." }, { status: 404 });
    const access = await requireOrganisationAccess(station.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const text = await request.text();
    if (text.length > 2_048) return NextResponse.json({ error: "The domain request is too large." }, { status: 413 });
    let body;
    try { body = JSON.parse(text); }
    catch { return NextResponse.json({ error: "Send a valid domain request." }, { status: 400 }); }
    const hostname = normalizeStationDomain(body.hostname);
    const existing = await prisma.stationDomain.findUnique({ where: { hostname }, select: { organisationId: true } });
    if (existing) return NextResponse.json({ error: existing.organisationId === station.organisationId ? "This domain is already registered in your organisation." : "This domain is already registered." }, { status: 409 });
    const verificationToken = createStationDomainVerificationToken();
    const domain = await prisma.$transaction(async (tx) => {
      const created = await tx.stationDomain.create({ data: { organisationId: station.organisationId, stationId: station.id, hostname, verificationToken } });
      await tx.auditLog.create({ data: { organisationId: station.organisationId, actorUserId: access.user.id, action: "STATION_DOMAIN_CREATED", entityType: "StationDomain", entityId: created.id, details: { hostname } } });
      return created;
    });
    return NextResponse.json({ success: true, domain: { id: domain.id, hostname, status: domain.status, dnsName: stationDomainDnsName(hostname), dnsValue: stationDomainDnsValue(verificationToken) } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add this domain.";
    if (/hostname|domain/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    console.error("Station domain creation failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "Unable to add this domain." }, { status: 500 });
  }
}
