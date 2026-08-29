import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessDenied } from "@/lib/api-response";
import { ORGANISATION_MANAGER_ROLES } from "@/lib/access-control";
import { requireDigitalSignageOrganisation } from "@/lib/digital-signage-access";

export async function PATCH(request, { params }) {
  try {
    const { takeoverId: rawTakeoverId } = await params;
    const takeoverId = String(rawTakeoverId || "");
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").toUpperCase();
    if (!["ACTIVATE", "END", "CANCEL"].includes(action)) return NextResponse.json({ error: "Choose activate, end, or cancel." }, { status: 400 });
    const takeover = await prisma.digitalSignageTakeover.findUnique({ where: { id: takeoverId }, include: { playlist: { include: { items: { include: { asset: { select: { status: true } } } } } }, devices: true } });
    if (!takeover) return NextResponse.json({ error: "Visual takeover not found." }, { status: 404 });
    const access = await requireDigitalSignageOrganisation(takeover.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    const now = new Date();
    if (action === "ACTIVATE") {
      if (takeover.status !== "DRAFT") return NextResponse.json({ error: "Only a draft takeover can be activated." }, { status: 409 });
      if (takeover.endsAt <= now) return NextResponse.json({ error: "This takeover window has already ended." }, { status: 400 });
      if (takeover.playlist.status !== "PUBLISHED" || takeover.playlist.items.some((item) => item.asset.status !== "READY")) return NextResponse.json({ error: "The takeover playlist must remain published with ready visuals." }, { status: 400 });
      const conflict = await prisma.digitalSignageTakeover.findFirst({ where: { id: { not: takeover.id }, organisationId: takeover.organisationId, status: "ACTIVE", startsAt: { lt: takeover.endsAt }, endsAt: { gt: takeover.startsAt }, devices: { some: { deviceId: { in: takeover.devices.map((item) => item.deviceId) } } } } });
      if (conflict) return NextResponse.json({ error: "Another active takeover overlaps one or more selected displays. End it first." }, { status: 409 });
    } else if (action === "END" && takeover.status !== "ACTIVE") {
      return NextResponse.json({ error: "Only an active takeover can be ended." }, { status: 409 });
    } else if (action === "CANCEL" && takeover.status !== "DRAFT") {
      return NextResponse.json({ error: "Only a draft takeover can be cancelled." }, { status: 409 });
    }
    const data = action === "ACTIVATE"
      ? { status: "ACTIVE", activatedAt: now, activatedByUserId: access.user.id }
      : action === "END"
        ? { status: "ENDED", endedAt: now, endedByUserId: access.user.id, endsAt: new Date(Math.max(now.getTime(), takeover.startsAt.getTime() + 1000)) }
        : { status: "CANCELLED", endedAt: now, endedByUserId: access.user.id };
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.digitalSignageTakeover.update({ where: { id: takeover.id }, data });
      const auditAction = { ACTIVATE: "DIGITAL_SIGNAGE_TAKEOVER_ACTIVATED", END: "DIGITAL_SIGNAGE_TAKEOVER_ENDED", CANCEL: "DIGITAL_SIGNAGE_TAKEOVER_CANCELLED" }[action];
      await tx.auditLog.create({ data: { organisationId: takeover.organisationId, actorUserId: access.user.id, action: auditAction, entityType: "DigitalSignageTakeover", entityId: takeover.id, details: { previousStatus: takeover.status, status: value.status, reason: takeover.reason, deviceIds: takeover.devices.map((item) => item.deviceId) } } });
      return value;
    });
    return NextResponse.json({ takeover: updated });
  } catch (error) {
    console.error("Update signage takeover error:", error);
    return NextResponse.json({ error: "Unable to update the visual takeover." }, { status: 500 });
  }
}
