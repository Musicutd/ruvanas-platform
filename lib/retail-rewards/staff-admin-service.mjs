import { createHash, randomUUID } from "node:crypto";
import { ORGANISATION_MEMBER_ROLES } from "../permissions.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { rewardStaffGrantSchema } from "./contracts.mjs";
import { rewardsDenied } from "./errors.mjs";
import { readStaffAdminPolicy, staffAdminSchemas, STAFF_ADMIN_ROLE_CAPABILITIES } from "./staff-admin-contracts.mjs";
import { safeStaffAdminResult } from "./staff-admin-dtos.mjs";
import { runSerializableTransaction, isRetryableTransactionError } from "../transaction-retry.mjs";

const memberSelect = { id: true, organisationId: true, userId: true, role: true,
  user: { select: { id: true, name: true, role: true, privatePreviewAccess: { select: { userId: true } } } } };
const grantSelect = { id: true, organisationId: true, organisationMemberId: true, scope: true, locationId: true,
  capabilities: true, startsAt: true, expiresAt: true, revokedAt: true };
class StaffAbort extends Error { constructor(result) { super(result.code); this.result = result; } }
const abort = code => { throw new StaffAbort(rewardsDenied(code)); };
const allow = value => { if (!value?.ok) throw new StaffAbort(value || rewardsDenied("UNAVAILABLE")); return value; };
const sorted = values => [...new Set(values)].sort();
const sameIds = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const iso = value => { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) abort("UNAVAILABLE"); return value.toISOString(); };
const nowAt = clock => new Date(iso(clock()));
const eligible = member => Boolean(member && STAFF_ADMIN_ROLE_CAPABILITIES[member.role] && member.user?.id === member.userId &&
  member.user.privatePreviewAccess == null && ORGANISATION_MEMBER_ROLES.includes(member.user.role));
const sameActor = (a, b) => a.organisationId === b.organisationId && a.userId === b.userId && a.organisationMemberId === b.organisationMemberId &&
  a.authority.sessionId === b.authority.sessionId && a.authority.subscriptionId === b.authority.subscriptionId;
const presentGrant = row => ({ id: row.id, scope: row.scope, locationId: row.locationId,
  capabilities: sorted(row.capabilities), startsAt: iso(row.startsAt), expiresAt: iso(row.expiresAt), revokedAt: row.revokedAt === null ? null : iso(row.revokedAt) });
const auditSnapshot = row => { const { id: _id, ...snapshot } = presentGrant(row); return { organisationMemberId: row.organisationMemberId, ...snapshot }; };
const versionOf = (member, grants) => createHash("sha256").update(JSON.stringify({ memberId: member.id, role: member.role,
  grants: grants.map(presentGrant).sort((a, b) => a.id.localeCompare(b.id)) })).digest("hex");
// A role change does not release a reservation: restoring that role could make
// the existing grant usable again. Only expiry or explicit revocation frees it.
const usesSeat = (_member, grants, now) => grants.some(row => row.revokedAt === null && row.expiresAt > now);

/** Owner-only management of existing tenant members. No user, membership, role,
 * subscription, invitation, shopper, stream or plan writes occur here. */
export function createRewardStaffAdminService({ db, env = {}, loadContext, clock = () => new Date() } = {}) {
  const enabled = () => readStaffAdminPolicy(env).enabled;
  async function guard(client) {
    if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
    let context, state;
    const adapter = createRewardsDatabaseAdapter(client);
    const access = await requireRetailRewardsAccess({ action: "MANAGE_STAFF" }, { env, clock, ...adapter,
      loadContext: async () => { context = await loadContext(client); return context; },
      loadRewardsState: async input => { state = await adapter.loadRewardsState(input); return state; } });
    if (!access.ok) return access;
    if (context.membership.role !== "OWNER" || !ORGANISATION_MEMBER_ROLES.includes(context.user.role)) return rewardsDenied("FORBIDDEN");
    return { ...access, grantExpiresAt: state.grant.expiresAt, authority: { sessionId: context.session.id,
      subscriptionId: context.membership.organisation.subscription.id } };
  }
  async function safely(operation) {
    if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
    try { return await operation(); }
    catch (error) { return error instanceof StaffAbort ? error.result : rewardsDenied(isRetryableTransactionError(error) ? "CONFLICT" : "UNAVAILABLE"); }
  }
  async function lockAuthority(tx, access) {
    const rows = await tx.$queryRaw`SELECT s."id" FROM "Session" s
      JOIN "User" u ON u."id" = s."userId"
      JOIN "OrganisationMember" m ON m."userId" = u."id" AND m."id" = ${access.organisationMemberId}
      JOIN "Subscription" sub ON sub."organisationId" = m."organisationId" AND sub."id" = ${access.authority.subscriptionId}
      JOIN "Plan" p ON p."id" = sub."planId"
      JOIN "RewardEntitlementGrant" g ON g."organisationId" = m."organisationId" AND g."subscriptionId" = sub."id"
      WHERE s."id" = ${access.authority.sessionId} AND u."id" = ${access.userId}
        AND s."activeOrganisationId" = ${access.organisationId} AND m."organisationId" = ${access.organisationId}
      FOR SHARE OF s, u, m, sub, p, g`;
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== access.authority.sessionId) abort("FORBIDDEN");
    await tx.$queryRaw`SELECT "id" FROM "BillingContract" WHERE "subscriptionId" = ${access.authority.subscriptionId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "EnterpriseSecurityPolicy" WHERE "organisationId" = ${access.organisationId} FOR SHARE`;
  }
  async function membersAndGrants(tx, access) {
    // Exact locks (without status filters) force SERIALIZABLE retries if an
    // authority change committed after our snapshot, including while waiting
    // for the programme lock. Shared user/member locks protect role ceilings.
    const locked = await tx.$queryRaw`SELECT m."id" FROM "OrganisationMember" m JOIN "User" u ON u."id" = m."userId"
      WHERE m."organisationId" = ${access.organisationId} ORDER BY m."id" LIMIT 101 FOR SHARE OF m, u`;
    if (!Array.isArray(locked) || locked.length > 100) abort("REVIEW_TOO_LARGE");
    const all = await tx.organisationMember.findMany({ where: { organisationId: access.organisationId }, select: memberSelect,
      orderBy: { id: "asc" }, take: 101 });
    if (all.length > 100 || !sameIds(all.map(row => row.id), locked.map(row => row.id))) abort("REVIEW_TOO_LARGE");
    if (all.some(row => row.organisationId !== access.organisationId)) abort("UNAVAILABLE");
    const members = all.filter(eligible), byMember = new Map();
    for (const member of all) {
      const locks = await tx.$queryRaw`SELECT "id" FROM "RewardStaffGrant" WHERE "organisationId" = ${access.organisationId}
        AND "organisationMemberId" = ${member.id} ORDER BY "id" LIMIT 1001 FOR UPDATE`;
      if (!Array.isArray(locks) || locks.length > 1000) abort("REVIEW_TOO_LARGE");
      const grants = await tx.rewardStaffGrant.findMany({ where: { organisationId: access.organisationId, organisationMemberId: member.id },
        select: grantSelect, orderBy: { id: "asc" }, take: 1001 });
      if (grants.length > 1000 || !sameIds(grants.map(row => row.id), locks.map(row => row.id))) abort("REVIEW_TOO_LARGE");
      for (const row of grants) {
        const { locationId, ...authority } = row;
        const parsed = rewardStaffGrantSchema.safeParse({ ...authority, locationIds: locationId === null ? [] : [locationId] });
        if (!parsed.success || row.organisationId !== access.organisationId || row.organisationMemberId !== member.id ||
          (row.scope === "ALL_LOCATIONS") !== (locationId === null)) abort("UNAVAILABLE");
      }
      byMember.set(member.id, grants);
    }
    return { members, seatMembers: all, byMember };
  }
  async function availableLocations(tx, access, ids) {
    if (ids.length > access.limits.locations) abort("LIMIT_REACHED");
    const rows = await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "organisationId" = ${access.organisationId}
      AND "id" IN (SELECT jsonb_array_elements_text(${JSON.stringify(sorted(ids))}::jsonb)) FOR SHARE`;
    if (!Array.isArray(rows) || !sameIds(rows.map(row => row.id), ids)) abort("LOCATION_UNAVAILABLE");
    const active = await tx.location.findMany({ where: { organisationId: access.organisationId, id: { in: ids }, status: "ACTIVE" },
      select: { id: true, organisationId: true } });
    if (active.some(row => row.organisationId !== access.organisationId) || !sameIds(active.map(row => row.id), ids)) abort("LOCATION_UNAVAILABLE");
  }
  async function audit(tx, access, row, action, before = null) {
    await tx.rewardAuditEvent.create({ data: { organisationId: access.organisationId, actorUserId: access.userId,
      actorOrganisationMemberId: access.organisationMemberId, action, targetType: "STAFF_GRANT", targetId: row.id,
      metadata: { reasonCode: "OWNER_REQUEST", ...(before ? { before } : {}), after: auditSnapshot(row) } } });
  }
  async function transact(operation) {
    return runSerializableTransaction(db, async tx => {
      const initial = allow(await guard(tx));
      const program = await tx.$queryRaw`SELECT "id" FROM "RewardProgram" WHERE "organisationId" = ${initial.organisationId} FOR UPDATE`;
      if (!Array.isArray(program) || program.length !== 1) abort("NOT_ENTITLED");
      await lockAuthority(tx, initial);
      const access = allow(await guard(tx)); if (!sameActor(initial, access)) abort("FORBIDDEN");
      const data = await membersAndGrants(tx, access);
      const result = await operation(tx, access, data);
      const final = allow(await guard(tx)); if (!sameActor(access, final)) abort("FORBIDDEN");
      if (!enabled()) abort("FEATURE_DISABLED");
      return result;
    }, { maxAttempts: 3, retryDelayMs: 10 });
  }
  function target(input, data) {
    const member = data.members.find(row => row.id === input.memberId); if (!member) abort("FORBIDDEN");
    const grants = data.byMember.get(member.id);
    if (versionOf(member, grants) !== input.expectedVersion) abort("CONFLICT");
    return { member, grants };
  }
  async function modify(operation, input) {
    const parsed = staffAdminSchemas[operation].safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
    return transact(async (tx, access, data) => {
      const { member, grants } = target(parsed.data, data), now = nowAt(clock);
      let changedRows = 0;
      if (operation === "save") {
        const { locationIds, capabilities, expiresAt } = parsed.data, expiry = new Date(expiresAt);
        if (expiry <= now || expiry > access.grantExpiresAt) abort("INVALID_REQUEST");
        if (capabilities.some(action => !STAFF_ADMIN_ROLE_CAPABILITIES[member.role].includes(action))) abort("FORBIDDEN");
        if (grants.length + locationIds.filter(id => !grants.some(row => row.locationId === id)).length > 1000) abort("REVIEW_TOO_LARGE");
        // Reservations count even before their startsAt. A staff member with
        // several shop grants consumes one seat, not one seat per shop.
        const occupied = data.seatMembers.filter(row => usesSeat(row, data.byMember.get(row.id), now)).length;
        if (!usesSeat(member, grants, now) && occupied >= access.limits.staffSeats) abort("LIMIT_REACHED");
        if (access.limits.staffSeats === 0) abort("LIMIT_REACHED");
        await availableLocations(tx, access, locationIds);
        for (const row of grants.filter(row => row.revokedAt === null && (row.scope === "ALL_LOCATIONS" || !locationIds.includes(row.locationId)))) {
          const before = auditSnapshot(row);
          await tx.rewardStaffGrant.update({ where: { id: row.id }, data: { revokedAt: now } }); row.revokedAt = now;
          await audit(tx, access, row, "STAFF_GRANT_REVOKED", before); changedRows++;
        }
        for (const locationId of sorted(locationIds)) {
          const existing = grants.find(row => row.locationId === locationId), values = { scope: "LOCATIONS", locationId,
            capabilities: sorted(capabilities), startsAt: now, expiresAt: expiry, revokedAt: null };
          const before = existing ? auditSnapshot(existing) : null;
          const row = existing ? await tx.rewardStaffGrant.update({ where: { id: existing.id }, data: values, select: grantSelect }) :
            await tx.rewardStaffGrant.create({ data: { id: randomUUID(), organisationId: access.organisationId,
              organisationMemberId: member.id, ...values }, select: grantSelect });
          if (existing) Object.assign(existing, row); else grants.push(row);
          await audit(tx, access, row, existing ? "STAFF_GRANT_CHANGED" : "STAFF_GRANT_CREATED", before); changedRows++;
        }
        if (expiry <= nowAt(clock)) abort("INVALID_REQUEST");
      } else {
        for (const row of grants.filter(row => row.revokedAt === null)) {
          const before = auditSnapshot(row);
          await tx.rewardStaffGrant.update({ where: { id: row.id }, data: { revokedAt: now } }); row.revokedAt = now;
          await audit(tx, access, row, "STAFF_GRANT_REVOKED", before); changedRows++;
        }
      }
      return { ok: true, memberId: member.id, version: versionOf(member, grants), changedRows, checkedAt: nowAt(clock).toISOString() };
    });
  }
  return Object.freeze({
    async authorize() { return safely(async () => { const access = allow(await guard(db)); return { ok: true, organisationId: access.organisationId,
      userId: access.userId, organisationMemberId: access.organisationMemberId }; }); },
    overview(input = {}) { return safely(async () => {
      if (!staffAdminSchemas.overview.safeParse(input).success) abort("INVALID_REQUEST");
      const result = await transact(async (tx, access, data) => {
        const organisation = await tx.organisation.findUnique({ where: { id: access.organisationId }, select: { id: true, name: true } });
        if (!organisation || organisation.id !== access.organisationId) abort("FORBIDDEN");
        const locations = await tx.location.findMany({ where: { organisationId: access.organisationId, status: "ACTIVE" },
          orderBy: { id: "asc" }, take: 101, select: { id: true, name: true } });
        if (locations.length > 100) abort("REVIEW_TOO_LARGE");
        const now = nowAt(clock), members = data.members.map(member => { const grants = data.byMember.get(member.id); return {
          id: member.id, displayName: member.user.name?.trim() || "Unnamed team member", role: member.role,
          allowedCapabilities: STAFF_ADMIN_ROLE_CAPABILITIES[member.role], version: versionOf(member, grants),
          grants: grants.map(presentGrant), usesSeat: usesSeat(member, grants, now) }; });
        return { ok: true, organisation, members, locations, seatUsage: { used: data.seatMembers.filter(row => usesSeat(row, data.byMember.get(row.id), now)).length, limit: access.limits.staffSeats },
          grantExpiresAt: iso(access.grantExpiresAt), checkedAt: now.toISOString() };
      });
      return safeStaffAdminResult("overview", result) || rewardsDenied("UNAVAILABLE");
    }); },
    save(input) { return safely(async () => safeStaffAdminResult("save", await modify("save", input)) || rewardsDenied("UNAVAILABLE")); },
    revoke(input) { return safely(async () => safeStaffAdminResult("revoke", await modify("revoke", input)) || rewardsDenied("UNAVAILABLE")); }
  });
}
