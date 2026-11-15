import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const NOW = new Date("2026-11-14T12:00:00.000Z"), END = new Date("2027-11-14T12:00:00.000Z");
const CI_URL = "postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/ruvanas_rewards_ci";
const requested = process.env.RUVANAS_REWARDS_AUTH_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const rollback = new Error("ROLL_BACK_SYNTHETIC_REWARDS_OFFER_FIXTURE");

export function shopperAuthDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1");
    assert.equal(env.RUVANAS_REWARDS_AUTH_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined);
    assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
      GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
    assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.equal(env.DATABASE_URL, CI_URL); assert.equal(env.RUVANAS_REWARDS_DATABASE_URL, CI_URL);
    return { mode: "CI", url: new URL(CI_URL) };
  }
  assert.equal(env.RUVANAS_REWARDS_AUTH_LOCAL_TEST, "1");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "rr03b_qa"); assert.equal(url.password, "");
  assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535);
  assert.ok(["/ruvanas_rewards_auth_full", "/ruvanas_rewards_auth_upgrade"].includes(url.pathname));
  assert.equal(url.search, "?connection_limit=6"); assert.equal(env.DATABASE_URL, url.href);
  assert.equal(typeof env.RUVANAS_REWARDS_CLUSTER_DIR, "string");
  const cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR);
  assert.ok(path.isAbsolute(cluster));
  assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr03b-20261114\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
  return { mode: "LOCAL", url, cluster };
}

export async function openShopperAuthDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = shopperAuthDatabaseTarget(env, options), db = await createClient(target.url.href);
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
    assert.equal(rows.length, 1); const [identity] = rows;
    assert.equal(identity.database, target.url.pathname.slice(1)); assert.equal(identity.port, Number(target.url.port));
    if (target.mode === "CI") {
      assert.equal(identity.role, "rewards_ci"); assert.equal(identity.directory, "/var/lib/postgresql/data");
      assert.ok(identity.version >= 160000 && identity.version < 170000);
      assert.equal(typeof identity.host, "string"); assert.ok(identity.host.length > 0);
    } else {
      assert.equal(identity.role, "rr03b_qa"); assert.equal(identity.host, "127.0.0.1"); assert.ok(samePath(identity.directory, target.cluster));
    }
    return { db, target };
  } catch (error) { await db.$disconnect(); throw error; }
}

const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL,
  RUVANAS_REWARDS_DATABASE_URL: CI_URL, GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI",
  GITHUB_JOB: "rewards-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });

test("RR-03b database tests reject unowned targets before constructing a database client", async () => {
  assert.equal(shopperAuthDatabaseTarget(ciEnv(), { platform: "linux" }).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" },
    { RUVANAS_REWARDS_AUTH_LOCAL_TEST: "1" }, { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/unknown" },
    { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_RUN_ID: "0" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.example") }, { DATABASE_URL: undefined },
    { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }]) {
    let clients = 0;
    await assert.rejects(openShopperAuthDatabase({ ...ciEnv(), ...patch }, { platform: "linux", createClient: () => { clients++; } }));
    assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openShopperAuthDatabase(ciEnv(), { platform: "linux", createClient: () => ({
    $queryRawUnsafe: async () => [{ directory: "/production", database: "ruvanas", role: "postgres", host: "127.0.0.1", port: 5432, version: 160000 }],
    $disconnect: async () => { disconnected++; }
  }) }));
  assert.equal(disconnected, 1);
});

const ENV = Object.freeze({ RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true",
  RUVANAS_RETAIL_REWARDS_SHOPPER_AUTH_ENABLED: "true", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false",
  SESSION_SECRET: "synthetic-local-auth-test-secret-not-production" });
const PASSWORD = "Only a synthetic local passphrase!";
const INVITE_START = new Date(NOW.getTime() - 60_000), INVITE_END = new Date(NOW.getTime() + 3_600_000);
let bcryptHash;
async function validPasswordHash() {
  const bcrypt = (await import("bcryptjs")).default;
  return bcryptHash ||= await bcrypt.hash(PASSWORD, 12);
}
async function invitationFixture(db, patch = {}) {
  const { hashShopperInvitationToken } = await import("../lib/retail-rewards/shopper-auth-service.mjs");
  const token = randomBytes(32).toString("hex"), email = `rr03b-${randomUUID()}@example.invalid`;
  const shopper = await db.rewardShopper.create({ data: { displayName: "Synthetic invited shopper" } });
  const membership = await db.rewardShopperMembership.create({ data: { shopperId: shopper.id, status: "ACTIVE",
    startsAt: new Date("2026-01-01T00:00:00Z"), expiresAt: END, ...patch.membership } });
  const invitation = await db.rewardShopperInvitation.create({ data: { shopperId: shopper.id, emailCanonical: email,
    tokenHash: hashShopperInvitationToken(token, ENV.SESSION_SECRET), authVersion: shopper.authVersion,
    createdAt: INVITE_START, expiresAt: INVITE_END, ...patch.invitation } });
  return { shopper, membership, invitation, email, token };
}
async function cleanupFixture(db, fixture) {
  const shopperId = fixture.shopper.id;
  await db.$transaction(async tx => {
    await tx.rewardShopperSession.deleteMany({ where: { shopperId } });
    await tx.rewardShopperCredential.deleteMany({ where: { shopperId } });
    await tx.rewardShopperInvitation.deleteMany({ where: { shopperId } });
    await tx.rewardShopperMembership.deleteMany({ where: { shopperId } });
    await tx.rewardShopper.delete({ where: { id: shopperId } });
  });
}
async function withFixture(db, operation, patch) {
  const fixture = await invitationFixture(db, patch);
  try { return await operation(fixture); } finally { await cleanupFixture(db, fixture); }
}
async function serviceFor(db, clock = () => NOW) {
  const { createShopperAuthService } = await import("../lib/retail-rewards/shopper-auth-service.mjs");
  return createShopperAuthService({ db, env: ENV, clock });
}
async function stateOf(db, fixture) {
  const shopperId = fixture.shopper.id;
  const [shopper, invitation, credentials, sessions] = await Promise.all([
    db.rewardShopper.findUnique({ where: { id: shopperId } }),
    db.rewardShopperInvitation.findUnique({ where: { shopperId } }),
    db.rewardShopperCredential.count({ where: { shopperId } }), db.rewardShopperSession.count({ where: { shopperId } })
  ]);
  return { status: shopper.status, authVersion: shopper.authVersion, acceptedAt: invitation.acceptedAt, credentials, sessions };
}
async function assertNoAcceptance(db, fixture) {
  const state = await stateOf(db, fixture);
  assert.equal(state.status, "DISABLED"); assert.equal(state.acceptedAt, null);
  assert.equal(state.credentials, 0); assert.equal(state.sessions, 0);
}
async function rejectsSql(tx, query, params = [], codes = ["23514"]) {
  await tx.$executeRawUnsafe("SAVEPOINT rejected_auth_write"); let error;
  try { await tx.$executeRawUnsafe(query, ...params); } catch (caught) { error = caught; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rejected_auth_write");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT rejected_auth_write");
  assert.ok(error, "A forbidden synthetic write was accepted.");
  assert.ok(codes.includes(error.meta?.code), `Unexpected SQL rejection code: ${error.meta?.code}`);
}
async function syntheticTransaction(db, operation) {
  try { await db.$transaction(async tx => { await operation(tx); throw rollback; }, { timeout: 120000 }); assert.fail("Expected rollback."); }
  catch (error) { if (error !== rollback) throw error; }
}
async function whileShopperLocked(db, fixture, start, revoke, mutateLocked) {
  let release, acquired;
  const held = new Promise(resolve => { acquired = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const locker = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "RewardShopper" WHERE "id"=${fixture.shopper.id} FOR UPDATE`;
    acquired(); await gate;
    if (mutateLocked) await mutateLocked(tx);
  }, { timeout: 30000 });
  let operation, result;
  try {
    await Promise.race([held, locker.then(() => { throw new Error("Shopper lock ended before acquisition."); })]);
    operation = start();
    const deadline = Date.now() + 10000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock'
          AND query LIKE '%RewardShopper%' AND query LIKE '%FOR UPDATE%'`;
      if (rows[0].count > 0) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, "Authentication never reached the held shopper lock.");
    await revoke();
  } finally { release(); await locker; if (operation) result = await operation; }
  return result;
}

test("RR-03b PostgreSQL private shopper acceptance, sign-in and revocation", {
  skip: !requested && "Requires an owned disposable RR-03b cluster or the dedicated Rewards CI database."
}, async t => {
  const { db } = await openShopperAuthDatabase(process.env);
  try {
    assert.equal(await db.rewardShopperCredential.count(), 0, "Migration must not create credentials.");
    assert.equal(await db.rewardShopperInvitation.count(), 0, "Migration must not create invitations.");
    const service = await serviceFor(db);

    await t.test("credentials and invitations enforce canonical identity, bcrypt12 and finite expiry", () => withFixture(db, async f => {
      await db.rewardShopperCredential.create({ data: { shopperId: f.shopper.id, emailCanonical: f.email, passwordHash: await validPasswordHash() } });
      await db.$transaction(async tx => {
        for (const email of ["UPPER@example.invalid", " space@example.invalid", "not-an-email", "two..dots@example.invalid", "unicode-ž@example.invalid"]) {
          await rejectsSql(tx, 'UPDATE "RewardShopperCredential" SET "emailCanonical"=$1 WHERE "shopperId"=$2', [email, f.shopper.id]);
          await rejectsSql(tx, 'UPDATE "RewardShopperInvitation" SET "emailCanonical"=$1 WHERE "shopperId"=$2', [email, f.shopper.id]);
        }
        for (const hash of ["plain-text-is-not-a-hash", (await validPasswordHash()).replace("$12$", "$10$"), (await validPasswordHash()).replace(/^\$2[ab]\$/, "$2y$")])
          await rejectsSql(tx, 'UPDATE "RewardShopperCredential" SET "passwordHash"=$1 WHERE "shopperId"=$2', [hash, f.shopper.id]);
        for (const query of ['UPDATE "RewardShopperInvitation" SET "authVersion"=0 WHERE id=$1',
          'UPDATE "RewardShopperInvitation" SET "tokenHash"=\'ABC\' WHERE id=$1',
          'UPDATE "RewardShopperInvitation" SET "expiresAt"="createdAt" WHERE id=$1',
          'UPDATE "RewardShopperInvitation" SET "expiresAt"="createdAt"+interval \'24 hours 1 millisecond\' WHERE id=$1',
          'UPDATE "RewardShopperInvitation" SET "expiresAt"=\'infinity\' WHERE id=$1',
          'UPDATE "RewardShopperInvitation" SET "acceptedAt"="expiresAt" WHERE id=$1',
          'UPDATE "RewardShopperInvitation" SET "acceptedAt"="createdAt"-interval \'1 millisecond\' WHERE id=$1',
          'UPDATE "RewardShopperInvitation" SET "revokedAt"="createdAt"-interval \'1 millisecond\' WHERE id=$1'])
          await rejectsSql(tx, query, [f.invitation.id]);
        await rejectsSql(tx, 'DELETE FROM "RewardShopper" WHERE id=$1', [f.shopper.id], ["23503", "23001"]);
      });
    }));

    await t.test("SQL canonical email validation matches the shared supported ASCII subset", async () => {
      const { canonicalEmailSchema } = await import("../lib/retail-rewards/shopper-auth-contracts.mjs");
      for (const value of ["normal@example.invalid", "o'neil@example.invalid", "shopper+test@example.invalid", "a_b@example.invalid",
        ".leading@example.invalid", "trailing.@example.invalid", "two..dots@example.invalid", "a@-domain.invalid",
        "upper@EXAMPLE.invalid", " leading@example.invalid", "trailing@example.invalid ", "unicode-ž@example.invalid",
        "a@example.x", "a@exam_ple.invalid", "a\n@example.invalid", "not-an-email", "a@example.invalid"]) {
        const parsed = canonicalEmailSchema.safeParse(value);
        const expected = parsed.success && parsed.data === value;
        const [row] = await db.$queryRaw`SELECT "ruvanas_rewards_email_canonical_valid"(${value}) AS valid`;
        assert.equal(row.valid, expected, `Canonical email mismatch for synthetic sample ${JSON.stringify(value)}`);
      }
    });

    await t.test("acceptance activates only the invited shopper and stores hashes, not raw credentials", () => withFixture(db, async f => {
      const business = await db.user.create({ data: { email: f.email, passwordHash: "synthetic-business-hash", role: "SUPER_ADMIN" } });
      try {
        const before = await Promise.all([db.user.count(), db.organisation.count(), db.organisationMember.count(), db.subscription.count()]);
        const result = await service.acceptInvite({ token: f.token, password: PASSWORD, displayName: "Invited shopper" });
        assert.equal(result.ok, true, result.code); assert.match(result.rawSessionToken, /^[a-f0-9]{64}$/);
        const credential = await db.rewardShopperCredential.findUnique({ where: { shopperId: f.shopper.id } });
        assert.equal(credential.emailCanonical, f.email); assert.match(credential.passwordHash, /^\$2[ab]\$12\$/);
        assert.notEqual(credential.passwordHash, PASSWORD);
        const stored = await db.rewardShopperSession.findFirst({ where: { shopperId: f.shopper.id } });
        assert.notEqual(stored.tokenHash, result.rawSessionToken); assert.ok(stored.expiresAt <= END);
        const state = await stateOf(db, f);
        assert.equal(state.status, "ACTIVE"); assert.equal(state.credentials, 1); assert.equal(state.sessions, 1); assert.ok(state.acceptedAt);
        assert.deepEqual(await Promise.all([db.user.count(), db.organisation.count(), db.organisationMember.count(), db.subscription.count()]), before);
        assert.equal((await db.user.findUnique({ where: { id: business.id } })).role, "SUPER_ADMIN");
      } finally { await db.user.delete({ where: { id: business.id } }); }
    }));

    await t.test("simultaneous invitation replay accepts exactly once", () => withFixture(db, async f => {
      const results = await Promise.all([1, 2].map(() => service.acceptInvite({ token: f.token, password: PASSWORD })));
      assert.equal(results.filter(row => row.ok).length, 1);
      assert.equal(results.find(row => !row.ok)?.code, "INVITATION_UNAVAILABLE");
      const state = await stateOf(db, f); assert.equal(state.credentials, 1); assert.equal(state.sessions, 1); assert.ok(state.acceptedAt);
      assert.equal((await service.acceptInvite({ token: f.token, password: PASSWORD })).code, "INVITATION_UNAVAILABLE");
    }));

    await t.test("expired or authVersion-invalidated invitations create no account access", async () => {
      for (const change of [
        f => db.rewardShopperInvitation.update({ where: { id: f.invitation.id }, data: { expiresAt: NOW } }),
        f => db.rewardShopper.update({ where: { id: f.shopper.id }, data: { authVersion: 2 } }),
        f => db.rewardShopperMembership.update({ where: { id: f.membership.id }, data: { expiresAt: NOW } })
      ]) await withFixture(db, async f => {
        await change(f);
        assert.equal((await service.acceptInvite({ token: f.token, password: PASSWORD })).code, "INVITATION_UNAVAILABLE");
        await assertNoAcceptance(db, f);
      });
    });

    await t.test("failure during session creation rolls back activation, credential and consumption", () => withFixture(db, async f => {
      const wrapped = new Proxy(db, { get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key);
        return (operation, options) => target.$transaction(tx => operation(new Proxy(tx, { get(client, property) {
          if (property === "rewardShopperSession") return { ...client.rewardShopperSession,
            create: async () => { throw new Error("Synthetic session-write failure"); } };
          return Reflect.get(client, property);
        } })), options);
      } });
      const failing = await serviceFor(wrapped);
      assert.equal((await failing.acceptInvite({ token: f.token, password: PASSWORD })).ok, false);
      await assertNoAcceptance(db, f);
    }));

    await t.test("canonical email collision rolls back the entire invitation acceptance", () => withFixture(db, async f => {
      const other = await db.rewardShopper.create({ data: {} });
      try {
        await db.rewardShopperCredential.create({ data: { shopperId: other.id, emailCanonical: f.email, passwordHash: await validPasswordHash() } });
        assert.equal((await service.acceptInvite({ token: f.token, password: PASSWORD })).code, "INVITATION_UNAVAILABLE");
        await assertNoAcceptance(db, f);
      } finally {
        await db.rewardShopperCredential.delete({ where: { shopperId: other.id } });
        await db.rewardShopper.delete({ where: { id: other.id } });
      }
    }));

    for (const authority of ["membership", "invitation"]) await t.test(`${authority} revocation committed while acceptance waits prevents all writes`, () => withFixture(db, async f => {
      const result = await whileShopperLocked(db, f,
        () => service.acceptInvite({ token: f.token, password: PASSWORD }),
        () => authority === "membership"
          ? db.rewardShopperMembership.update({ where: { id: f.membership.id }, data: { revokedAt: NOW } })
          : db.rewardShopperInvitation.update({ where: { id: f.invitation.id }, data: { revokedAt: NOW } }));
      assert.equal(result.code, "INVITATION_UNAVAILABLE"); await assertNoAcceptance(db, f);
    }));

    await t.test("authVersion revocation committed by the shopper-lock owner prevents queued acceptance", () => withFixture(db, async f => {
      const result = await whileShopperLocked(db, f, () => service.acceptInvite({ token: f.token, password: PASSWORD }), async () => {},
        tx => tx.rewardShopper.update({ where: { id: f.shopper.id }, data: { authVersion: 2 } }));
      assert.equal(result.code, "INVITATION_UNAVAILABLE"); await assertNoAcceptance(db, f);
    }));

    await t.test("login obeys current membership and logout revokes only its shopper session", () => withFixture(db, async f => {
      const accepted = await service.acceptInvite({ token: f.token, password: PASSWORD }); assert.equal(accepted.ok, true, accepted.code);
      const wrong = await service.login({ email: f.email, password: "A wrong synthetic passphrase" });
      const missing = await service.login({ email: "missing@example.invalid", password: PASSWORD });
      assert.deepEqual(wrong, missing); assert.equal(wrong.code, "AUTH_FAILED");
      const logged = await service.login({ email: f.email.toUpperCase(), password: PASSWORD }); assert.equal(logged.ok, true, logged.code);
      assert.notEqual(logged.rawSessionToken, accepted.rawSessionToken);
      const { requireRewardShopperAccess } = await import("../lib/retail-rewards/shopper-access.mjs");
      const access = token => requireRewardShopperAccess({ db, env: ENV, token, clock: () => NOW });
      assert.equal((await access(logged.rawSessionToken)).ok, true);
      assert.equal((await service.logout({ token: logged.rawSessionToken })).ok, true);
      assert.equal((await access(logged.rawSessionToken)).code, "UNAUTHENTICATED");
      assert.equal((await access(accepted.rawSessionToken)).ok, true);
      assert.equal((await service.logout({ token: logged.rawSessionToken })).ok, true);
      assert.equal((await service.logout({ token: "bad-token" })).ok, true);
      await db.rewardShopperMembership.update({ where: { id: f.membership.id }, data: { revokedAt: NOW } });
      assert.equal((await service.login({ email: f.email, password: PASSWORD })).code, "AUTH_FAILED");
    }));

    await t.test("membership revocation committed while login waits cannot mint a session", () => withFixture(db, async f => {
      assert.equal((await service.acceptInvite({ token: f.token, password: PASSWORD })).ok, true);
      const before = await db.rewardShopperSession.count({ where: { shopperId: f.shopper.id } });
      const result = await whileShopperLocked(db, f, () => service.login({ email: f.email, password: PASSWORD }),
        () => db.rewardShopperMembership.update({ where: { id: f.membership.id }, data: { revokedAt: NOW } }));
      assert.equal(result.code, "AUTH_FAILED");
      assert.equal(await db.rewardShopperSession.count({ where: { shopperId: f.shopper.id } }), before);
    }));

    await t.test("authVersion change committed by the shopper-lock owner prevents queued login", () => withFixture(db, async f => {
      assert.equal((await service.acceptInvite({ token: f.token, password: PASSWORD })).ok, true);
      const before = await db.rewardShopperSession.count({ where: { shopperId: f.shopper.id } });
      const result = await whileShopperLocked(db, f, () => service.login({ email: f.email, password: PASSWORD }), async () => {},
        tx => tx.rewardShopper.update({ where: { id: f.shopper.id }, data: { authVersion: 2 } }));
      assert.equal(result.code, "AUTH_FAILED");
      assert.equal(await db.rewardShopperSession.count({ where: { shopperId: f.shopper.id } }), before);
    }));

    await t.test("issued session never outlives the remaining internal membership", () => withFixture(db, async f => {
      const result = await service.acceptInvite({ token: f.token, password: PASSWORD }); assert.equal(result.ok, true, result.code);
      assert.equal(new Date(result.expiresAt).getTime(), NOW.getTime() + 90_000);
    }, { membership: { expiresAt: new Date(NOW.getTime() + 90_000) } }));

    await t.test("business reset preserves all five global shopper identity and authentication models", () => withFixture(db, async f => {
      assert.equal((await service.acceptInvite({ token: f.token, password: PASSWORD })).ok, true);
      await syntheticTransaction(db, async tx => {
        const actor = await tx.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic", role: "SUPER_ADMIN" } });
        const organisation = await tx.organisation.create({ data: { name: "Synthetic business reset", slug: `reset-${randomUUID()}` } });
        const user = await tx.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic" } });
        await tx.organisationMember.create({ data: { userId: user.id, organisationId: organisation.id } });
        const delegates = ["rewardShopper", "rewardShopperSession", "rewardShopperMembership", "rewardShopperCredential", "rewardShopperInvitation"];
        const before = await Promise.all(delegates.map(name => tx[name].findMany()));
        const { resetSubscriberTestData, SUBSCRIBER_TEST_RESET_CONFIRMATION, ORGANISATION_SCOPED_RESET_MODELS } = await import("../lib/subscriber-test-reset.mjs");
        const names = ORGANISATION_SCOPED_RESET_MODELS.map(row => row.delegate);
        for (const name of delegates) assert.equal(names.includes(name), false);
        await resetSubscriberTestData({ $transaction: operation => operation(tx) }, { actor, retainedEmail: actor.email,
          confirmation: SUBSCRIBER_TEST_RESET_CONFIRMATION });
        assert.equal(await tx.organisation.count(), 0); assert.equal(await tx.user.count(), 1);
        assert.deepEqual(await Promise.all(delegates.map(name => tx[name].findMany())), before);
      });
    }));
  } finally { await db.$disconnect(); }
});

