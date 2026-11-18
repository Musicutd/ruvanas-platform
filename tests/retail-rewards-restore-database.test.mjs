import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = "20261219000000_retail_rewards_restore_validation";
const SOURCE_DB = "ruvanas_rewards_restore_source", RESTORED_DB = "ruvanas_rewards_restore_target";
const CI_URL = `postgresql://rewards_ci:rewards_ci@127.0.0.1:5432/${SOURCE_DB}`;
const requested = process.env.RUVANAS_REWARDS_RESTORE_LOCAL_TEST !== undefined || process.env.RUVANAS_REWARDS_CI_TEST !== undefined;
const NOW = new Date("2026-11-15T12:00:00.000Z"), END = new Date("2027-11-15T12:00:00.000Z");
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const identifier = name => { assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/); return `"${name}"`; };
const rollback = new Error("ROLL_BACK_RESTORE_VALIDATION_PROBE");

// An arbitrary DATABASE_URL is deliberately insufficient. This suite creates
// one new restore database and writes only synthetic fixtures on an owned target.
export function restoreDatabaseTarget(env, { platform = process.platform, realpath = realpathSync } = {}) {
  assert.equal(env.RUN_DATABASE_TESTS, "1");
  for (const [key, value] of Object.entries(env)) if (key.startsWith("RUVANAS_RETAIL_REWARDS_") && key.endsWith("_ENABLED")) assert.equal(value, "false");
  assert.equal(env.RUVANAS_RETAIL_REWARDS_ENABLED, "false");
  const url = new URL(env.RUVANAS_REWARDS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, `/${SOURCE_DB}`); assert.equal(url.hash, ""); assert.equal(env.DATABASE_URL, url.href);
  let cluster, artifacts, binaries;
  if (env.RUVANAS_REWARDS_CI_TEST !== undefined) {
    assert.equal(env.RUVANAS_REWARDS_CI_TEST, "1"); assert.equal(env.RUVANAS_REWARDS_RESTORE_LOCAL_TEST, undefined);
    assert.equal(env.RUVANAS_REWARDS_CLUSTER_DIR, undefined); assert.equal(platform, "linux");
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI", GITHUB_JOB: "rewards-restore-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" })) assert.equal(env[key], value);
    assert.match(env.GITHUB_REPOSITORY || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/); assert.match(env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
    assert.equal(url.href, CI_URL); assert.equal(env.PG_BINDIR, "/usr/lib/postgresql/16/bin");
    assert.equal(env.RUVANAS_REWARDS_RESTORE_ARTIFACT_DIR, undefined);
    const runnerTemp = realpath(env.RUNNER_TEMP); assert.ok(path.isAbsolute(runnerTemp)); assert.match(runnerTemp, /\/work\/_temp$/);
    artifacts = path.join(runnerTemp, "ruvanas-rewards-restore"); binaries = env.PG_BINDIR;
  } else {
    assert.equal(env.RUVANAS_REWARDS_RESTORE_LOCAL_TEST, "1"); assert.equal(url.username, "rr07k_restore"); assert.equal(url.password, "");
    assert.ok(Number(url.port) > 1024 && Number(url.port) <= 65535); assert.equal(url.search, "?connection_limit=4");
    cluster = realpath(env.RUVANAS_REWARDS_CLUSTER_DIR); assert.ok(path.isAbsolute(cluster));
    assert.match(cluster.replaceAll("\\", "/"), /\/retail-rewards-rr07k-restore-20261115\/sessions\/postgres-[0-9]+-[a-f0-9]{10}\/postgres$/);
    artifacts = realpath(env.RUVANAS_REWARDS_RESTORE_ARTIFACT_DIR);
    assert.ok(samePath(artifacts, path.join(path.dirname(cluster), "artifacts")));
    binaries = realpath(env.PG_BINDIR); assert.ok(path.isAbsolute(binaries));
    assert.match(binaries.replaceAll("\\", "/"), /\/PostgreSQL\/(16|18)\/bin$/);
  }
  return { mode: env.RUVANAS_REWARDS_CI_TEST ? "CI" : "LOCAL", url, cluster, artifacts, binaries, platform };
}

export async function openRestoreDatabase(env, { createClient = async url => {
  const { PrismaClient } = await import("@prisma/client"); return new PrismaClient({ datasourceUrl: url });
}, ...options } = {}) {
  const target = restoreDatabaseTarget(env, options), db = await createClient(target.url.href);
  try { await identity(db, target, SOURCE_DB); return { db, target }; }
  catch (error) { await db.$disconnect(); throw error; }
}
async function identity(db, target, database) {
  assert.ok([SOURCE_DB, RESTORED_DB].includes(database));
  const [row] = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS directory,current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer AS version");
  assert.equal(row.database, database); assert.equal(row.role, target.url.username); assert.equal(row.port, Number(target.url.port));
  if (target.mode === "CI") { assert.equal(row.directory, "/var/lib/postgresql/data"); assert.ok(row.version >= 160000 && row.version < 170000); }
  else { assert.ok(samePath(row.directory, target.cluster)); assert.equal(row.host, "127.0.0.1"); assert.ok(row.version >= 160000 && row.version < 190000); }
  return row;
}
const ciEnv = () => ({ RUN_DATABASE_TESTS: "1", RUVANAS_REWARDS_CI_TEST: "1", DATABASE_URL: CI_URL, RUVANAS_REWARDS_DATABASE_URL: CI_URL,
  RUVANAS_RETAIL_REWARDS_ENABLED: "false", PG_BINDIR: "/usr/lib/postgresql/16/bin", RUNNER_TEMP: "/home/runner/work/_temp",
  GITHUB_ACTIONS: "true", CI: "true", GITHUB_WORKFLOW: "CI", GITHUB_JOB: "rewards-restore-database", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", GITHUB_REPOSITORY: "synthetic/repository", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" });
test("Rewards restore rejects unowned targets before opening a database", async () => {
  const options = { platform: "linux", realpath: value => value };
  assert.equal(restoreDatabaseTarget(ciEnv(), options).mode, "CI");
  for (const patch of [{ RUN_DATABASE_TESTS: "0" }, { RUVANAS_REWARDS_CI_TEST: "true" }, { RUVANAS_REWARDS_RESTORE_LOCAL_TEST: "1" },
    { RUVANAS_REWARDS_CLUSTER_DIR: "/tmp/unknown" }, { GITHUB_JOB: "validate" }, { RUNNER_ENVIRONMENT: "self-hosted" },
    { RUVANAS_RETAIL_REWARDS_ENABLED: "true" }, { RUVANAS_RETAIL_REWARDS_CHECKOUT_ENABLED: "true" }, { PG_BINDIR: "/tmp/bin" },
    { DATABASE_URL: CI_URL.replace("127.0.0.1", "production.invalid") }, { RUVANAS_REWARDS_DATABASE_URL: `${CI_URL}?schema=public` }, { GITHUB_RUN_ID: "0" }]) {
    let clients = 0; await assert.rejects(openRestoreDatabase({ ...ciEnv(), ...patch }, { ...options, createClient: () => { clients++; } })); assert.equal(clients, 0);
  }
  let disconnected = 0;
  await assert.rejects(openRestoreDatabase(ciEnv(), { ...options, createClient: () => ({ $queryRawUnsafe: async () => [{ database: "production" }], $disconnect: async () => { disconnected++; } }) }));
  assert.equal(disconnected, 1);
});

function commandEnv(target, privateDirectory) {
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE"]) if (process.env[key]) env[key] = process.env[key];
  env.PATH = process.env.PATH || process.env.Path || "";
  Object.assign(env, { DATABASE_URL: target.url.href, RUVANAS_RETAIL_REWARDS_ENABLED: "false", RUVANAS_RETAIL_REWARDS_PUBLIC_CLAIMS_ENABLED: "false",
    NEXT_TELEMETRY_DISABLED: "1", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", PGCONNECT_TIMEOUT: "10",
    PGPASSFILE: path.join(privateDirectory, "empty.pgpass"), PGSERVICEFILE: path.join(privateDirectory, "empty.pg_service.conf") });
  if (target.url.password) env.PGPASSWORD = decodeURIComponent(target.url.password);
  return env;
}
async function run(executable, args, env, logFile, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: ROOT, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", failed = false; const timer = setTimeout(() => { failed = true; child.kill(); }, timeout);
    child.on("error", () => { failed = true; });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", value => { output += value.toString("utf8"); if (Buffer.byteLength(output) > 8 * 1024 * 1024) { failed = true; child.kill(); } });
    child.on("close", code => {
      clearTimeout(timer); const safe = output.replace(/postgres(?:ql)?:\/\/\S+/gi, "[OWNED_SYNTHETIC_DATABASE]").replace(/\b[a-f0-9]{64}\b/gi, "[HASH]");
      writeFileSync(logFile, safe);
      if (failed || code !== 0) reject(new Error(`${path.basename(executable)} failed; see ${path.basename(logFile)}.`)); else resolve(safe);
    });
  });
}
async function transactionRolledBack(db, operation) {
  try { await db.$transaction(async tx => { await operation(tx); throw rollback; }, { timeout: 60000 }); assert.fail("Expected fixture rollback"); }
  catch (error) { if (error !== rollback) throw error; }
}
async function tables(db) { return (await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename); }
async function rows(db, names) {
  return db.$queryRawUnsafe(names.map(name => `SELECT '${name}' AS name,count(*)::text AS rows,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM public.${identifier(name)} t`).join(" UNION ALL ") + " ORDER BY name");
}
async function migrations(db) { return db.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name'); }
async function sequences(db) {
  const names = (await db.$queryRawUnsafe("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).map(row => row.sequencename);
  return names.length ? db.$queryRawUnsafe(names.map(name => `SELECT '${name}' AS name,last_value::text,is_called FROM public.${identifier(name)}`).join(" UNION ALL ") + " ORDER BY name") : [];
}
async function schema(db) {
  const [row] = await db.$queryRawUnsafe(`SELECT jsonb_build_object(
    'columns',(SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name,ordinal_position) FROM (SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name,character_maximum_length,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public')x),
    'constraints',(SELECT jsonb_agg(to_jsonb(x) ORDER BY relation,name) FROM (SELECT c.relname AS relation,k.conname AS name,k.contype AS type,k.condeferrable AS deferrable,k.condeferred AS deferred,k.convalidated AS validated,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')x),
    'indexes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY tablename,indexname) FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public')x),
    'functions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY name,arguments) FROM (SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,p.provolatile AS volatility,p.proisstrict AS strict,p.prosecdef AS security_definer,p.proconfig AS configuration,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f')x),
    'triggers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY relation,name) FROM (SELECT c.relname AS relation,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)x),
    'enums',(SELECT jsonb_agg(to_jsonb(x) ORDER BY name,enumsortorder) FROM (SELECT t.typname AS name,e.enumsortorder,e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')x)) AS value`);
  return row.value;
}
async function compareSchemas(db, before, restored) {
  for (const category of ["columns", "indexes", "functions", "triggers"]) assert.deepEqual(restored[category], before[category], `${category} changed on restore`);
  const orderedEnums = values => Object.fromEntries([...new Set(values.map(row => row.name))].map(name => [name, values.filter(row => row.name === name).sort((a, b) => a.enumsortorder - b.enumsortorder).map(row => row.enumlabel)]));
  assert.deepEqual(orderedEnums(restored.enums), orderedEnums(before.enums), "Enum labels/order changed");
  assert.equal(restored.constraints.length, before.constraints.length);
  const reparsedChecks = [];
  for (let index = 0; index < before.constraints.length; index++) {
    const a = before.constraints[index], b = restored.constraints[index];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const { definition: sourceDefinition, ...sourceIdentity } = a, { definition: restoredDefinition, ...restoredIdentity } = b;
    assert.deepEqual(restoredIdentity, sourceIdentity); assert.equal(a.type, "c", "Only CHECK deparser changes may be reparsed");
    for (const value of [sourceDefinition, restoredDefinition]) assert.match(value, /^CHECK \([\s\S]*\)(?: NOT VALID)?$/);
    let canonical;
    await transactionRolledBack(db, async tx => {
      await tx.$queryRawUnsafe("SELECT set_config('search_path','pg_catalog, public, pg_temp',true)");
      const table = `rr07k_check_${index}`;
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${identifier(table)} (LIKE public.${identifier(a.relation)}) ON COMMIT DROP`);
      await tx.$executeRawUnsafe(`ALTER TABLE pg_temp.${identifier(table)} ADD CONSTRAINT restore_source ${sourceDefinition}`);
      await tx.$executeRawUnsafe(`ALTER TABLE pg_temp.${identifier(table)} ADD CONSTRAINT restore_target ${restoredDefinition}`);
      const definitions = await tx.$queryRawUnsafe("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname IN ('restore_source','restore_target') ORDER BY conname", `pg_temp.${identifier(table)}`);
      assert.equal(definitions.length, 2); assert.equal(definitions[0].definition, definitions[1].definition, `Changed CHECK semantics: ${a.name}`); canonical = definitions[0].definition;
    });
    reparsedChecks.push({ relation: a.relation, name: a.name, sourceHash: hash(sourceDefinition), restoredHash: hash(restoredDefinition), canonicalHash: hash(canonical) });
  }
  return { rawSchemaEqual: JSON.stringify(before) === JSON.stringify(restored), semanticSchemaEqual: true, reparsedChecks, enumOrderEqual: true };
}

async function fixture(db) {
  const prefix = `rr07k_${randomUUID().replaceAll("-", "")}`;
  return db.$transaction(async tx => {
    const org = await tx.organisation.create({ data: { name: "Synthetic restore merchant", slug: prefix } });
    const user = await tx.user.create({ data: { email: `${prefix}@example.invalid`, passwordHash: "synthetic-not-a-password", role: "OWNER" } });
    const member = await tx.organisationMember.create({ data: { organisationId: org.id, userId: user.id, role: "OWNER" } });
    const shop = await tx.location.create({ data: { organisationId: org.id, name: "Synthetic shop", slug: "restore-shop", status: "ACTIVE" } });
    const program = await tx.rewardProgram.create({ data: { organisationId: org.id, status: "DISABLED" } });
    const staff = await tx.rewardStaffGrant.create({ data: { organisationId: org.id, organisationMemberId: member.id, scope: "LOCATIONS", locationId: shop.id, capabilities: ["REDEEM"], startsAt: NOW, expiresAt: END } });
    const snapshot = { scope: "LOCATIONS", organisationMemberId: member.id, locationId: shop.id, capabilities: ["REDEEM"], startsAt: NOW.toISOString(), expiresAt: END.toISOString(), revokedAt: null };
    const metadata = { after: snapshot, reasonCode: "MANUAL_INTERNAL", version: 1, revision: 1 };
    await tx.rewardAuditEvent.create({ data: { organisationId: org.id, actorUserId: user.id, actorOrganisationMemberId: member.id, action: "STAFF_GRANT_CREATED", targetType: "STAFF_GRANT", targetId: staff.id, metadata } });
    const media = await tx.mediaAsset.create({ data: { organisationId: org.id, name: "Synthetic metadata only", originalName: "no-audio.wav", storageKey: `synthetic/${prefix}`, mimeType: "audio/wav", sizeBytes: 0n, mediaType: "COMMERCIAL" } });
    const promo = await tx.promoAsset.create({ data: { organisationId: org.id, name: "Synthetic promo", mediaType: "COMMERCIAL" } });
    const version = await tx.promoVersion.create({ data: { promoAssetId: promo.id, mediaAssetId: media.id, version: 1 } });
    const campaign = await tx.campaign.create({ data: { organisationId: org.id, promoVersionId: version.id, name: "Synthetic campaign", schedulingMode: "INTERVAL", effectiveFrom: NOW, effectiveTo: END } });
    const terms = { schemaVersion: 1, title: "Synthetic coupon", description: "Restore regression only", category: "HOME", type: "PERCENT_OFF", percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null, currency: "EUR", minimumSpendMinor: 5000, exclusions: "None", legalTerms: "Synthetic", combinable: false, startsAt: NOW.toISOString(), endsAt: END.toISOString(), timezone: "Europe/Malta", locationIds: [shop.id], usage: "REUSABLE", totalLimit: 20, perShopperLimit: 2, perShopperDailyLimit: 2, pausedClaimsPolicy: "HONOUR_ISSUED" };
    const offer = await tx.rewardOffer.create({ data: { organisationId: org.id, programId: program.id, draft: terms, createdByUserId: user.id, updatedByUserId: user.id } });
    const campaignSnapshot = { schemaVersion: 1, campaignName: "Synthetic campaign", promoName: "Synthetic promo", publishedAt: NOW.toISOString(), startsOn: "2026-11-15", endsOn: "2027-11-15", locationIds: [shop.id] };
    const campaignHash = randomBytes(32).toString("hex");
    await tx.rewardOfferCampaignDraft.create({ data: { offerId: offer.id, organisationId: org.id, campaignId: campaign.id, campaignPublicationRevision: 1, campaignConfigurationHash: campaignHash, selectedByUserId: user.id } });
    await tx.rewardOfferRevision.create({ data: { organisationId: org.id, offerId: offer.id, revision: 1, terms, actorUserId: user.id } });
    await tx.rewardOfferCampaignRevision.create({ data: { offerId: offer.id, revision: 1, organisationId: org.id, campaignId: campaign.id, campaignPublicationRevision: 1, campaignConfigurationHash: campaignHash, snapshot: campaignSnapshot, actorUserId: user.id } });
    await tx.rewardOfferUsagePolicy.create({ data: { offerId: offer.id, organisationId: org.id, timezone: "Europe/Malta" } });
    const shopper = await tx.rewardShopper.create({ data: { displayName: "Synthetic restore shopper", status: "DISABLED" } });
    for (let use = 0; use < 2; use++) {
      const claim = await tx.rewardClaim.create({ data: { organisationId: org.id, offerId: offer.id, revision: 1, shopperId: shopper.id, shopperAuthVersion: 1, locationId: shop.id, publicShopName: "Synthetic shop", publicShopSlug: "restore-shop", createdAt: NOW, expiresAt: new Date(NOW.getTime() + 3600000) } });
      await tx.rewardRedemption.create({ data: { organisationId: org.id, offerId: offer.id, shopperId: shopper.id, locationId: shop.id, claimId: claim.id, actorUserId: user.id, actorOrganisationMemberId: member.id, idempotencyKeyHash: randomBytes(32).toString("hex"), requestHash: randomBytes(32).toString("hex"), eligibleSpendMinor: 6000, currency: "EUR", discountMinor: 600, occurredAt: new Date(NOW.getTime() + use * 1000) } });
    }
    return { org: org.id, user: user.id, member: member.id, staff: staff.id, offer: offer.id, shop: shop.id, snapshot, metadata, campaignSnapshot };
  }, { timeout: 60000 });
}
async function validators(db, values, searchPath, shadow = false) {
  let result;
  await transactionRolledBack(db, async tx => {
    if (shadow) {
      await tx.$executeRawUnsafe("CREATE SCHEMA rr07k_shadow");
      await tx.$executeRawUnsafe("CREATE TYPE rr07k_shadow.\"RewardAction\" AS ENUM ('EVIL')");
      await tx.$executeRawUnsafe("CREATE FUNCTION rr07k_shadow.ruvanas_rewards_identifier_valid(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'");
      await tx.$executeRawUnsafe("CREATE FUNCTION rr07k_shadow.ruvanas_rewards_capabilities_valid(rr07k_shadow.\"RewardAction\"[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'");
      await tx.$executeRawUnsafe("CREATE FUNCTION rr07k_shadow.ruvanas_rewards_audit_snapshot_valid(jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'");
    }
    await tx.$queryRawUnsafe("SELECT pg_catalog.set_config('search_path',$1,true)", searchPath);
    const query = async (name, value) => (await tx.$queryRawUnsafe(`SELECT public.${identifier(name)}($1::jsonb) AS valid`, JSON.stringify(value)))[0].valid;
    const invalidSnapshot = { ...values.snapshot, organisationMemberId: "../outside", capabilities: ["EVIL"] };
    result = {
      snapshot: await query("ruvanas_rewards_audit_snapshot_valid", values.snapshot), metadata: await query("ruvanas_rewards_audit_metadata_valid", values.metadata),
      campaign: await query("ruvanas_rewards_campaign_snapshot_valid", values.campaignSnapshot),
      invalidSnapshot: await query("ruvanas_rewards_audit_snapshot_valid", invalidSnapshot), invalidMetadata: await query("ruvanas_rewards_audit_metadata_valid", { after: invalidSnapshot }),
      invalidCampaign: await query("ruvanas_rewards_campaign_snapshot_valid", { ...values.campaignSnapshot, locationIds: ["../outside"] }),
      extraMetadata: await query("ruvanas_rewards_audit_metadata_valid", { secret: "not-permitted" }),
      malformedCampaign: await query("ruvanas_rewards_campaign_snapshot_valid", { ...values.campaignSnapshot, startsOn: "2026-02-30" })
    };
  });
  return result;
}
async function immutableChecks(db) {
  for (const table of ["RewardAuditEvent", "RewardClaim", "RewardRedemption", "RewardOfferRevision", "RewardOfferCampaignRevision"]) {
    await transactionRolledBack(db, async tx => {
      await tx.$executeRawUnsafe("SAVEPOINT immutable_check"); let failure;
      try { await tx.$executeRawUnsafe(`DELETE FROM public.${identifier(table)}`); } catch (error) { failure = error; }
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT immutable_check");
      assert.equal(failure?.meta?.code, "55000", `${table} lost immutable protection`);
    });
  }
}

test("Rewards populated upgrade survives an unmodified logical backup and restore", { skip: !requested, timeout: 600000 }, async t => {
  const { db, target } = await openRestoreDatabase(process.env); let restored, privateDirectory, complete = false;
  const report = { candidateFix: FIX, localOnly: target.mode === "LOCAL", rewardsEnabled: false, publicRegistrationChanged: false, encodersStarted: 0, standardRestore: true, checks: [], complete: false };
  const passed = name => { report.checks.push({ name, passed: true }); t.diagnostic(name); };
  const writeReport = () => writeFileSync(path.join(target.artifacts, "restore-result.json"), JSON.stringify(report, null, 2) + "\n");
  try {
    mkdirSync(target.artifacts, { recursive: true }); assert.ok(samePath(realpathSync(target.artifacts), target.artifacts)); assert.equal(lstatSync(target.artifacts).isSymbolicLink(), false);
    privateDirectory = mkdtempSync(path.join(target.artifacts, "private-")); assert.ok(samePath(realpathSync(privateDirectory), privateDirectory));
    for (const name of ["empty.pgpass", "empty.pg_service.conf"]) writeFileSync(path.join(privateDirectory, name), "");
    const env = commandEnv(target, privateDirectory), executable = name => path.join(target.binaries, `${name}${target.platform === "win32" ? ".exe" : ""}`);
    for (const name of ["pg_dump", "pg_restore", "createdb"]) assert.ok(existsSync(executable(name)));
    assert.equal((await tables(db)).length, 0, "The source must start with an empty public schema");
    assert.equal((await db.$queryRawUnsafe("SELECT count(*)::int AS count FROM pg_database WHERE datname=$1", RESTORED_DB))[0].count, 0, "Never reuse or overwrite an existing restore database");
    const originalMigrations = readdirSync(path.join(ROOT, "prisma/migrations"), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    const fixIndex = originalMigrations.indexOf(FIX);
    assert.equal(fixIndex, 141, "The reviewed historical restore fix must retain its original position");
    const baselineMigrations = originalMigrations.slice(0, fixIndex);
    const oldMigrationFiles = Object.fromEntries(baselineMigrations.map(name => [name, hash(readFileSync(path.join(ROOT, "prisma/migrations", name, "migration.sql")))]));
    const baseline = path.join(privateDirectory, "baseline"); mkdirSync(path.join(baseline, "migrations"), { recursive: true });
    copyFileSync(path.join(ROOT, "prisma/schema.prisma"), path.join(baseline, "schema.prisma"));
    copyFileSync(path.join(ROOT, "prisma/migrations/migration_lock.toml"), path.join(baseline, "migrations/migration_lock.toml"));
    for (const name of baselineMigrations) { mkdirSync(path.join(baseline, "migrations", name)); copyFileSync(path.join(ROOT, "prisma/migrations", name, "migration.sql"), path.join(baseline, "migrations", name, "migration.sql")); }
    const prisma = path.join(ROOT, "node_modules/prisma/build/index.js");
    await run(process.execPath, [prisma, "migrate", "deploy", "--schema", path.join(baseline, "schema.prisma")], env, path.join(target.artifacts, "baseline-migrate.log"), 300000);
    const beforeMigrations = await migrations(db); assert.equal(beforeMigrations.length, 141); assert.ok(beforeMigrations.every(row => row.finished_at && !row.rolled_back_at));
    const f = await fixture(db), baselineNames = await tables(db), beforeRows = await rows(db, baselineNames), beforeFunctions = await db.$queryRawUnsafe("SELECT oid::text,proname,provolatile,proisstrict,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY proname");
    const baselineValidation = await validators(db, f, "");
    assert.equal(baselineValidation.snapshot, false); assert.equal(baselineValidation.metadata, false); assert.equal(baselineValidation.campaign, false);
    report.baselineValidation = baselineValidation; passed("populated baseline reproduces empty-search-path validation failure");
    // Exercise the historical fix alone before replaying any later migrations.
    mkdirSync(path.join(baseline, "migrations", FIX));
    copyFileSync(path.join(ROOT, "prisma/migrations", FIX, "migration.sql"), path.join(baseline, "migrations", FIX, "migration.sql"));
    await run(process.execPath, [prisma, "migrate", "deploy", "--schema", path.join(baseline, "schema.prisma")], env, path.join(target.artifacts, "candidate-migrate.log"), 300000);
    const fixedMigrations = await migrations(db); assert.equal(fixedMigrations.length, 142); assert.deepEqual(fixedMigrations.slice(0, -1), beforeMigrations); assert.equal(fixedMigrations.at(-1).migration_name, FIX); assert.ok(fixedMigrations.at(-1).finished_at && !fixedMigrations.at(-1).rolled_back_at);
    assert.deepEqual(await db.$queryRawUnsafe("SELECT oid::text,proname,provolatile,proisstrict,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY proname"), beforeFunctions, "Function identity or security/validation attributes changed");
    assert.deepEqual((await rows(db, baselineNames)).filter(row => row.name !== "_prisma_migrations"), beforeRows.filter(row => row.name !== "_prisma_migrations"));
    for (const [name, digest] of Object.entries(oldMigrationFiles)) assert.equal(hash(readFileSync(path.join(ROOT, "prisma/migrations", name, "migration.sql"))), digest);
    passed("forward migration preserves populated history, all business rows and existing migration checksums");
    const expected = { snapshot: true, metadata: true, campaign: true, invalidSnapshot: false, invalidMetadata: false, invalidCampaign: false, extraMetadata: false, malformedCampaign: false };
    assert.deepEqual(await validators(db, f, ""), expected); assert.deepEqual(await validators(db, f, "rr07k_shadow, pg_catalog, public", true), expected);
    await immutableChecks(db); passed("valid metadata works with empty or hostile search paths; invalid metadata and immutable writes stay rejected");
    await run(process.execPath, [prisma, "migrate", "deploy", "--schema", path.join(ROOT, "prisma/schema.prisma")], env, path.join(target.artifacts, "current-migrate.log"), 300000);
    const afterMigrations = await migrations(db), names = await tables(db);
    assert.equal(afterMigrations.length, originalMigrations.length);
    assert.deepEqual(afterMigrations.slice(0, fixedMigrations.length), fixedMigrations);
    assert.ok(afterMigrations.every(row => row.finished_at && !row.rolled_back_at));
    // Populate the newest additive table only after the historical restore-fix
    // regression has completed. Preparation must survive a standard restore
    // without gaining credentials, membership, invitation or session access.
    const dormantShopper = await db.rewardShopper.create({ data: {
      displayName: "Synthetic dormant restore shopper", status: "DISABLED", authVersion: 1
    } });
    const dormantSetup = await db.rewardShopperSetup.create({ data: {
      shopperId: dormantShopper.id, emailCanonical: `restore-dormant-${randomUUID()}@example.invalid`,
      organisationId: f.org, createdByUserId: f.user, createdAt: NOW
    } });
    const sourceRows = await rows(db, names), sourceSchema = await schema(db), sourceSequences = await sequences(db);
    const archive = path.join(privateDirectory, "synthetic.dump"), connection = ["-h", "127.0.0.1", "-p", target.url.port, "-U", target.url.username];
    await run(executable("pg_dump"), [...connection, "-d", SOURCE_DB, "--format=custom", "--no-owner", "--no-privileges", "--file", archive], env, path.join(target.artifacts, "pg-dump.log"));
    await run(executable("createdb"), [...connection, RESTORED_DB], env, path.join(target.artifacts, "createdb.log"));
    const { PrismaClient } = await import("@prisma/client"), restoreUrl = new URL(target.url); restoreUrl.pathname = `/${RESTORED_DB}`;
    restored = new PrismaClient({ datasourceUrl: restoreUrl.href }); await identity(restored, target, RESTORED_DB); assert.equal((await tables(restored)).length, 0);
    // The archive is passed directly to pg_restore: no SQL/header rewrite,
    // search_path override, disabled triggers or weakened constraints.
    await run(executable("pg_restore"), [...connection, "-d", RESTORED_DB, "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", archive], env, path.join(target.artifacts, "pg-restore.log"));
    assert.deepEqual(await tables(restored), names); assert.deepEqual(await rows(restored, names), sourceRows); assert.deepEqual(await migrations(restored), afterMigrations); assert.deepEqual(await sequences(restored), sourceSequences);
    report.schema = await compareSchemas(restored, sourceSchema, await schema(restored));
    assert.deepEqual(await validators(restored, f, ""), expected); await immutableChecks(restored);
    const restoredDormant = await restored.rewardShopper.findUnique({ where: { id: dormantShopper.id }, include: {
      credential: true, invitation: true, membership: true, sessions: true, pilotEnrollment: true, claims: true
    } });
    assert.equal(restoredDormant.status, "DISABLED"); assert.equal(restoredDormant.authVersion, 1);
    assert.equal(restoredDormant.displayName, dormantShopper.displayName);
    for (const relation of ["credential", "invitation", "membership", "pilotEnrollment"]) assert.equal(restoredDormant[relation], null);
    assert.deepEqual(restoredDormant.sessions, []); assert.deepEqual(restoredDormant.claims, []);
    assert.deepEqual(await restored.rewardShopperSetup.findUnique({ where: { shopperId: dormantShopper.id } }), dormantSetup);
    assert.equal(await restored.user.count({ where: { email: dormantSetup.emailCanonical } }), 0);
    report.dormantShopper = { status: restoredDormant.status, authVersion: restoredDormant.authVersion,
      setupPreserved: true, provenancePreserved: true, credentials: 0, invitations: 0, memberships: 0, sessions: 0, pilotEnrollments: 0, claims: 0, businessIdentities: 0 };
    passed("populated dormant shopper and immutable setup provenance restore without granting any access");
    assert.deepEqual(await rows(db, names), sourceRows); assert.deepEqual(await rows(restored, names), sourceRows);
    report.tables = names.length; report.migrations = afterMigrations.length; report.rowsDigest = hash(sourceRows); report.migrationDigest = hash(afterMigrations); report.sequences = sourceSequences;
    report.preservedHistory = { audit: await restored.rewardAuditEvent.count(), campaignRevisions: await restored.rewardOfferCampaignRevision.count(), claims: await restored.rewardClaim.count(), receipts: await restored.rewardRedemption.count() };
    assert.ok(report.preservedHistory.audit > 0 && report.preservedHistory.campaignRevisions > 0); assert.equal(report.preservedHistory.claims, 2); assert.equal(report.preservedHistory.receipts, 2);
    passed("unmodified pg_dump/pg_restore preserves every table, migration, sequence and reviewed schema semantics"); complete = true;
  } catch (error) { report.error = { name: error.name, message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[OWNED_SYNTHETIC_DATABASE]").replace(/\b[a-f0-9]{64}\b/gi, "[HASH]") }; throw error; }
  finally {
    if (restored) await restored.$disconnect(); await db.$disconnect();
    if (privateDirectory) { assert.ok(samePath(path.dirname(privateDirectory), target.artifacts)); assert.match(path.basename(privateDirectory), /^private-[A-Za-z0-9]+$/); assert.ok(samePath(realpathSync(privateDirectory), privateDirectory)); rmSync(privateDirectory, { recursive: true }); }
    report.temporaryPrivateFilesRemoved = !privateDirectory || !existsSync(privateDirectory); report.complete = complete && report.temporaryPrivateFilesRemoved;
    report.finishedAtUtc = new Date().toISOString(); if (existsSync(target.artifacts)) writeReport();
  }
});
