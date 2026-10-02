import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { findPublicPlan, publicPlanDatabaseData } from "../lib/product-plan-catalogue.mjs";
import { insideDemoFacilities } from "../lib/inside-demo-scenario.mjs";
import { validateInsideInventoryDemo } from "./validate-inside-inventory-demo.mjs";

// This script belongs only to the disposable demo branch. An exact database
// identity check prevents an accidental invocation against another environment.
const DEMO_DATABASE_HOST = "dpg-dauktubncjis73fbsdi0-a";
const DEMO_DATABASE_NAME = "ruvanas_inside_demo";
const DEMO_SERVICE_NAME = "ruvanas-inside-demo-20260930";
const DEMO_EMAIL = "inside-demo-owner@example.invalid";
const url = new URL(process.env.DATABASE_URL || "postgres://invalid/invalid");
const password = process.env.INSIDE_DEMO_OWNER_PASSWORD || "";

if (
  process.env.RUVANAS_ENVIRONMENT !== "DEMO" ||
  process.env.RENDER_SERVICE_NAME !== DEMO_SERVICE_NAME ||
  url.hostname !== DEMO_DATABASE_HOST ||
  url.pathname !== `/${DEMO_DATABASE_NAME}` ||
  password.length < 20
) {
  throw new Error("Inside demo seed is restricted to its named service and database with a separate strong password.");
}

const db = new PrismaClient();
try {
  const planData = publicPlanDatabaseData(findPublicPlan("CORRECTIONS_NETWORK", "CORRECTIONS"));
  const passwordHash = await bcrypt.hash(password, 12);
  const seeded = await db.$transaction(async (tx) => {
    const plan = await tx.plan.upsert({
      where: { code: planData.code },
      create: planData,
      update: {}
    });
    const organisation = await tx.organisation.upsert({
      where: { slug: "inside-synthetic-demo" },
      create: { name: "Synthetic Inside Demo Authority", slug: "inside-synthetic-demo" },
      update: {}
    });
    const owner = await tx.user.upsert({
      where: { email: DEMO_EMAIL },
      create: { name: "Inside Demo Owner", email: DEMO_EMAIL, passwordHash, role: "OWNER" },
      // A changed demo-only secret must replace the old login on the next guarded start.
      update: { passwordHash }
    });
    await tx.organisationMember.upsert({
      where: { userId_organisationId: { userId: owner.id, organisationId: organisation.id } },
      create: { userId: owner.id, organisationId: organisation.id, role: "OWNER" },
      update: {}
    });
    await tx.subscription.upsert({
      where: { organisationId: organisation.id },
      create: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE" },
      update: { planId: plan.id, status: "ACTIVE" }
    });
    await tx.correctionsProfile.upsert({
      where: { organisationId: organisation.id },
      create: { organisationId: organisation.id, policyConfiguredAt: new Date(), cleanOnly: true },
      update: {}
    });

    for (const { slug, name, zone, draft } of insideDemoFacilities) {
      const facility = await tx.location.upsert({
        where: { organisationId_slug: { organisationId: organisation.id, slug } },
        create: {
          organisationId: organisation.id,
          name,
          slug,
          status: "ACTIVE",
          timezone: "Europe/Malta",
          countryCode: "MT",
          correctionsFacility: { create: { policyConfiguredAt: new Date() } }
        },
        update: {}
      });
      await tx.zone.upsert({
        where: { locationId_slug: { locationId: facility.id, slug: "wing-one" } },
        create: { locationId: facility.id, name: zone, slug: "wing-one", status: "ACTIVE" },
        update: {}
      });
      if (draft) {
        const existingDraft = await tx.correctionsProgramme.findFirst({
          where: { organisationId: organisation.id, facilityId: facility.id, title: draft }
        });
        if (!existingDraft) {
          await tx.correctionsProgramme.create({
            data: {
              organisationId: organisation.id,
              facilityId: facility.id,
              title: draft,
              description: "Fictional draft for exploring the review workflow. It contains no audio and cannot be broadcast.",
              createdByUserId: owner.id
            }
          });
        }
      }
    }
    return { organisationId: organisation.id, ownerId: owner.id };
  });
  await validateInsideInventoryDemo(db, seeded);
  console.log("Inside demo seed ready: one fictional authority and three fictional facilities; no audio or players provisioned.");
} finally {
  await db.$disconnect();
}
