import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { makeLocationGroupSlug } from "@/lib/location-groups.mjs";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();

    if (!access.ok) {
      return accessDenied(access);
    }

    const body = await request.json();
    const organisationId = cleanText(body.organisationId);
    const name = cleanText(body.name);
    const slug = makeLocationGroupSlug(cleanText(body.slug) || name);
    const description = cleanText(body.description) || null;

    if (!organisationId || !name || !slug) {
      return NextResponse.json(
        { error: "Organisation and group name are required." },
        { status: 400 }
      );
    }

    const organisation = await prisma.organisation.findUnique({
      where: { id: organisationId },
      select: { id: true }
    });

    if (!organisation) {
      return NextResponse.json(
        { error: "The selected organisation does not exist." },
        { status: 404 }
      );
    }

    const existing = await prisma.locationGroup.findUnique({
      where: { organisationId_slug: { organisationId, slug } },
      select: { id: true }
    });

    if (existing) {
      return NextResponse.json(
        { error: "A location group with this name already exists." },
        { status: 409 }
      );
    }

    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.locationGroup.create({
        data: { organisationId, name, slug, description }
      });

      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: access.user.id,
          action: "LOCATION_GROUP_CREATED",
          entityType: "LocationGroup",
          entityId: created.id,
          details: { name, slug }
        }
      });

      return created;
    });

    return NextResponse.json({ ok: true, group }, { status: 201 });
  } catch (error) {
    console.error("Create location group error:", error);
    return NextResponse.json(
      { error: "Unable to create the location group." },
      { status: 500 }
    );
  }
}

