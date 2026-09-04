import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForRadioClocks } from "@/lib/radio-clock-access";
import { canAuthorRadioClock, parseRadioClockInput, radioClockSlug } from "@/lib/radio-clocks.mjs";
import { clockInclude, safeRadioClock, validateRadioClockSources } from "@/lib/radio-clock-service";

export const dynamic = "force-dynamic";

export async function PUT(request, { params }) {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canAuthorRadioClock(membership.role)) return NextResponse.json({ error: "Only owners, managers and content editors can edit Radio Clocks." }, { status: 403 });
    const { radioClockId } = await params;
    const parsed = parseRadioClockInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const organisationId = membership.organisationId;
    await validateRadioClockSources(prisma, organisationId, parsed.data.items);
    const existing = await prisma.radioClock.findFirst({ where: { id: radioClockId, organisationId, status: { not: "ARCHIVED" } }, select: { id: true, version: true, status: true } });
    if (!existing) return NextResponse.json({ error: "Radio Clock not found." }, { status: 404 });
    const clock = await prisma.$transaction(async (tx) => {
      await tx.radioClockItem.deleteMany({ where: { radioClockId: existing.id } });
      const updated = await tx.radioClock.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          slug: radioClockSlug(parsed.data.name),
          description: parsed.data.description,
          version: { increment: 1 },
          items: { create: parsed.data.items }
        },
        include: clockInclude
      });
      await tx.auditLog.create({ data: { organisationId, actorUserId: user.id, action: "RADIO_CLOCK_DRAFT_UPDATED", entityType: "RadioClock", entityId: existing.id, details: { fromVersion: existing.version, toVersion: updated.version, previousStatus: existing.status, itemCount: updated.items.length } } });
      return updated;
    });
    return NextResponse.json({ ok: true, clock: safeRadioClock(clock) });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "A Radio Clock already uses this name." }, { status: 409 });
    console.error("Radio clock update error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the Radio Clock." }, { status: 500 });
  }
}
