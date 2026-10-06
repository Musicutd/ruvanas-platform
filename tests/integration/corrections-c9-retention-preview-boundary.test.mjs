import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3100";
const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

function signal() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function within(promise, description, milliseconds = 7000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}.`)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function preview(cookie, organisationId) {
  return fetch(`${baseUrl}/api/admin/compliance`, {
    method: "POST",
    headers: { origin: baseUrl, cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "PREVIEW_RETENTION", organisationId }),
    redirect: "manual"
  });
}

async function waitForParentLock(database, blockerPid, settled) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (settled()) throw new Error("Retention preview completed before the expected Organisation lock wait.");
    const waiters = await database.$queryRaw`
      SELECT pid FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `;
    if (waiters.length) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Retention preview never waited for the Organisation lock.");
}

test("ordinary retention preview remains available; Inside evidence blocks it, including after a lock wait", async () => {
  if (!ciDatabase || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("C9 retention integration runs only against the exact disposable CI database.");
  }
  const db = new PrismaClient();
  const suffix = randomUUID();
  const password = `CI-only-${randomUUID()}!`;
  const organisations = [];
  let administrator;
  let releaseWriter;
  let writer;
  try {
    administrator = await db.user.create({ data: {
      email: `c9-retention-${suffix}@example.invalid`,
      passwordHash: await bcrypt.hash(password, 4), role: "SUPER_ADMIN"
    } });
    for (const label of ["ordinary", "protected", "race"]) {
      organisations.push(await db.organisation.create({ data: {
        name: `Fictional C9 retention ${label} ${suffix}`,
        slug: `c9-retention-${label}-${suffix}`
      } }));
    }
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ email: administrator.email, password }), redirect: "manual"
    });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const [ordinary, protectedOrg, raceOrg] = organisations;
    await db.auditLog.create({ data: {
      organisationId: ordinary.id, actorUserId: administrator.id,
      action: "GENERAL_C9_RETENTION_FIXTURE", entityType: "Organisation", entityId: ordinary.id,
      createdAt: new Date("2015-01-01T00:00:00.000Z")
    } });
    const ordinaryResponse = await preview(cookie, ordinary.id);
    assert.equal(ordinaryResponse.status, 201, await ordinaryResponse.clone().text());
    const ordinaryJob = (await ordinaryResponse.json()).job;
    assert.equal(ordinaryJob.dryRun, true);
    assert.equal(ordinaryJob.status, "DRY_RUN_READY");
    assert.equal(ordinaryJob.candidateCounts.auditLogs, 1);
    assert.equal(await db.retentionJob.count({ where: { organisationId: ordinary.id } }), 1);

    const protectedAudit = await db.auditLog.create({ data: {
      organisationId: protectedOrg.id, actorUserId: administrator.id,
      action: "CORRECTIONS_C9_RETENTION_FIXTURE", entityType: "Organisation", entityId: protectedOrg.id,
      createdAt: new Date("2015-01-01T00:00:00.000Z")
    } });
    const protectedResponse = await preview(cookie, protectedOrg.id);
    assert.equal(protectedResponse.status, 409, await protectedResponse.clone().text());
    assert.match((await protectedResponse.json()).error, /Ruvanas Inside access or evidence/);
    assert.equal(await db.retentionJob.count({ where: { organisationId: protectedOrg.id } }), 0);

    await db.auditLog.delete({ where: { id: protectedAudit.id } });
    const privatePack = await db.studioProgrammePack.create({ data: {
      organisationId: protectedOrg.id, name: "Fictional private pack",
      productFamily: "CORRECTIONS", createdByUserId: administrator.id
    } });
    assert.equal((await preview(cookie, protectedOrg.id)).status, 409);
    assert.equal(await db.retentionJob.count({ where: { organisationId: protectedOrg.id } }), 0);
    await db.studioProgrammePack.delete({ where: { id: privatePack.id } });

    // The marker commits while the preview waits on the same parent row.
    // ReadCommitted must see it after acquiring the lock, then create no job.
    const ready = signal();
    const release = signal();
    releaseWriter = release.resolve;
    writer = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${raceOrg.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.auditLog.create({ data: {
        organisationId: raceOrg.id, actorUserId: administrator.id,
        action: "CORRECTIONS_C9_CONCURRENT_RETENTION_FIXTURE", entityType: "Organisation", entityId: raceOrg.id
      } });
      ready.resolve(pid);
      await release.promise;
    }, { timeout: 15000 }).catch((error) => {
      ready.reject(error);
      throw error;
    });
    writer.catch(() => {});
    const blockerPid = await within(ready.promise, "the concurrent marker transaction");
    let settled = false;
    const pendingPreview = preview(cookie, raceOrg.id).finally(() => {
      settled = true;
    });
    await waitForParentLock(db, blockerPid, () => settled);
    release.resolve();
    await writer;
    writer = null;
    const raceResponse = await pendingPreview;
    assert.equal(raceResponse.status, 409, await raceResponse.clone().text());
    assert.equal(await db.retentionJob.count({ where: { organisationId: raceOrg.id } }), 0);
  } finally {
    if (releaseWriter) releaseWriter();
    if (writer) await writer.catch(() => {});
    try {
      if (organisations.length) {
        const ids = organisations.map(({ id }) => id);
        await db.retentionJob.deleteMany({ where: { organisationId: { in: ids } } });
        await db.auditLog.deleteMany({ where: { organisationId: { in: ids } } });
        await db.organisation.deleteMany({ where: { id: { in: ids } } });
      }
      if (administrator) await db.user.delete({ where: { id: administrator.id } });
    } finally {
      await db.$disconnect();
    }
  }
});
