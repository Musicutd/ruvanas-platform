import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationAccess, ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { stationDomainDnsName, stationDomainDnsValue } from "@/lib/station-website.mjs";
import { verifyStationDomainDns } from "@/lib/station-website-service";

export async function PATCH(request, { params }) {
  try {
    const domain = await prisma.stationDomain.findFirst({ where: { id: String(params.domainId || ""), stationId: String(params.stationId || "") }, include: { station: { select: { stationWebsiteEnabled: true } } } });
    if (!domain) return NextResponse.json({ error: "Station domain not found." }, { status: 404 });
    const access = await requireOrganisationAccess(domain.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Send a valid domain action." }, { status: 400 }); }
    const action = String(body.action || "").toUpperCase();
    const now = new Date();
    let verified = false;
    if (action === "VERIFY") verified = await verifyStationDomainDns(domain);
    if (action === "ACTIVATE" && !domain.station.stationWebsiteEnabled) return NextResponse.json({ error: "Publish the station website before activating its custom domain." }, { status: 409 });
    if (action === "ACTIVATE" && !["VERIFIED", "ACTIVE"].includes(domain.status)) return NextResponse.json({ error: "Verify domain ownership before activation." }, { status: 409 });
    if (!new Set(["VERIFY", "ACTIVATE", "DISABLE"]).has(action)) return NextResponse.json({ error: "Choose verify, activate or disable." }, { status: 400 });
    const updated = await prisma.$transaction(async (tx) => {
      if (action === "ACTIVATE") await tx.stationDomain.updateMany({ where: { stationId: domain.stationId, status: "ACTIVE", id: { not: domain.id } }, data: { status: "VERIFIED", activatedAt: null } });
      const data = action === "VERIFY"
        ? { lastCheckedAt: now, ...(verified ? { status: "VERIFIED", verifiedAt: now } : {}) }
        : action === "ACTIVATE" ? { status: "ACTIVE", activatedAt: now } : { status: "DISABLED", activatedAt: null };
      const value = await tx.stationDomain.update({ where: { id: domain.id }, data });
      await tx.auditLog.create({ data: { organisationId: domain.organisationId, actorUserId: access.user.id, action: `STATION_DOMAIN_${action}${action === "VERIFY" ? (verified ? "_PASSED" : "_FAILED") : ""}`, entityType: "StationDomain", entityId: domain.id, details: { hostname: domain.hostname } } });
      return value;
    });
    return NextResponse.json({ success: true, verified: action === "VERIFY" ? verified : undefined, domain: { id: updated.id, hostname: updated.hostname, status: updated.status, dnsName: stationDomainDnsName(updated.hostname), dnsValue: stationDomainDnsValue(updated.verificationToken), lastCheckedAt: updated.lastCheckedAt, verifiedAt: updated.verifiedAt, activatedAt: updated.activatedAt } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Station domain action failed:", error?.code || error?.name || "UNKNOWN");
    return NextResponse.json({ error: "Unable to update this domain." }, { status: 500 });
  }
}
