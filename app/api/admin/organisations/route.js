import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import slugify from "@/lib/slugify";

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

    let organisations;

    if (user.role === "SUPER_ADMIN") {
      organisations = await prisma.organisation.findMany({
        select: {
          id: true,
          name: true,
          slug: true
        },
        orderBy: {
          name: "asc"
        }
      });
    } else {
      const memberships = await prisma.organisationMember.findMany({
        where: {
          userId: user.id
        },
        select: {
          organisation: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      });

      organisations = memberships.map((membership) => membership.organisation);
    }

    return NextResponse.json({ organisations });
  } catch (error) {
    console.error("Unable to load organisations for media upload:", error);

    return NextResponse.json(
      { error: "Unable to load organisations." },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().max(180).optional(),
  planId: z.string().cuid(),
  assignCurrentUser: z.boolean().default(true)
});

export async function POST(request) {
  try {
    const access = await requirePlatformAdmin();
    if (!access.ok) return accessDenied(access);
    if (access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only a Ruvanas Super Admin can create organisations." },
        { status: 403 }
      );
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Provide an organisation name and an active plan." },
        { status: 400 }
      );
    }

    const plan = await prisma.plan.findFirst({
      where: { id: parsed.data.planId, active: true },
      select: { id: true, name: true, code: true }
    });
    if (!plan) {
      return NextResponse.json(
        { error: "Choose an active subscription plan." },
        { status: 400 }
      );
    }

    const slug = slugify(parsed.data.slug || parsed.data.name);
    if (!slug) {
      return NextResponse.json(
        { error: "The organisation name must contain letters or numbers." },
        { status: 400 }
      );
    }

    const organisation = await prisma.$transaction(async (tx) => {
      const created = await tx.organisation.create({
        data: {
          name: parsed.data.name,
          slug,
          subscription: {
            create: { planId: plan.id, status: "TRIAL" }
          },
          members: parsed.data.assignCurrentUser
            ? {
                create: {
                  userId: access.user.id,
                  role: "OWNER"
                }
              }
            : undefined
        },
        include: { subscription: { include: { plan: true } } }
      });
      await tx.auditLog.create({
        data: {
          organisationId: created.id,
          actorUserId: access.user.id,
          action: "ORGANISATION_CREATED",
          entityType: "Organisation",
          entityId: created.id,
          details: {
            slug: created.slug,
            planId: plan.id,
            planCode: plan.code,
            assignedCurrentUser: parsed.data.assignCurrentUser
          }
        }
      });
      return created;
    });

    return NextResponse.json({ organisation }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "An organisation with this name or slug already exists." },
        { status: 409 }
      );
    }
    console.error("Create organisation error:", error);
    return NextResponse.json(
      { error: "Unable to create the organisation." },
      { status: 500 }
    );
  }
}

