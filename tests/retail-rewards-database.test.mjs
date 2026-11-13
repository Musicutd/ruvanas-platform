import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// These cases include the existing global subscriber reset. Require a dedicated
// owned cluster, never just DATABASE_URL or the shared CI database-test switch.
const enabled = process.env.RUN_DATABASE_TESTS === "1" && process.env.RUVANAS_REWARDS_LOCAL_TEST === "1";
const NOW = new Date("2026-11-13T12:00:00Z"), END = new Date("2027-11-13T12:00:00Z");
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const rollback = new Error("ROLL_BACK_SYNTHETIC_REWARDS_FIXTURE");

async function syntheticTransaction(db, operation) {
  try {
    await db.$transaction(async tx => { await operation(tx); throw rollback; }, { maxWait: 10000, timeout: 300000 });
    assert.fail("Fixture transaction must roll back.");
  } catch (error) { if (error !== rollback) throw error; }
}
async function rejectsSql(tx, query, params = [], code = "23514") {
  await tx.$executeRawUnsafe("SAVEPOINT reward_rejected_write");
  let failure;
  try { await tx.$executeRawUnsafe(query, ...params); } catch (error) { failure = error; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT reward_rejected_write");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT reward_rejected_write");
  assert.ok(failure, `PostgreSQL accepted forbidden SQL: ${query}`);
  const codes = Array.isArray(code) ? code : [code];
  assert.ok(codes.includes(failure.meta?.code), `Unexpected PostgreSQL rejection for ${query}: ${failure.message}`);
}
async function fixture(tx) {
  const prefix = `rr01b_${randomUUID().replaceAll("-", "")}`;
  const plan = await tx.plan.create({ data: { name: prefix, code: prefix.toUpperCase(), productFamily: "RETAIL",
    monthlyPriceCents: 1000, storageLimitGb: 1, listenerLimit: 1, maxBitrateKbps: 128, retailRadioEnabled: true } });
  const tenants = [];
  for (const label of ["own", "foreign"]) {
    const organisation = await tx.organisation.create({ data: { name: `Synthetic ${label}`, slug: `${prefix}-${label}` } });
    const user = await tx.user.create({ data: { email: `${prefix}-${label}@example.invalid`, passwordHash: "synthetic-not-a-password", role: "OWNER" } });
    const member = await tx.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id, role: "OWNER" } });
    const subscription = await tx.subscription.create({ data: { organisationId: organisation.id, planId: plan.id, status: "ACTIVE", currentPeriodEnd: END } });
    const location = await tx.location.create({ data: { organisationId: organisation.id, name: `Synthetic ${label} shop`, slug: label, status: "ACTIVE" } });
    tenants.push({ organisation, user, member, subscription, location });
  }
  const [own, foreign] = tenants;
  const program = await tx.rewardProgram.create({ data: { organisationId: own.organisation.id } });
  const grant = await tx.rewardEntitlementGrant.create({ data: { organisationId: own.organisation.id, subscriptionId: own.subscription.id,
    tier: "REWARDS_STARTER", startsAt: NOW, expiresAt: END, activeOffers: 3, locations: 2, staffSeats: 2,
    monthlyRedemptions: 100, analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false } });
  const staff = await tx.rewardStaffGrant.create({ data: { organisationId: own.organisation.id, organisationMemberId: own.member.id,
    scope: "LOCATIONS", locationId: own.location.id, capabilities: ["READ", "REDEEM"], startsAt: NOW, expiresAt: END } });
  return { prefix, plan, own, foreign, program, grant, staff };
}
function auditData(f) {
  return { organisationId: f.own.organisation.id, actorUserId: f.own.user.id, actorOrganisationMemberId: f.own.member.id,
    action: "STAFF_GRANT_CREATED", targetType: "STAFF_GRANT", targetId: f.staff.id, requestId: `${f.prefix}_request`, metadata: {} };
}

test("Rewards PostgreSQL constraints, audit evidence and reset compatibility on an owned disposable cluster", {
  skip: !enabled && "Use the isolated RR-01b local database harness; no ordinary application database is allowed."
}, async t => {
  const url = new URL(process.env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "rr01b_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.ok(["/ruvanas_rewards_full", "/ruvanas_rewards_upgrade"].includes(url.pathname));
  assert.equal(url.search, "?connection_limit=4");
  assert.equal(process.env.DATABASE_URL, url.href);
  const cluster = realpathSync(process.env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr01b-20261113\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: url.href });
  try {
    const [identity] = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port");
    assert.ok(samePath(identity.directory, cluster));
    assert.equal(identity.database, url.pathname.slice(1)); assert.equal(identity.role, "rr01b_qa");
    assert.equal(identity.host, "127.0.0.1"); assert.equal(identity.port, Number(url.port));

    await t.test("new rows remain disabled and the real adapter preserves exact tenant projections", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      assert.equal(f.program.status, "DISABLED"); assert.equal(f.program.networkOptIn, false);
      assert.equal(f.grant.status, "DISABLED"); assert.equal(f.grant.capability, "RETAIL_REWARDS");
      assert.equal(f.grant.source, "MANUAL_INTERNAL"); assert.equal(f.grant.limitsVersion, 1);
      assert.equal(await tx.rewardProgram.count({ where: { organisationId: f.foreign.organisation.id } }), 0);
      assert.equal(await tx.rewardEntitlementGrant.count({ where: { organisationId: f.foreign.organisation.id } }), 0);
      const { createRewardsDatabaseAdapter } = await import("../lib/retail-rewards/database-adapter.mjs");
      const adapter = createRewardsDatabaseAdapter(tx);
      const state = await adapter.loadRewardsState({ organisationId: f.own.organisation.id, subscriptionId: f.own.subscription.id });
      assert.equal(state.program.id, f.program.id); assert.equal(state.grant.id, f.grant.id);
      assert.deepEqual(state.grant.limits, { activeOffers: 3, locations: 2, staffSeats: 2, monthlyRedemptions: 100,
        analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false });
      assert.equal((await adapter.loadRewardsState({ organisationId: f.own.organisation.id, subscriptionId: f.foreign.subscription.id })).grant, null);
      assert.deepEqual((await adapter.loadStaffGrants({ organisationId: f.own.organisation.id, organisationMemberId: f.own.member.id }))[0].locationIds, [f.own.location.id]);
      assert.deepEqual(await adapter.loadStaffGrants({ organisationId: f.own.organisation.id, organisationMemberId: f.foreign.member.id }), []);
      assert.equal(await adapter.loadLocation({ organisationId: f.own.organisation.id, locationId: f.foreign.location.id }), null);
    }));

    await t.test("composite foreign keys reject cross-tenant subscription, membership and location links", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      await rejectsSql(tx, 'UPDATE "RewardEntitlementGrant" SET "subscriptionId"=$1 WHERE id=$2', [f.foreign.subscription.id, f.grant.id], "23503");
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET "organisationMemberId"=$1 WHERE id=$2', [f.foreign.member.id, f.staff.id], "23503");
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET "locationId"=$1 WHERE id=$2', [f.foreign.location.id, f.staff.id], "23503");
      // PostgreSQL versions distinguish RESTRICT violation (23001) from the
      // general foreign-key violation (23503); either must reject the deletion.
      await rejectsSql(tx, 'DELETE FROM "Location" WHERE id=$1', [f.own.location.id], ["23001", "23503"]);
      await rejectsSql(tx, 'DELETE FROM "Subscription" WHERE id=$1', [f.own.subscription.id], ["23001", "23503"]);
      await rejectsSql(tx, 'UPDATE "RewardProgram" SET "organisationId"=$1 WHERE id=$2', ["missing-organisation", f.program.id], "23503");
    }));

    await t.test("grant limits, sources and finite expiry are enforced by PostgreSQL", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      for (const column of ["activeOffers", "locations", "staffSeats", "monthlyRedemptions", "analyticsRetentionDays"]) {
        for (const value of [-1, 1000000001]) await rejectsSql(tx, `UPDATE "RewardEntitlementGrant" SET "${column}"=$1 WHERE id=$2`, [value, f.grant.id]);
        await rejectsSql(tx, `UPDATE "RewardEntitlementGrant" SET "${column}"=NULL WHERE id=$1`, [f.grant.id], "23502");
      }
      for (const [column, value] of [["capability", "OTHER"], ["source", "REQUEST_BODY"]]) {
        await rejectsSql(tx, `UPDATE "RewardEntitlementGrant" SET "${column}"=$1 WHERE id=$2`, [value, f.grant.id]);
      }
      await rejectsSql(tx, 'UPDATE "RewardEntitlementGrant" SET "limitsVersion"=2 WHERE id=$1', [f.grant.id]);
      for (const table of ["RewardEntitlementGrant", "RewardStaffGrant"]) {
        const id = table === "RewardEntitlementGrant" ? f.grant.id : f.staff.id;
        await rejectsSql(tx, `UPDATE "${table}" SET "expiresAt"="startsAt" WHERE id=$1`, [id]);
        await rejectsSql(tx, `UPDATE "${table}" SET "expiresAt"='infinity' WHERE id=$1`, [id]);
        await rejectsSql(tx, `UPDATE "${table}" SET "startsAt"='-infinity' WHERE id=$1`, [id]);
        await rejectsSql(tx, `UPDATE "${table}" SET "revokedAt"='infinity' WHERE id=$1`, [id]);
      }
    }));

    await t.test("staff scope, enum capabilities and single current scope cannot broaden accidentally", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET scope=\'ALL_LOCATIONS\' WHERE id=$1', [f.staff.id]);
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET "locationId"=NULL WHERE id=$1', [f.staff.id]);
      for (const array of ["ARRAY[]", "ARRAY['READ','READ']", "ARRAY['READ',NULL]", "ARRAY[['READ'],['REDEEM']]"]) {
        await rejectsSql(tx, `UPDATE "RewardStaffGrant" SET capabilities=${array}::"RewardAction"[] WHERE id=$1`, [f.staff.id]);
      }
      await rejectsSql(tx, 'UPDATE "RewardStaffGrant" SET capabilities=ARRAY[\'ADMIN\']::"RewardAction"[] WHERE id=$1', [f.staff.id], "22P02");
      await rejectsSql(tx, 'INSERT INTO "RewardStaffGrant" SELECT $1,"organisationId","organisationMemberId",scope,"locationId",capabilities,"startsAt","expiresAt","revokedAt","createdAt","updatedAt" FROM "RewardStaffGrant" WHERE id=$2', [`${f.prefix}_duplicate`, f.staff.id], "23505");
      await tx.rewardStaffGrant.create({ data: { organisationId: f.own.organisation.id, organisationMemberId: f.own.member.id,
        scope: "ALL_LOCATIONS", capabilities: ["READ"], startsAt: NOW, expiresAt: END } });
      await rejectsSql(tx, 'INSERT INTO "RewardStaffGrant" (id,"organisationId","organisationMemberId",scope,capabilities,"startsAt","expiresAt","updatedAt") VALUES ($1,$2,$3,\'ALL_LOCATIONS\',ARRAY[\'READ\']::"RewardAction"[],$4,$5,$4)',
        [`${f.prefix}_all_duplicate`, f.own.organisation.id, f.own.member.id, NOW, END], "23505");
    }));

    await t.test("audit rows reject mutation and evidence survives deletion of current membership authority", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), event = await tx.rewardAuditEvent.create({ data: auditData(f) });
      await rejectsSql(tx, 'UPDATE "RewardAuditEvent" SET metadata=\'{}\'::jsonb WHERE id=$1', [event.id], "55000");
      await rejectsSql(tx, 'DELETE FROM "RewardAuditEvent" WHERE id=$1', [event.id], "55000");
      await rejectsSql(tx, 'TRUNCATE TABLE "RewardAuditEvent"', [], "55000");
      await tx.organisationMember.delete({ where: { id: f.own.member.id } });
      assert.equal(await tx.rewardStaffGrant.count({ where: { organisationMemberId: f.own.member.id } }), 0);
      assert.deepEqual(await tx.rewardAuditEvent.findUnique({ where: { id: event.id } }), event);
      assert.equal((await tx.rewardAuditEvent.findUnique({ where: { id: event.id } })).actorOrganisationMemberId, f.own.member.id);
      await rejectsSql(tx, 'DELETE FROM "Organisation" WHERE id=$1', [f.own.organisation.id], ["23001", "23503"]);
    }));

    await t.test("audit metadata admits typed policy snapshots and rejects secrets or malformed fields", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx);
      const metadata = { reasonCode: "MANUAL_INTERNAL", before: { status: "DISABLED", revokedAt: null },
        after: { status: "ACTIVE", scope: "LOCATIONS", locationId: f.own.location.id, organisationMemberId: f.own.member.id,
          capabilities: ["READ", "REDEEM"], startsAt: NOW.toISOString(), expiresAt: END.toISOString(),
          tier: "REWARDS_STARTER", capability: "RETAIL_REWARDS", source: "MANUAL_INTERNAL", limitsVersion: 1,
          activeOffers: 0, locations: 1000000000, exportEnabled: false, brandingEnabled: true, networkOptIn: false, timezone: "Europe/Malta" } };
      const accepted = await tx.rewardAuditEvent.create({ data: { ...auditData(f), metadata } });
      assert.deepEqual(accepted.metadata, metadata);
      for (const metadata of [{ secret: "sensitive" }, { token: "sensitive" }, { email: "identity@example.invalid" },
        { rawPayload: {} }, [], null, "text", { reason: { nested: true } }, { before: { unknown: true } },
        { before: null }, { after: [] }, { reasonCode: "arbitrary user text" }, { reasonCode: null },
        { before: { status: "x".repeat(17000) } }, { before: { activeOffers: -1 } }, { after: { activeOffers: 1000000001 } },
        { after: { activeOffers: 1.5 } }, { after: { activeOffers: "3" } }, { after: { activeOffers: null } },
        { after: { limitsVersion: 2 } }, { after: { exportEnabled: "true" } }, { after: { tier: "ADMIN" } },
        { after: { capability: "OTHER" } }, { after: { source: "REQUEST_BODY" } }, { after: { scope: "OTHER" } },
        { after: { locationId: "../../foreign" } }, { after: { organisationMemberId: null } },
        { after: { startsAt: "infinity" } }, { after: { expiresAt: "2026-02-30T12:00:00.000Z" } }, { after: { startsAt: null } },
        { after: { capabilities: [] } }, { after: { capabilities: ["READ", "READ"] } },
        { after: { capabilities: [null] } }, { after: { capabilities: ["ADMIN"] } }, { after: { timezone: " " } }]) {
        await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId",action,"targetType","targetId",metadata) VALUES ($1,$2,\'STAFF_GRANT_CREATED\',\'STAFF_GRANT\',$3,$4::jsonb)',
          [`${f.prefix}_${randomUUID()}`, f.own.organisation.id, f.staff.id, JSON.stringify(metadata)]);
      }
      await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId",action,"targetType","targetId") VALUES ($1,$2,\'STAFF_GRANT_CREATED\',\'PROGRAM\',$3)',
        [`${f.prefix}_bad_target`, f.own.organisation.id, f.staff.id]);
      await rejectsSql(tx, 'INSERT INTO "RewardAuditEvent" (id,"organisationId","actorOrganisationMemberId",action,"targetType","targetId") VALUES ($1,$2,$3,\'STAFF_GRANT_CREATED\',\'STAFF_GRANT\',$4)',
        [`${f.prefix}_bad_actor`, f.own.organisation.id, f.own.member.id, f.staff.id]);
    }));

    await t.test("subscriber reset remains compatible with empty Rewards tables", () => syntheticTransaction(db, async tx => {
      const prefix = `rr01b_reset_${randomUUID().replaceAll("-", "")}`;
      const actor = await tx.user.create({ data: { email: `${prefix}@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
      const organisation = await tx.organisation.create({ data: { name: "Synthetic reset tenant", slug: prefix } });
      const user = await tx.user.create({ data: { email: `${prefix}-target@example.invalid`, passwordHash: "synthetic" } });
      await tx.organisationMember.create({ data: { organisationId: organisation.id, userId: user.id } });
      for (const delegate of ["rewardProgram", "rewardEntitlementGrant", "rewardStaffGrant", "rewardAuditEvent"]) assert.equal(await tx[delegate].count(), 0);
      await rejectsSql(tx, 'TRUNCATE TABLE "RewardAuditEvent"', [], "55000");
      const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION } = await import("../lib/subscriber-test-reset.mjs");
      const result = await resetSubscriberTestData({ $transaction: operation => operation(tx) }, {
        actor, retainedEmail: actor.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION
      });
      assert.ok(result.deletedOrganisations >= 1); assert.ok(result.deletedUsers >= 1);
      assert.equal(await tx.organisation.count(), 0); assert.equal(await tx.user.count(), 1);
      assert.equal((await tx.user.findUnique({ where: { id: actor.id } })).role, "SUPER_ADMIN");
    }));

    await t.test("subscriber reset fails atomically when Rewards evidence exists", () => syntheticTransaction(db, async tx => {
      const f = await fixture(tx), event = await tx.rewardAuditEvent.create({ data: auditData(f) });
      const actor = await tx.user.create({ data: { email: `${f.prefix}-admin@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
      const before = {
        organisations: await tx.organisation.findMany({ orderBy: { id: "asc" } }), users: await tx.user.findMany({ orderBy: { id: "asc" } }),
        members: await tx.organisationMember.findMany({ orderBy: { id: "asc" } }),
        grants: await tx.rewardEntitlementGrant.findMany(), staff: await tx.rewardStaffGrant.findMany(), audit: await tx.rewardAuditEvent.findMany()
      };
      const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION } = await import("../lib/subscriber-test-reset.mjs");
      const nestedTransaction = async operation => {
        await tx.$executeRawUnsafe("SAVEPOINT reset_atomicity");
        try { const result = await operation(tx); await tx.$executeRawUnsafe("RELEASE SAVEPOINT reset_atomicity"); return result; }
        catch (error) { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT reset_atomicity"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT reset_atomicity"); throw error; }
      };
      await assert.rejects(resetSubscriberTestData({ $transaction: nestedTransaction }, {
        actor, retainedEmail: actor.email, confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION
      }), error => error.code === "RESET_STAGE_REWARDAUDITEVENT");
      assert.deepEqual(await tx.organisation.findMany({ orderBy: { id: "asc" } }), before.organisations);
      assert.deepEqual(await tx.user.findMany({ orderBy: { id: "asc" } }), before.users);
      assert.deepEqual(await tx.organisationMember.findMany({ orderBy: { id: "asc" } }), before.members);
      assert.deepEqual(await tx.rewardEntitlementGrant.findMany(), before.grants);
      assert.deepEqual(await tx.rewardStaffGrant.findMany(), before.staff);
      assert.deepEqual(await tx.rewardAuditEvent.findMany(), before.audit);
      assert.deepEqual(await tx.rewardAuditEvent.findUnique({ where: { id: event.id } }), event);
    }));
  } finally { await db.$disconnect(); }
});
