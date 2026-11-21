import { z } from "zod";
import { runSerializableTransaction } from "../transaction-retry.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { collectPilotReadiness, evaluatePilotReadiness } from "./pilot-readiness.mjs";
import { authorizePilotPreparationSession, pilotPreparationIsClosed, PILOT_PREPARATION_SESSION_SELECT } from "./pilot-preparation-context.mjs";
import { pilotPreparationInputSchema, pilotPreparationSchema, pilotPreparationDenied } from "./pilot-preparation-contracts.mjs";

const finite = value => value instanceof Date && Number.isFinite(value.getTime());
const id = value => rewardIdSchema.safeParse(value).success;
const date = z.date().refine(finite);
const setupSchema = z.object({ shopperId: rewardIdSchema, organisationId: rewardIdSchema, createdByUserId: rewardIdSchema, createdAt: date,
  shopper: z.object({ id: rewardIdSchema, status: z.enum(["DISABLED", "ACTIVE", "SUSPENDED"]) }).strict() }).strict();
const setupSelect = { shopperId: true, organisationId: true, createdByUserId: true, createdAt: true,
  shopper: { select: { id: true, status: true } } };
class PreparationAbort extends Error { constructor(code) { super("Pilot preparation unavailable."); this.code = code; } }
const abort = code => { throw new PreparationAbort(code); };
function bounded(rows, max = 100) {
  if (!Array.isArray(rows)) abort("UNAVAILABLE");
  if (rows.length > max) abort("REVIEW_TOO_LARGE");
  return rows;
}

/** Read-only preparation for a durable, previously prepared internal trial.
 * No factory, mutation service or invitation/renewal operation is called here. */
export function createPilotPreparationService({ db, loadSession, env = {}, clock = () => new Date() } = {}) {
  function nowAt(earliest) {
    if (!pilotPreparationIsClosed(env)) abort("PREPARATION_UNAVAILABLE");
    const now = clock(); if (!finite(now) || earliest && now < earliest) abort("UNAVAILABLE"); return new Date(now);
  }
  async function authority(client, access, authMethod, earliest) {
    nowAt(earliest);
    const session = await client.session.findUnique({ where: { id: access.sessionId }, select: PILOT_PREPARATION_SESSION_SELECT });
    const again = authorizePilotPreparationSession(session, nowAt(earliest), env);
    if (!again.ok) abort(again.code);
    if (again.sessionId !== access.sessionId || again.userId !== access.userId || session.authMethod !== authMethod) abort("FORBIDDEN");
    if (session.user.privatePreviewAccess === undefined) abort("UNAVAILABLE");
  }
  async function lockAuthority(tx, access) {
    const users = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${access.userId} FOR SHARE`;
    const sessions = await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${access.sessionId} AND "userId" = ${access.userId} FOR SHARE`;
    if (users.length !== 1 || users[0].id !== access.userId || sessions.length !== 1 || sessions[0].id !== access.sessionId) abort("AUTH_REQUIRED");
    await tx.$queryRaw`SELECT "userId" FROM "PrivatePreviewAccess" WHERE "userId" = ${access.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT p."id" FROM "EnterpriseSecurityPolicy" p JOIN "Session" s ON s."activeOrganisationId" = p."organisationId"
      WHERE s."id" = ${access.sessionId} FOR SHARE OF p`;
  }
  async function scope(tx, organisationId, now) {
    const organisation = await tx.organisation.findUnique({ where: { id: organisationId }, select: { id: true, name: true,
      subscription: { include: { plan: true, billingContract: true } } } });
    const sub = organisation?.subscription;
    if (!organisation || organisation.id !== organisationId || !id(sub?.id) || sub.organisationId !== organisationId ||
        sub.status !== "TRIAL" || sub.plan?.productFamily !== "RETAIL") abort("PREPARATION_UNAVAILABLE");
    const state = await createRewardsDatabaseAdapter(tx).loadRewardsState({ organisationId, subscriptionId: sub.id });
    if (!state.grant || state.grant.status !== "TRIAL" || state.grant.source !== "MANUAL_INTERNAL" || !state.program) abort("PREPARATION_UNAVAILABLE");
    const origins = bounded(await tx.auditLog.findMany({ where: { organisationId, action: "ORDINARY_OWNER_ORGANISATION_CREATED",
      entityType: "Organisation", entityId: organisationId }, take: 2, select: { actorUserId: true, details: true } }), 1);
    if (origins.length !== 1 || !id(origins[0].actorUserId) || origins[0].details?.ownerRole !== "OWNER" ||
        origins[0].details.subscriptionStatus !== "TRIAL" || origins[0].details.planId !== sub.plan.id || !id(origins[0].details.ownerUserId)) abort("PREPARATION_UNAVAILABLE");
    const rawSetups = bounded(await tx.rewardShopperSetup.findMany({ where: { organisationId }, orderBy: { shopperId: "asc" }, take: 101, select: setupSelect }));
    if (!rawSetups.length) abort("PREPARATION_UNAVAILABLE");
    const setups = rawSetups.map(row => { const parsed = setupSchema.safeParse(row); if (!parsed.success) abort("UNAVAILABLE"); return parsed.data; });
    if (new Set(setups.map(row => row.shopperId)).size !== setups.length || setups.some(row =>
      row.organisationId !== organisationId || row.shopper.id !== row.shopperId || row.createdAt > now)) abort("PREPARATION_UNAVAILABLE");
    const provenance = bounded(await tx.auditLog.findMany({ where: { organisationId, action: "DORMANT_SHOPPER_PREPARED", entityType: "RewardShopper",
      entityId: { in: setups.map(row => row.shopperId) } }, take: 101, select: { entityId: true, actorUserId: true, details: true } }));
    if (provenance.length !== setups.length || new Set(provenance.map(row => row.entityId)).size !== provenance.length || setups.some(setup => {
      const origin = provenance.find(row => row.entityId === setup.shopperId);
      return !origin || origin.actorUserId !== setup.createdByUserId || origin.details?.shopperId !== setup.shopperId ||
        origin.details.status !== "DISABLED" || origin.details.accessGranted !== false;
    })) abort("PREPARATION_UNAVAILABLE");
    const program = await tx.rewardProgram.findUnique({ where: { organisationId }, select: { id: true, organisationId: true, status: true, timezone: true, networkOptIn: true } });
    if (program?.id !== state.program.id || program.organisationId !== organisationId) abort("UNAVAILABLE");
    return { state: { ...state, organisation, subscription: sub, program }, setups };
  }
  return Object.freeze({ async inspect(input) {
    try {
      const parsed = pilotPreparationInputSchema.safeParse(input);
      if (!parsed.success) return pilotPreparationDenied("INVALID_REQUEST");
      const started = nowAt(); if (typeof loadSession !== "function") abort("AUTH_REQUIRED");
      const session = await loadSession(), access = authorizePilotPreparationSession(session, nowAt(started), env);
      if (!access.ok) return access;
      await authority(db, access, session.authMethod, started);
      return await runSerializableTransaction(db, async tx => {
        await lockAuthority(tx, access); await authority(tx, access, session.authMethod, started);
        const organisationId = parsed.data.organisationId, { state, setups } = await scope(tx, organisationId, nowAt(started));
        const snapshot = await collectPilotReadiness(tx, organisationId, abort);
        if (snapshot.enrollments.some(row => !setups.some(setup => setup.shopperId === row.shopperId))) abort("PREPARATION_UNAVAILABLE");
        // A prepared identity must not acquire an enrollment in a different
        // tenant; only origin identifiers, never foreign business data, are read.
        const origins = bounded(await tx.rewardPilotShopperEnrollment.findMany({ where: { shopperId: { in: setups.map(row => row.shopperId) } },
          take: 101, select: { shopperId: true, organisationId: true } }));
        if (origins.some(row => row.organisationId !== organisationId || !setups.some(setup => setup.shopperId === row.shopperId)) ||
          new Set(origins.map(row => row.shopperId)).size !== origins.length || origins.length !== snapshot.enrollments.length) abort("PREPARATION_UNAVAILABLE");
        await authority(tx, access, session.authMethod, started); const checkedAt = nowAt(started);
        const readiness = evaluatePilotReadiness({ organisationId, state, ...snapshot, env, now: checkedAt, abort });
        const preparedShoppers = { total: setups.length, disabled: 0, active: 0, suspended: 0, enrolled: snapshot.enrollments.length,
          expiredMemberships: 0, revokedInvitations: 0 };
        for (const setup of setups) preparedShoppers[setup.shopper.status.toLowerCase()]++;
        for (const row of snapshot.enrollments) {
          const setup = setups.find(value => value.shopperId === row.shopperId);
          if (row.shopper.status !== setup.shopper.status) abort("UNAVAILABLE");
          if (row.shopper.membership && row.shopper.membership.expiresAt <= checkedAt) preparedShoppers.expiredMemberships++;
          if (row.shopper.invitation?.revokedAt) preparedShoppers.revokedInvitations++;
        }
        const result = pilotPreparationSchema.safeParse({ ok: true, mode: "READ_ONLY_PREPARATION", rewardsEnabled: false,
          organisation: { id: state.organisation.id, name: state.organisation.name }, readiness, preparedShoppers,
          grantExpiresAt: state.grant.expiresAt.toISOString(), checkedAt: checkedAt.toISOString(), endToEndTest: "NOT_VERIFIED" });
        if (!result.success) abort("UNAVAILABLE"); return result.data;
      });
    } catch (error) { return pilotPreparationDenied(error instanceof PreparationAbort ? error.code : "UNAVAILABLE"); }
  } });
}
