import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  canAccessOrganisation,
  canOverrideTenantMembership,
  findOrganisationMembership
} from "../lib/tenant-access.mjs";
import {
  ORGANISATION_MANAGER_ROLES
} from "../lib/permissions.mjs";

test("only the explicit platform override role bypasses membership", () => {
  assert.equal(canOverrideTenantMembership("SUPER_ADMIN"), true);
  assert.equal(canOverrideTenantMembership("SUPPORT"), false);
  assert.equal(canOverrideTenantMembership("OWNER"), false);
});

test("organisation access combines platform role, membership, and capability", () => {
  assert.equal(
    canAccessOrganisation({
      platformRole: "SUPPORT",
      membershipRole: null,
      allowedRoles: ORGANISATION_MANAGER_ROLES
    }),
    false
  );
  assert.equal(
    canAccessOrganisation({
      platformRole: "OWNER",
      membershipRole: "OWNER",
      allowedRoles: ORGANISATION_MANAGER_ROLES
    }),
    true
  );
  assert.equal(
    canAccessOrganisation({
      platformRole: "VIEWER",
      membershipRole: "VIEWER",
      allowedRoles: ORGANISATION_MANAGER_ROLES
    }),
    false
  );
});

test(
  "database membership lookup cannot cross organisation boundaries",
  { skip: process.env.RUN_DATABASE_TESTS !== "1" },
  async () => {
    const { PrismaClient } = await import("@prisma/client");
    const database = new PrismaClient();
    const suffix = randomUUID();

    try {
      const user = await database.user.create({
        data: {
          email: `tenant-test-${suffix}@example.invalid`,
          passwordHash: "not-a-real-password-hash",
          role: "OWNER"
        }
      });
      const ownOrganisation = await database.organisation.create({
        data: {
          name: `Owned ${suffix}`,
          slug: `owned-${suffix}`
        }
      });
      const otherOrganisation = await database.organisation.create({
        data: {
          name: `Other ${suffix}`,
          slug: `other-${suffix}`
        }
      });

      await database.organisationMember.create({
        data: {
          userId: user.id,
          organisationId: ownOrganisation.id,
          role: "OWNER"
        }
      });

      const ownMembership = await findOrganisationMembership(database, {
        userId: user.id,
        organisationId: ownOrganisation.id
      });
      const crossTenantMembership = await findOrganisationMembership(database, {
        userId: user.id,
        organisationId: otherOrganisation.id
      });

      assert.equal(ownMembership?.organisationId, ownOrganisation.id);
      assert.equal(crossTenantMembership, null);
      assert.equal(
        canAccessOrganisation({
          platformRole: user.role,
          membershipRole: crossTenantMembership?.role,
          allowedRoles: ORGANISATION_MANAGER_ROLES
        }),
        false
      );
    } finally {
      await database.organisation.deleteMany({
        where: {
          slug: {
            in: [`owned-${suffix}`, `other-${suffix}`]
          }
        }
      });
      await database.user.deleteMany({
        where: {
          email: `tenant-test-${suffix}@example.invalid`
        }
      });
      await database.$disconnect();
    }
  }
);

