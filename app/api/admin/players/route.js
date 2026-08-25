import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { createPlayerToken } from "@/lib/player-tokens.mjs";
import { playerTokenHash } from "@/lib/player-auth";

const ENROLMENT_HOURS = 24;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const body = await request.json();
    const organisationId = clean(body.organisationId);
    const zoneId = clean(body.zoneId);
    const name = clean(body.name);

    if (!organisationId || !zoneId || !name) {
      return NextResponse.json(
        { error: "Organisation, zone, and player name are required." },
        { status: 400 }
      );
    }

    const zone = await prisma.zone.findFirst({
      where: {
        id: zoneId,
        location: { organisationId }
      },
      include: { location: true }
    });

    if (!zone) {
      return NextResponse.json(
        { error: "The selected zone does not belong to this organisation." },
        { status: 400 }
      );
    }

    const token = createPlayerToken();
    const enrolmentExpiresAt = new Date(
      Date.now() + ENROLMENT_HOURS * 60 * 60 * 1000
    );

    const player = await prisma.$transaction(async (tx) => {
      const created = await tx.player.create({
        data: {
          organisationId,
          zoneId,
          name,
          enrolmentTokenHash: playerTokenHash(token),
          enrolmentExpiresAt
        }
      });

      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: access.user.id,
          action: "PLAYER_CREATED",
          entityType: "Player",
          entityId: created.id,
          details: {
            name,
            zoneId,
            locationId: zone.locationId,
            enrolmentExpiresAt
          }
        }
      });

      return created;
    });

    return NextResponse.json(
      {
        ok: true,
        player: {
          id: player.id,
          name: player.name,
          enrolmentCode: token,
          enrolmentExpiresAt
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create player error:", error);
    return NextResponse.json(
      { error: "Unable to create the player." },
      { status: 500 }
    );
  }
}

