import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    let where;

    if (user.role === "SUPER_ADMIN") {
      where = {
        libraryType: "ORGANISATION_PROMO",
        status: {
          notIn: ["ARCHIVED", "DELETED"]
        }
      };
    } else {
      const memberships = await prisma.organisationMember.findMany({
        where: {
          userId: user.id
        },
        select: {
          organisationId: true
        }
      });

      const organisationIds = memberships.map(
        (membership) => membership.organisationId
      );

      where = {
        organisationId: {
          in: organisationIds
        },
        libraryType: "ORGANISATION_PROMO",
        status: {
          notIn: ["ARCHIVED", "DELETED"]
        }
      };
    }

    const assets = await prisma.mediaAsset.findMany({
      where,
      include: {
        organisation: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return NextResponse.json({
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        originalName: asset.originalName,
        mediaType: asset.mediaType,
        status: asset.status,
        sizeBytes: asset.sizeBytes.toString(),
        durationSeconds: asset.durationSeconds,
        createdAt: asset.createdAt.toISOString(),
        organisation: asset.organisation
          ? {
              id: asset.organisation.id,
              name: asset.organisation.name
            }
          : null
      }))
    });
  } catch (error) {
    console.error("Unable to load promotional audio:", error);

    return NextResponse.json(
      { error: "Unable to load promotional audio." },
      { status: 500 }
    );
  }
}
