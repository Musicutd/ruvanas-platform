import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { deleteTrialOrganisation } from "../../lib/trial-organisation-deletion.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

test("trial cleanup cannot erase Corrections evidence but still removes an empty trial", {
  skip: ciDatabase ? false : "Requires the exact disposable CI PostgreSQL database."
}, async () => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  let actor;
  let protectedOrg;
  let emptyOrg;
  try {
    actor = await db.user.create({ data: {
      email: `c9-trial-delete-${suffix}@example.invalid`,
      passwordHash: "CI-only-no-login",
      role: "SUPER_ADMIN"
    } });
    protectedOrg = await db.organisation.create({ data: {
      name: "Fictional Corrections evidence trial",
      slug: `c9-protected-trial-${suffix}`
    } });
    emptyOrg = await db.organisation.create({ data: {
      name: "Fictional empty trial",
      slug: `c9-empty-trial-${suffix}`
    } });
    await db.auditLog.create({ data: {
      organisationId: protectedOrg.id,
      actorUserId: actor.id,
      action: "CORRECTIONS_TEST_DELETE_GUARD",
      entityType: "Organisation",
      entityId: protectedOrg.id
    } });

    await assert.rejects(
      deleteTrialOrganisation(db, {
        actor,
        organisationId: protectedOrg.id,
        confirmation: `DELETE ${protectedOrg.slug}`
      }),
      (error) => error.code === "CORRECTIONS_EVIDENCE_PRESENT"
    );
    assert.ok(await db.organisation.findUnique({ where: { id: protectedOrg.id } }));
    assert.equal(await db.auditLog.count({ where: {
      actorUserId: actor.id,
      action: "TRIAL_ORGANISATION_DELETED",
      entityId: protectedOrg.id
    } }), 0);

    await db.auditLog.deleteMany({ where: {
      organisationId: protectedOrg.id,
      action: "CORRECTIONS_TEST_DELETE_GUARD"
    } });
    const privatePack = await db.studioProgrammePack.create({ data: {
      organisationId: protectedOrg.id,
      name: `Fictional private pack ${suffix}`,
      productFamily: "CORRECTIONS",
      createdByUserId: actor.id
    } });
    await assert.rejects(
      deleteTrialOrganisation(db, {
        actor,
        organisationId: protectedOrg.id,
        confirmation: `DELETE ${protectedOrg.slug}`
      }),
      (error) => error.code === "CORRECTIONS_EVIDENCE_PRESENT"
    );
    assert.ok(await db.organisation.findUnique({ where: { id: protectedOrg.id } }));
    await db.studioProgrammePack.delete({ where: { id: privatePack.id } });

    const removed = await deleteTrialOrganisation(db, {
      actor,
      organisationId: emptyOrg.id,
      confirmation: `DELETE ${emptyOrg.slug}`
    });
    assert.equal(removed.id, emptyOrg.id);
    assert.equal(await db.organisation.findUnique({ where: { id: emptyOrg.id } }), null);
  } finally {
    try {
      if (actor) await db.auditLog.deleteMany({ where: { actorUserId: actor.id,
        action: { in: ["CORRECTIONS_TEST_DELETE_GUARD", "TRIAL_ORGANISATION_DELETED"] } } });
      if (protectedOrg) await db.studioProgrammePack.deleteMany({ where: { organisationId: protectedOrg.id } });
      if (protectedOrg) await db.organisation.deleteMany({ where: { id: protectedOrg.id } });
      if (emptyOrg) await db.organisation.deleteMany({ where: { id: emptyOrg.id } });
      if (actor) await db.user.deleteMany({ where: { id: actor.id } });
    } finally {
      await db.$disconnect();
    }
  }
});
