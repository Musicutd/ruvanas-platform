import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextForRadioClocks } from "@/lib/radio-clock-access";
import { canAuthorRadioClock, canPublishRadioClock, parseRadioClockInput, radioClockSlug } from "@/lib/radio-clocks.mjs";
import { clockInclude, listRadioClocks, radioClockSources, safeRadioClock, validateRadioClockSources } from "@/lib/radio-clock-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { membership } = access.context;
    const [clocks, sources] = await Promise.all([
      listRadioClocks(membership.organisationId),
      radioClockSources(membership.organisationId)
    ]);
    return NextResponse.json({
      ok: true,
      canAuthor: canAuthorRadioClock(membership.role),
      canPublish: canPublishRadioClock(membership.role),
      clocks,
      sources
    });
  } catch (error) {
    console.error("Radio clock list error:", error);
    return NextResponse.json({ error: "Unable to load Radio Clocks." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const access = await contextForRadioClocks();
    if (access.response) return access.response;
    const { user, membership } = access.context;
    if (!canAuthorRadioClock(membership.role)) return NextResponse.json({ error: "Only owners, managers and content editors can build Radio Clocks." }, { status: 403 });
    const parsed = parseRadioClockInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const organisationId = membership.organisationId;
    await validateRadioClockSources(prisma, organisationId, parsed.data.items);
    const clock = await prisma.$transaction(async (tx) => {
      const created = await tx.radioClock.create({
        data: {
          organisationId,
          name: parsed.data.name,
          slug: radioClockSlug(parsed.data.name),
          description: parsed.data.description,
          durationSeconds: parsed.data.durationSeconds,
          createdByUserId: user.id,
          items: { create: parsed.data.items }
        },
        include: clockInclude
      });
      await tx.auditLog.create({ data: { organisationId, actorUserId: user.id, action: "RADIO_CLOCK_DRAFT_CREATED", entityType: "RadioClock", entityId: created.id, details: { itemCount: created.items.length, durationSeconds: created.durationSeconds } } });
      return created;
    });
    return NextResponse.json({ ok: true, clock: safeRadioClock(clock) }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "A Radio Clock already uses this name." }, { status: 409 });
    console.error("Radio clock create error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create the Radio Clock." }, { status: 500 });
  }
}
