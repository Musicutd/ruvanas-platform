// Actual PostgreSQL WASM acceptance in memory. No application DB URL is read.
// Supply only a separately installed local @electric-sql/pglite module path.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { CATALOGUE_TEST_HOUR_CONSTRAINTS as EXPECTED, CATALOGUE_TEST_HOUR_MIGRATION as NEW } from "../../scripts/catalogue-test-hour-migrate.mjs";

const modulePath = process.env.RUVANAS_PGLITE_TEST_MODULE;
test("PostgreSQL accepts only exact Test Radio hour profile, rejects malformed grants and bounds deadlines", { skip: !modulePath }, async () => {
  assert.equal(path.isAbsolute(modulePath), true);
  assert.match(modulePath.replaceAll("\\", "/"), /\/node_modules\/@electric-sql\/pglite\/dist\/index\.js$/);
  const { PGlite } = await import(pathToFileURL(modulePath).href);
  const db = new PGlite();
  const station = "cmvcnbwi20008hr23sd76psi8", other = "synthetic_other_station", organisationId = "synthetic_organisation";
  const createdAt = "2026-10-22T10:00:00.000Z", requestedAt = "2026-10-22T10:05:00.000Z";
  let sequence = 0, rejected = 0;
  const hour = () => ({ stationId: station, organisationId, status: "PREPARED", durationSeconds: 3600,
    authorization: { profileId: "ONE_HOUR", maximumSeconds: 3600, stationId: station, organisationId,
      kind: "OWNER_CATALOGUE_TEST", actorRole: "SUPER_ADMIN" },
    plan: { profileId: "ONE_HOUR", targetSeconds: 3600 }, createdAt,
    expiresAt: "2026-10-22T11:10:00.000Z", requestedAt: null, deadlineAt: null });
  const insert = async record => {
    const id = `synthetic_test_${++sequence}`;
    await db.query(`INSERT INTO "OnlineRadioCatalogueTest" ("id","stationId","organisationId","createdByUserId","status","origin",
      "durationSeconds","authorization","plan","fingerprint","expiresAt","requestedAt","deadlineAt","createdAt","updatedAt")
      VALUES ($1,$2,$3,'synthetic_owner',$4,'https://www.ruvanas.com',$5,$6::jsonb,$7::jsonb,'synthetic_fingerprint',$8,$9,$10,$11,$11)`,
    [id, record.stationId, record.organisationId, record.status, record.durationSeconds, JSON.stringify(record.authorization),
      JSON.stringify(record.plan), record.expiresAt, record.requestedAt, record.deadlineAt, record.createdAt]);
    return id;
  };
  const definitions = async () => Object.fromEntries((await db.query(`SELECT conname AS name, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conname IN ('catalogue_test_duration_bound','catalogue_test_deadline') ORDER BY conname`)).rows.map(row => [row.name, row.definition]));
  try {
    await db.exec(`CREATE TABLE "Station" (id TEXT PRIMARY KEY)`);
    await db.query(`INSERT INTO "Station" (id) VALUES ($1),($2)`, [station, other]);
    await db.exec(await readFile(new URL("../../prisma/migrations/20261206000000_online_radio_catalogue_test/migration.sql", import.meta.url), "utf8"));
    assert.deepEqual(await definitions(), EXPECTED.before);
    const legacy = { ...hour(), durationSeconds: 300, authorization: {}, plan: {}, status: "STOPPED", requestedAt,
      deadlineAt: "2026-10-22T10:10:00.000Z" };
    const historicalId = await insert(legacy);
    const before = (await db.query(`SELECT * FROM "OnlineRadioCatalogueTest" WHERE id=$1`, [historicalId])).rows[0];
    await assert.rejects(insert(hour()), { code: "23514" });
    await db.exec(await readFile(new URL(`../../prisma/migrations/${NEW}/migration.sql`, import.meta.url), "utf8"));
    assert.deepEqual(await definitions(), EXPECTED.after);
    assert.deepEqual((await db.query(`SELECT * FROM "OnlineRadioCatalogueTest" WHERE id=$1`, [historicalId])).rows[0], before);
    await insert(hour());
    await insert({ ...hour(), requestedAt, deadlineAt: "2026-10-22T11:05:00.000Z" });
    for (const seconds of [1, 17, 300]) await insert({ ...legacy, durationSeconds: seconds, stationId: other });

    const forbidden = [
      record => { record.stationId = other; record.authorization.stationId = other; },
      record => { record.authorization = {}; }, record => { record.authorization = null; },
      record => { record.authorization = []; }, record => { record.authorization = "ONE_HOUR"; },
      record => { delete record.authorization.profileId; }, record => { record.authorization.profileId = null; },
      record => { record.authorization.profileId = "FIVE_MINUTES"; }, record => { record.authorization.profileId = "TWO_HOURS"; },
      record => { delete record.authorization.maximumSeconds; }, record => { record.authorization.maximumSeconds = "3600"; },
      record => { record.authorization.maximumSeconds = 3601; }, record => { record.authorization.stationId = other; },
      record => { delete record.authorization.organisationId; }, record => { record.authorization.organisationId = "different"; },
      record => { record.authorization.kind = "AUTODJ"; }, record => { record.authorization.actorRole = "OWNER"; },
      record => { record.plan = {}; }, record => { record.plan = null; }, record => { record.plan = []; },
      record => { record.plan.profileId = null; }, record => { record.plan.profileId = "FIVE_MINUTES"; },
      record => { record.plan.targetSeconds = "3600"; }, record => { record.plan.targetSeconds = 3599; },
      record => { record.durationSeconds = 301; }, record => { record.durationSeconds = 3599; },
      record => { record.durationSeconds = 3601; }, record => { record.durationSeconds = 0; },
      record => { record.expiresAt = "2026-10-22T11:10:00.001Z"; }, record => { record.expiresAt = createdAt; },
      record => { record.requestedAt = requestedAt; record.deadlineAt = "2026-10-22T11:05:00.001Z"; },
      record => { record.deadlineAt = "2026-10-22T11:05:00.000Z"; },
      record => { record.requestedAt = requestedAt; record.deadlineAt = requestedAt; },
      record => { record.requestedAt = requestedAt; record.deadlineAt = "2026-10-22T10:04:59.999Z"; },
      record => { record.requestedAt = "2026-10-22T10:11:00.000Z"; record.deadlineAt = "2026-10-22T11:11:00.000Z"; },
    ];
    for (const mutate of forbidden) {
      const record = hour(); mutate(record);
      await assert.rejects(insert(record), { code: "23514" }); rejected++;
    }
    await assert.rejects(insert({ ...legacy, deadlineAt: "2026-10-22T10:10:00.001Z" }), { code: "23514" }); rejected++;
    const activeId = await insert({ ...legacy, status: "ARMED" });
    await assert.rejects(insert({ ...hour(), status: "RUNNING" }), { code: "23505" }); rejected++;
    // This cleanup affects only the synthetic in-memory row, never a live account.
    await db.query(`UPDATE "OnlineRadioCatalogueTest" SET status='STOPPED' WHERE id=$1`, [activeId]);
    await insert({ ...hour(), status: "RUNNING" });
    assert.equal(rejected, 37);
    const index = (await db.query(`SELECT indisunique,indisvalid,pg_get_expr(indpred,indrelid) AS predicate
      FROM pg_index JOIN pg_class ON pg_class.oid=indexrelid WHERE relname='catalogue_test_one_active_per_station'`)).rows[0];
    assert.equal(index.indisunique, true); assert.equal(index.indisvalid, true);
    assert.equal(index.predicate, "(status = ANY (ARRAY['ARMED'::text, 'RUNNING'::text]))");
  } finally { await db.close(); }
});
