import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const CLUSTER = /\/retail-rewards-rr07b-20261114\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/;
const DATABASE = /^ruvanas_rewards_pilot_admin(?:_routes|_upgrade|_full|_schema)?$/;
const rollback = new Error("ROLL_BACK_OWNED_RR07B_SCHEMA_CHECKS");

// No caller may use this fixture writer against an existing/shared database.
// The external harness owns the localhost cluster and its full lifecycle.
export async function assertPilotDatabaseIdentity(db) {
  const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.match(row.directory.replaceAll("\\", "/"), CLUSTER);
  assert.match(row.database, DATABASE);
  assert.equal(row.role, "rr07b_qa"); assert.equal(row.host, "127.0.0.1");
  assert.ok(Number.isInteger(row.port) && row.port > 1024 && row.port <= 65535);
  return row;
}

test("RR07b schema harness refuses shared/remote database identities before writing", async () => {
  const valid = { directory: "C:/synthetic/output/retail-rewards-rr07b-20261114/sessions/postgres-123456-abcdef0123/postgres",
    database: "ruvanas_rewards_pilot_admin_schema", role: "rr07b_qa", host: "127.0.0.1", port: 54222 };
  for (const patch of [{ directory: "C:/production/data" }, { database: "ruvanas" }, { role: "postgres" },
    { host: "203.0.113.4" }, { host: null }, { port: 543 }, { port: 99999 }]) {
    let writes = 0;
    const db = { $queryRawUnsafe: async () => [{ ...valid, ...patch }],
      $transaction: () => { writes++; throw new Error("No writes permitted"); } };
    await assert.rejects(runPilotSqlChecks({ db }));
    assert.equal(writes, 0);
  }
  assert.deepEqual(await assertPilotDatabaseIdentity({ $queryRawUnsafe: async () => [valid] }), valid);
});

async function rejectsSql(tx, query, params, expected) {
  await tx.$executeRawUnsafe("SAVEPOINT rr07b_rejected_write");
  let failure;
  try { await tx.$executeRawUnsafe(query, ...params); } catch (error) { failure = error; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rr07b_rejected_write");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT rr07b_rejected_write");
  assert.ok(failure, "PostgreSQL accepted a forbidden pilot evidence write");
  assert.ok([expected].flat().includes(failure.meta?.code), `Unexpected SQL state: ${failure.meta?.code}`);
}

const auditSql = `INSERT INTO "RewardPilotAuditEvent" (id,"organisationId","actorUserId",action,"targetType","targetId","requestId","metadataJson")
  VALUES ($1,$2,$3,$4::"RewardPilotAuditAction",$5::"RewardPilotAuditTargetType",$6,$7,$8::jsonb)`;
const enrollmentSql = `INSERT INTO "RewardPilotShopperEnrollment" ("shopperId","organisationId","createdByUserId") VALUES ($1,$2,$3)`;
const stateSql = `SELECT jsonb_build_object(
  'organisations',(SELECT count(*) FROM "Organisation"),
  'shoppers',(SELECT count(*) FROM "RewardShopper"),
  'credentials',(SELECT count(*) FROM "RewardShopperCredential"),
  'invitations',(SELECT count(*) FROM "RewardShopperInvitation"),
  'memberships',(SELECT count(*) FROM "RewardShopperMembership"),
  'sessions',(SELECT count(*) FROM "RewardShopperSession"),
  'enrollments',(SELECT count(*) FROM "RewardPilotShopperEnrollment"),
  'pilotAudit',(SELECT count(*) FROM "RewardPilotAuditEvent"),
  'audit',(SELECT count(*) FROM "RewardAuditEvent")) AS state`;

/** Invoke after applying all 141 migrations to the owned RR07b fixture cluster.
 * Writes only new synthetic organisations/shoppers in a rollback transaction.
 * No outside credentials, actual tenant data or current playback is needed.
 */
export async function runPilotSqlChecks({ db }) {
  await assertPilotDatabaseIdentity(db);
  const before = await db.$queryRawUnsafe(stateSql), checks = [];
  try {
    await db.$transaction(async tx => {
      const suffix = randomUUID(), actorUserId = `rr07b-actor-${suffix}`;
      const organisation = await tx.organisation.create({ data: { name: "Synthetic pilot schema", slug: `rr07b-schema-${suffix}` } });
      const other = await tx.organisation.create({ data: { name: "Synthetic other pilot", slug: `rr07b-other-${suffix}` } });
      const shopper = await tx.rewardShopper.create({ data: {} });
      const otherShopper = await tx.rewardShopper.create({ data: {} });
      const originalShopper = await tx.rewardShopper.findUnique({ where: { id: shopper.id } });
      const auditParams = (patch = {}) => [patch.id ?? randomUUID(), Object.hasOwn(patch, "organisationId") ? patch.organisationId : organisation.id,
        Object.hasOwn(patch, "actorUserId") ? patch.actorUserId : actorUserId,
        patch.action ?? "PROGRAM_PREPARED", patch.targetType ?? "PROGRAM", patch.targetId ?? "synthetic-program",
        Object.hasOwn(patch, "requestId") ? patch.requestId : null,
        JSON.stringify(Object.hasOwn(patch, "metadataJson") ? patch.metadataJson : {})];

      const validMetadata = [{}, { revision: 1 }, { limitsVersion: 2147483647 },
        { revision: 2, limitsVersion: 1, status: "APPROVED", expiresAt: "2026-11-23T23:59:59.999Z" }];
      for (const metadata of validMetadata) {
        const result = await tx.$queryRawUnsafe('SELECT "ruvanas_rewards_pilot_audit_metadata_valid"($1::jsonb) AS valid', JSON.stringify(metadata));
        assert.equal(result[0].valid, true);
        await tx.$executeRawUnsafe(auditSql, ...auditParams({ metadataJson: metadata }));
      }
      const invalidMetadata = [null, [], "text", { email: "synthetic@example.invalid" }, { token: "secret" },
        { tokenHash: "a".repeat(64) }, { passwordHash: "secret" }, { before: {} }, { status: "ACTIVE" },
        { status: null }, { status: ["APPROVED"] }, { revision: 0 }, { revision: -1 }, { revision: 1.5 },
        { revision: "1" }, { revision: 2147483648 }, { limitsVersion: 0 }, { limitsVersion: null },
        { expiresAt: "2026-11-23T23:59:59Z" }, { expiresAt: "2026-11-23T23:59:59.000+00:00" },
        { expiresAt: "2026-02-30T12:00:00.000Z" }, { expiresAt: "2026-11-23T24:00:00.000Z" },
        { expiresAt: "infinity" }, { expiresAt: null }, { status: "x".repeat(1100) }];
      for (const metadataJson of invalidMetadata) {
        const result = await tx.$queryRawUnsafe('SELECT "ruvanas_rewards_pilot_audit_metadata_valid"($1::jsonb) AS valid', JSON.stringify(metadataJson));
        assert.equal(result[0].valid, false, JSON.stringify(metadataJson));
        await rejectsSql(tx, auditSql, auditParams({ metadataJson }), "23514");
      }
      checks.push("Typed metadata accepts only bounded evidence; rejects PII/secrets/nesting/noncanonical dates");

      for (const [action, targetType, status] of [["PROGRAM_PREPARED", "PROGRAM", "PREPARED"],
        ["SHOP_PUBLISHED", "SHOP", "PUBLISHED"], ["OFFER_APPROVED", "OFFER", "APPROVED"],
        ["SHOPPER_INVITED", "SHOPPER", "INVITED"], ["INVITATION_REISSUED", "SHOPPER", "REISSUED"],
        ["INVITATION_REVOKED", "SHOPPER", "REVOKED"]]) {
        await tx.$executeRawUnsafe(auditSql, ...auditParams({ action, targetType, metadataJson: { status } }));
        await rejectsSql(tx, auditSql, auditParams({ action, targetType: targetType === "PROGRAM" ? "SHOPPER" : "PROGRAM" }), "23514");
      }
      await rejectsSql(tx, auditSql, auditParams({ action: "ENTITLEMENT_REVOKED" }), "22P02");
      checks.push("All six audit actions require their exact allowed target type");

      for (const patch of [{ id: "" }, { id: "x".repeat(192) }, { actorUserId: "" }, { actorUserId: "invalid@example.invalid" },
        { targetId: "../private" }, { requestId: "" }, { requestId: "request with spaces" }]) {
        await rejectsSql(tx, auditSql, auditParams(patch), "23514");
      }
      await rejectsSql(tx, auditSql, auditParams({ actorUserId: null }), "23502");
      await rejectsSql(tx, auditSql, auditParams({ organisationId: "unknown-pilot" }), "23503");
      await rejectsSql(tx, auditSql, auditParams({ organisationId: null }), "23502");
      await rejectsSql(tx, `INSERT INTO "RewardPilotAuditEvent" (id,"organisationId","actorUserId",action,"targetType","targetId","createdAt")
        VALUES ($1,$2,$3,'PROGRAM_PREPARED','PROGRAM','synthetic-program','infinity')`, [randomUUID(), organisation.id, actorUserId], "23514");
      checks.push("Audit requires a real pilot organisation and bounded actor/target/request IDs and timestamps");

      await rejectsSql(tx, enrollmentSql, ["unknown-shopper", organisation.id, actorUserId], "23503");
      await rejectsSql(tx, enrollmentSql, [shopper.id, "unknown-pilot", actorUserId], "23503");
      await rejectsSql(tx, enrollmentSql, [shopper.id, organisation.id, "invalid@example.invalid"], "23514");
      await rejectsSql(tx, enrollmentSql, [shopper.id, organisation.id, null], "23502");
      await tx.$executeRawUnsafe(enrollmentSql, shopper.id, organisation.id, actorUserId);
      await rejectsSql(tx, enrollmentSql, [shopper.id, other.id, actorUserId], "23505");
      assert.deepEqual(await tx.rewardShopper.findUnique({ where: { id: shopper.id } }), originalShopper);
      assert.equal(await tx.rewardShopperMembership.count({ where: { shopperId: shopper.id } }), 0);
      assert.equal(await tx.rewardShopperCredential.count({ where: { shopperId: shopper.id } }), 0);
      assert.equal(await tx.rewardShopperInvitation.count({ where: { shopperId: shopper.id } }), 0);
      checks.push("One immutable pilot origin per shopper creates no tenant identity, membership, credential or invitation");

      for (const [column, value] of [["organisationId", other.id], ["shopperId", otherShopper.id], ["createdByUserId", "replacement-actor"]]) {
        await rejectsSql(tx, `UPDATE "RewardPilotShopperEnrollment" SET "${column}"=$1 WHERE "shopperId"=$2`, [value, shopper.id], "55000");
      }
      await rejectsSql(tx, 'DELETE FROM "RewardPilotShopperEnrollment" WHERE "shopperId"=$1', [shopper.id], "55000");
      await rejectsSql(tx, 'TRUNCATE TABLE "RewardPilotShopperEnrollment"', [], "55000");
      await rejectsSql(tx, 'DELETE FROM "RewardShopper" WHERE "id"=$1', [shopper.id], ["23001", "23503"]);
      await rejectsSql(tx, 'DELETE FROM "Organisation" WHERE "id"=$1', [organisation.id], ["23001", "23503"]);
      checks.push("Enrollment cannot be reassigned, altered, deleted or truncated and restricts parent deletion");

      await rejectsSql(tx, 'UPDATE "RewardPilotAuditEvent" SET "metadataJson"=\'{}\'::jsonb WHERE "organisationId"=$1', [organisation.id], "55000");
      await rejectsSql(tx, 'DELETE FROM "RewardPilotAuditEvent" WHERE "organisationId"=$1', [organisation.id], "55000");
      await rejectsSql(tx, 'TRUNCATE TABLE "RewardPilotAuditEvent"', [], "55000");
      const audit = await tx.rewardPilotAuditEvent.findFirst({ where: { organisationId: organisation.id } });
      await rejectsSql(tx, auditSql, auditParams({ id: audit.id }), "23505");
      checks.push("Pilot audit rejects update/delete/truncate/duplicate evidence without changing existing audit rules");

      const { ORGANISATION_SCOPED_RESET_MODELS } = await import("../lib/subscriber-test-reset.mjs");
      for (const name of ["RewardPilotShopperEnrollment", "RewardPilotAuditEvent"]) {
        assert.ok(ORGANISATION_SCOPED_RESET_MODELS.some(model => model.modelName === name), `${name} missing from reset discovery`);
      }
      // Real deletion attempts using the reset's generated delegate order.
      // A prior write must disappear when retained pilot history refuses reset.
      await tx.$executeRawUnsafe("SAVEPOINT rr07b_reset_attempt");
      await tx.organisation.update({ where: { id: organisation.id }, data: { name: "Reset must roll back this change" } });
      let resetFailure;
      try {
        for (const model of ORGANISATION_SCOPED_RESET_MODELS) {
          await tx[model.delegate].deleteMany({ where: { organisationId: { in: [organisation.id] } } });
        }
      } catch (error) { resetFailure = error; }
      assert.ok(resetFailure, "Reset unexpectedly erased pilot evidence");
      assert.match(String(resetFailure.message), /pilot evidence is immutable/);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rr07b_reset_attempt");
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT rr07b_reset_attempt");
      assert.equal((await tx.organisation.findUnique({ where: { id: organisation.id } })).name, organisation.name);
      assert.equal(await tx.rewardPilotShopperEnrollment.count({ where: { shopperId: shopper.id } }), 1);
      assert.ok(await tx.rewardPilotAuditEvent.count({ where: { organisationId: organisation.id } }) > 0);
      checks.push("Generated reset finds new models and retained evidence rejects all-or-nothing deletion");
      throw rollback;
    }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 120000 });
    assert.fail("Synthetic pilot schema fixtures must roll back");
  } catch (error) { if (error !== rollback) throw error; }
  assert.deepEqual(await db.$queryRawUnsafe(stateSql), before);
  checks.push("Rollback preserves every pre-existing shopper, organisation and audit count");
  return { count: checks.length, checks, allPassed: true, sourceDataUnchanged: true };
}
