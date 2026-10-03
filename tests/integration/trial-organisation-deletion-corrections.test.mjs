import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { deleteTrialOrganisation } from "../../lib/trial-organisation-deletion.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

function signal() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function within(promise, description, milliseconds = 7000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}.`)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForPostgresBlock(database, waiterPid, blockerPid, didSettle) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (didSettle()) throw new Error("A concurrent transaction completed before the expected Organisation row lock.");
    const [activity] = await database.$queryRaw`
      SELECT wait_event_type AS "waitEventType", pg_blocking_pids(pid) AS "blockers"
      FROM pg_stat_activity WHERE pid = ${waiterPid}
    `;
    if (activity?.waitEventType === "Lock" && activity.blockers?.includes(blockerPid)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("The concurrent transaction never waited on the expected Organisation row lock.");
}

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

test("trial cleanup serializes private Studio pack creation in both transaction orders", {
  skip: ciDatabase ? false : "Requires the exact disposable CI PostgreSQL database."
}, async () => {
  const db = new PrismaClient();
  const writer = new PrismaClient();
  const observer = new PrismaClient();
  const suffix = randomUUID();
  let actor;
  let deletionFirstOrg;
  let writerFirstOrg;
  try {
    actor = await db.user.create({ data: {
      email: `c9-trial-race-${suffix}@example.invalid`,
      passwordHash: "CI-only-no-login",
      role: "SUPER_ADMIN"
    } });
    deletionFirstOrg = await db.organisation.create({ data: {
      name: "Fictional deletion-first Studio race",
      slug: `c9-delete-first-${suffix}`
    } });
    writerFirstOrg = await db.organisation.create({ data: {
      name: "Fictional writer-first Studio race",
      slug: `c9-writer-first-${suffix}`
    } });

    // Hold deletion after its real, empty Pack query. The Organisation row is
    // already locked; an independent Pack insert must now wait on its FK.
    const packWasChecked = signal();
    const resumeDeletion = signal();
    const deletionPid = signal();
    const deletionDatabase = {
      $transaction: (callback, options) => db.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        deletionPid.resolve(pid);
        const pack = new Proxy(tx.studioProgrammePack, {
          get(target, property) {
            if (property === "findFirst") return async (...args) => {
              const result = await target.findFirst(...args);
              packWasChecked.resolve();
              await resumeDeletion.promise;
              return result;
            };
            return target[property];
          }
        });
        return callback(new Proxy(tx, {
          get(target, property) {
            if (property === "studioProgrammePack") return pack;
            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
          }
        }));
      }, options)
    };
    let deletionTask = deleteTrialOrganisation(deletionDatabase, {
      actor,
      organisationId: deletionFirstOrg.id,
      confirmation: `DELETE ${deletionFirstOrg.slug}`
    });
    deletionTask.catch(() => {});
    let writerTask;
    try {
      await within(packWasChecked.promise, "deletion's private Pack evidence check");
      const blockerPid = await within(deletionPid.promise, "deletion connection ID");
      const writerPid = signal();
      writerTask = writer.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        writerPid.resolve(pid);
        return tx.studioProgrammePack.create({ data: {
          organisationId: deletionFirstOrg.id,
          name: `Fictional concurrent Pack ${suffix}`,
          productFamily: "CORRECTIONS",
          createdByUserId: actor.id
        } });
      }, { timeout: 20000 });
      let writerSettled = false;
      writerTask.finally(() => { writerSettled = true; }).catch(() => {});
      await waitForPostgresBlock(observer, await within(writerPid.promise, "writer connection ID"), blockerPid, () => writerSettled);
      resumeDeletion.resolve();
      await within(deletionTask, "deletion-first completion", 15000);
      await assert.rejects(writerTask, (error) => error.code === "P2003" || /foreign key/i.test(error.message));
      assert.equal(await db.organisation.findUnique({ where: { id: deletionFirstOrg.id } }), null);
      assert.equal(await db.studioProgrammePack.count({ where: { organisationId: deletionFirstOrg.id } }), 0);
    } finally {
      resumeDeletion.resolve();
      await Promise.allSettled([deletionTask, writerTask].filter(Boolean));
    }

    // In the opposite order, an uncommitted Pack insert holds the parent FK
    // lock. Deletion must wait, then see the committed Pack and refuse cleanup.
    const packWasWritten = signal();
    const releaseWriter = signal();
    const writerPid = signal();
    writerTask = writer.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      writerPid.resolve(pid);
      await tx.studioProgrammePack.create({ data: {
        organisationId: writerFirstOrg.id,
        name: `Fictional held Pack ${suffix}`,
        productFamily: "CORRECTIONS",
        createdByUserId: actor.id
      } });
      packWasWritten.resolve();
      await releaseWriter.promise;
    }, { timeout: 20000 });
    writerTask.catch(() => {});
    deletionTask = undefined;
    try {
      await within(packWasWritten.promise, "uncommitted private Pack insert");
      const blockerPid = await within(writerPid.promise, "writer connection ID");
      const deletionPid = signal();
      const deletionLockAttempted = signal();
      const deletionDatabase = {
        $transaction: (callback, options) => db.$transaction(async (tx) => {
          const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
          deletionPid.resolve(pid);
          return callback(new Proxy(tx, {
            get(target, property) {
              if (property === "$queryRaw") return (...args) => {
                const pending = target.$queryRaw(...args);
                deletionLockAttempted.resolve();
                return pending;
              };
              const value = target[property];
              return typeof value === "function" ? value.bind(target) : value;
            }
          }));
        }, options)
      };
      deletionTask = deleteTrialOrganisation(deletionDatabase, {
        actor,
        organisationId: writerFirstOrg.id,
        confirmation: `DELETE ${writerFirstOrg.slug}`
      });
      let deletionSettled = false;
      deletionTask.finally(() => { deletionSettled = true; }).catch(() => {});
      await within(deletionLockAttempted.promise, "deletion's Organisation lock attempt");
      await waitForPostgresBlock(observer, await within(deletionPid.promise, "deletion connection ID"), blockerPid, () => deletionSettled);
      releaseWriter.resolve();
      await within(writerTask, "writer-first commit", 15000);
      await assert.rejects(deletionTask, (error) => error.code === "CORRECTIONS_EVIDENCE_PRESENT");
      assert.ok(await db.organisation.findUnique({ where: { id: writerFirstOrg.id } }));
      assert.equal(await db.studioProgrammePack.count({ where: { organisationId: writerFirstOrg.id, productFamily: "CORRECTIONS" } }), 1);
    } finally {
      releaseWriter.resolve();
      await Promise.allSettled([deletionTask, writerTask].filter(Boolean));
    }
  } finally {
    try {
      for (const organisation of [deletionFirstOrg, writerFirstOrg].filter(Boolean)) {
        await db.studioProgrammePack.deleteMany({ where: { organisationId: organisation.id } });
        await db.organisation.deleteMany({ where: { id: organisation.id } });
      }
      if (actor) await db.auditLog.deleteMany({ where: {
        actorUserId: actor.id,
        action: "TRIAL_ORGANISATION_DELETED"
      } });
      if (actor) await db.user.deleteMany({ where: { id: actor.id } });
    } finally {
      await Promise.all([db.$disconnect(), writer.$disconnect(), observer.$disconnect()]);
    }
  }
});
