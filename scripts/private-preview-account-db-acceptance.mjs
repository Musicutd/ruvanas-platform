import { randomBytes } from "node:crypto";
import {
  authenticatePreviewPassword, createPreviewTester, establishPreviewOwnerPassword, updatePreviewTester
} from "../lib/private-preview-accounts.mjs";
import { issuePrivatePreviewCode, redeemPrivatePreviewCode } from "../lib/private-preview-codes.mjs";
import { getSessionFromToken, hashSessionToken } from "../lib/session-lookup.js";
import { readPrivatePreviewPolicy } from "../lib/private-preview-policy.mjs";
import { privatePreviewTesterRequestAllowed } from "../lib/private-preview-tester-policy.mjs";

function check(condition) { if (!condition) throw new Error("DATABASE_ACCEPTANCE_FAILED"); }

async function denied(operation, code) {
  try { await operation(); } catch (error) { check(error?.code === code); return; }
  throw new Error("DATABASE_ACCEPTANCE_FAILED");
}

// Called only after the exact-host/history migration guard. All account,
// tenant, session and audit fixtures live inside one deliberately rolled-back
// transaction. No existing owner's password or supplier/media record is read
// or changed, and no credentials or fixture identities are returned or logged.
export async function runPreviewAccountDatabaseAcceptance(database, { env = process.env } = {}) {
  const configured = readPrivatePreviewPolicy(env);
  let databaseUrl;
  try { databaseUrl = new URL(env.DATABASE_URL); } catch { /* Refused below without connection. */ }
  if (env.RUVANAS_ENVIRONMENT !== "PRIVATE_PREVIEW" || env.RENDER_SERVICE_ID !== "srv-da03b5lbedkc739q74k0" ||
      env.RUVANAS_PUBLIC_URL !== "https://ruvanas-platform.onrender.com" || !configured.enabled || !configured.valid ||
      !databaseUrl || !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
      databaseUrl.hostname !== "dpg-db5kurijnfac73arripg-a" ||
      databaseUrl.pathname !== "/ruvanas_private_preview_20261011" ||
      (env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST !== undefined &&
       env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_HOST !== "dpg-db5kurijnfac73arripg-a") ||
      (env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME !== undefined &&
       env.RUVANAS_PRIVATE_PREVIEW_EXPECTED_DB_NAME !== "ruvanas_private_preview_20261011")) {
    return { ok: false, code: "DATABASE_ACCEPTANCE_SCOPE_REFUSED" };
  }
  const tag = randomBytes(16).toString("hex");
  const emails = [`preview-qa-owner-${tag}@example.invalid`, `preview-qa-password-${tag}@example.invalid`,
    `preview-qa-code-${tag}@example.invalid`];
  const userIds = [];
  const organisationIds = [];
  const rollback = new Error("CONTROLLED_PREVIEW_ACCEPTANCE_ROLLBACK");
  let rolledBack = false;
  let successful = false;
  try {
    await database.$transaction(async (tx) => {
      const identity = await tx.$queryRaw`SELECT current_database() AS "databaseName", current_schema() AS "schemaName"`;
      check(identity.length === 1 && identity[0].databaseName === "ruvanas_private_preview_20261011" &&
        identity[0].schemaName === "public");
      check(await tx.user.count({ where: { email: { in: emails } } }) === 0);
      const now = new Date();
      const password = `PreviewQa-${randomBytes(24).toString("base64url")}`;
      const secret = randomBytes(48).toString("hex");
      const fixtureEnv = { ...env, RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: emails[0],
        RUVANAS_PRIVATE_PREVIEW_ALLOWED_EMAILS: emails[0] };
      const policy = readPrivatePreviewPolicy(fixtureEnv);
      check(policy.valid);
      const facade = new Proxy(tx, { get(target, property) {
        return property === "$transaction" ? (operation) => operation(target) : Reflect.get(target, property);
      } });
      const owner = await tx.user.create({ data: {
        email: emails[0], name: "Rollback acceptance owner", role: "SUPER_ADMIN",
        passwordHash: "unusable-rollback-fixture-bootstrap-hash"
      }, select: { id: true } });
      userIds.push(owner.id);
      const bootstrap = await tx.session.create({ data: {
        userId: owner.id, tokenHash: hashSessionToken(randomBytes(32).toString("hex"), secret),
        authMethod: "PREVIEW_CODE", expiresAt: new Date(now.getTime() + 60_000), createdAt: now, lastSeenAt: now
      } });
      const ownerEstablished = await establishPreviewOwnerPassword(facade, {
        actorUserId: owner.id, sessionId: bootstrap.id, policy, password, secret, now
      });
      check(ownerEstablished.user.role === "SUPER_ADMIN" && ownerEstablished.activeOrganisationId === null);
      check((await tx.session.findUnique({ where: { id: bootstrap.id } })).revokedAt !== null);
      const ownerLogin = await authenticatePreviewPassword(facade, { policy, email: emails[0], password, secret, now });
      check((await getSessionFromToken(ownerLogin.rawSessionToken, { db: facade, secret, now, env: fixtureEnv }))?.userId === owner.id);

      const passwordTester = await createPreviewTester(facade, { actorUserId: owner.id, policy,
        email: emails[1], name: "Rollback password tester", password, pillars: ["SCHOOL", "HEALTH"], now });
      userIds.push(passwordTester.id);
      const codeTester = await createPreviewTester(facade, { actorUserId: owner.id, policy,
        email: emails[2], name: "Rollback code tester", pillars: ["CORRECTIONS"], now });
      userIds.push(codeTester.id);
      check(passwordTester.passwordEnabled && !codeTester.passwordEnabled);
      const grants = await tx.privatePreviewAccess.findMany({ where: { userId: { in: [passwordTester.id, codeTester.id] } } });
      organisationIds.push(...grants.map((grant) => grant.organisationId));
      check(organisationIds.length === 2 && new Set(organisationIds).size === 2 && organisationIds.every(Boolean));
      for (const organisationId of organisationIds) {
        check(await tx.organisationMember.count({ where: { organisationId } }) === 1);
        const subscription = await tx.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
        check(subscription.plan.monthlyPriceCents === 0 && subscription.plan.publiclyAvailable === false &&
          subscription.plan.licensedMusicCatalogueLevel === "NONE" && !subscription.plan.includesRuvanasCatalogue &&
          subscription.schoolPublicPublishingEnabled === false && subscription.billingContract === null);
      }
      const login = await authenticatePreviewPassword(facade, { policy, email: emails[1], password, secret, now });
      const session = await getSessionFromToken(login.rawSessionToken, { db: facade, secret, now, env: fixtureEnv });
      check(session?.user.role === "OWNER" && session.activeOrganisationId === grants.find((grant) => grant.userId === passwordTester.id).organisationId);
      for (const path of ["/dashboard/school", "/dashboard/health"]) {
        check(privatePreviewTesterRequestAllowed({ session, pathname: path, method: "GET", now }));
      }
      for (const path of ["/admin", "/api/admin/private-preview/codes", "/dashboard/radio", "/dashboard/corrections", "/api/billing/checkout"]) {
        check(!privatePreviewTesterRequestAllowed({ session, pathname: path, method: "GET", now }));
      }
      check(!privatePreviewTesterRequestAllowed({ session, pathname: "/api/locations", method: "POST", now }));
      await denied(() => authenticatePreviewPassword(facade, { policy, email: emails[1], password: "wrong-password", secret, now }), "INVALID_CREDENTIALS");
      await denied(() => authenticatePreviewPassword(facade, { policy, email: emails[2], password, secret, now }), "INVALID_CREDENTIALS");
      await denied(() => issuePrivatePreviewCode(facade, { actorUserId: owner.id, targetUserId: owner.id, policy, secret, now }), "TARGET_UNAVAILABLE");

      const code = await issuePrivatePreviewCode(facade, { actorUserId: owner.id, targetUserId: codeTester.id, policy, secret, now });
      const redeemed = await redeemPrivatePreviewCode(facade, { code: code.code, policy, secret, now });
      const codeSession = await getSessionFromToken(redeemed.rawSessionToken, { db: facade, secret, now, env: fixtureEnv });
      check(codeSession?.authMethod === "PREVIEW_CODE" && codeSession.userId === codeTester.id);
      check(privatePreviewTesterRequestAllowed({ session: codeSession, pathname: "/dashboard/corrections", method: "GET", now }));
      check(!privatePreviewTesterRequestAllowed({ session: codeSession, pathname: "/dashboard/school", method: "GET", now }));
      await denied(() => redeemPrivatePreviewCode(facade, { code: code.code, policy, secret, now }), "INVALID_CODE");

      const secondCode = await issuePrivatePreviewCode(facade, { actorUserId: owner.id, targetUserId: passwordTester.id, policy, secret, now });
      const secondCodeSession = await redeemPrivatePreviewCode(facade, { code: secondCode.code, policy, secret, now });
      await updatePreviewTester(facade, { actorUserId: owner.id, policy, userId: passwordTester.id,
        enabled: false, pillars: ["SCHOOL", "HEALTH"], now });
      for (const rawToken of [login.rawSessionToken, secondCodeSession.rawSessionToken]) {
        check(await getSessionFromToken(rawToken, { db: facade, secret, now, env: fixtureEnv }) === null);
      }
      await denied(() => authenticatePreviewPassword(facade, { policy, email: emails[1], password, secret, now }), "INVALID_CREDENTIALS");
      await updatePreviewTester(facade, { actorUserId: owner.id, policy, userId: codeTester.id,
        enabled: true, pillars: ["CORRECTIONS"], password, now });
      check(await getSessionFromToken(redeemed.rawSessionToken, { db: facade, secret, now, env: fixtureEnv }) === null);
      check((await authenticatePreviewPassword(facade, { policy, email: emails[2], password, secret, now })).user.id === codeTester.id);
      successful = true;
      throw rollback;
    }, { isolationLevel: "Serializable", timeout: 60_000, maxWait: 10_000 });
  } catch (error) {
    rolledBack = error === rollback;
  }
  try {
    check(await database.user.count({ where: { email: { in: emails } } }) === 0);
    if (userIds.length) {
      check(await database.privatePreviewAccess.count({ where: { userId: { in: userIds } } }) === 0);
      check(await database.session.count({ where: { userId: { in: userIds } } }) === 0);
      check(await database.auditLog.count({ where: { actorUserId: { in: userIds } } }) === 0);
    }
    if (organisationIds.length) {
      check(await database.organisation.count({ where: { id: { in: organisationIds } } }) === 0);
      check(await database.subscription.count({ where: { organisationId: { in: organisationIds } } }) === 0);
    }
  } catch { return { ok: false, code: "DATABASE_ACCEPTANCE_ROLLBACK_UNVERIFIED" }; }
  return successful && rolledBack
    ? { ok: true, status: "ROLLED_BACK_PASS", checks: 16 }
    : { ok: false, code: "DATABASE_ACCEPTANCE_FAILED" };
}
