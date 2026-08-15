import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";

function createSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export async function POST(request) {
  try {
    const body = await request.json();

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const organisationName = String(body.organisationName || "").trim();

    if (!name || !email || !password || !organisationName) {
      return NextResponse.json(
        { error: "Please complete all required fields." },
        { status: 400 }
      );
    }

    if (!email.includes("@")) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Your password must contain at least 8 characters." },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const starterPlan = await prisma.plan.upsert({
      where: { code: "STARTER" },
      update: {},
      create: {
        name: "Starter",
        code: "STARTER",
        monthlyPriceCents: 999,
        stationLimit: 1,
        storageLimitGb: 2,
        listenerLimit: 100,
        maxBitrateKbps: 128,
        active: true
      }
    });

    const baseSlug = createSlug(organisationName) || "ruvanas-client";
    const uniqueSuffix = Math.random().toString(36).slice(2, 8);
    const organisationSlug = `${baseSlug}-${uniqueSuffix}`;

    const passwordHash = await bcrypt.hash(password, 12);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 30);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: "OWNER"
        }
      });

      const organisation = await tx.organisation.create({
        data: {
          name: organisationName,
          slug: organisationSlug
        }
      });

      await tx.organisationMember.create({
        data: {
          userId: user.id,
          organisationId: organisation.id,
          role: "OWNER"
        }
      });

      await tx.subscription.create({
        data: {
          organisationId: organisation.id,
          planId: starterPlan.id,
          status: "TRIAL",
          currentPeriodEnd: trialEndsAt
        }
      });

      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: user.id,
          action: "ACCOUNT_REGISTERED",
          entityType: "User",
          entityId: user.id,
          details: {
            email,
            plan: "STARTER"
          }
        }
      });

      return { user, organisation };
    });

    await createSession(result.user.id);

    return NextResponse.json(
      {
        success: true,
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email
        },
        organisation: {
          id: result.organisation.id,
          name: result.organisation.name
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration failed:", error);

    return NextResponse.json(
      { error: "Unable to create your account. Please try again." },
      { status: 500 }
    );
  }
}
