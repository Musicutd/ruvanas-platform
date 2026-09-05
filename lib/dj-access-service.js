import { prisma } from "./prisma";
import { createDjAccessToken, djGrantAvailability, hashDjAccessToken, isDjAccessTokenActive, safeDjAccessGrant } from "./dj-access.mjs";

const grantInclude = {
  channel: { select: { id: true, name: true, status: true, station: { select: { id: true, name: true } } } },
  granteeMembership: { select: { role: true, user: { select: { id: true, name: true, email: true } } } },
  tokens: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { expiresAt: true, lastUsedAt: true, revokedAt: true } }
};

export async function listDjAccessGrants(organisationId, now = new Date()) {
  const grants = await prisma.djAccessGrant.findMany({ where: { organisationId }, include: grantInclude, orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }], take: 100 });
  return grants.map((grant) => safeDjAccessGrant(grant, now));
}

export async function createDjAccessGrant({ organisationId, actorUserId, input, now = new Date() }) {
  return prisma.$transaction(async (tx) => {
    const [channel, membership] = await Promise.all([
      tx.channel.findFirst({ where: { id: input.channelId, organisationId, status: "ACTIVE" }, select: { id: true } }),
      tx.organisationMember.findUnique({ where: { userId_organisationId: { userId: input.granteeUserId, organisationId } }, include: { user: { select: { id: true, name: true, email: true } } } })
    ]);
    if (!channel) throw new Error("Choose an active channel owned by this organisation.");
    if (!membership || !["OWNER", "MANAGER", "CONTENT_EDITOR", "VIEWER"].includes(membership.role)) throw new Error("Choose an active Ruvanas team member for DJ access.");

    await tx.djAccessGrant.updateMany({
      where: { organisationId, channelId: channel.id, granteeUserId: membership.userId, status: "ACTIVE", endsAt: { lte: now } },
      data: { status: "REVOKED", revokedAt: now, revokedByUserId: actorUserId, revokeReason: "Automatically closed after its access window ended." }
    });
    const existing = await tx.djAccessGrant.findFirst({ where: { organisationId, channelId: channel.id, granteeUserId: membership.userId, status: "ACTIVE" }, select: { id: true, startsAt: true, endsAt: true } });
    if (existing) throw new Error("This presenter already has an open grant for the channel. Revoke it before issuing another.");

    const grant = await tx.djAccessGrant.create({ data: { organisationId, channelId: channel.id, granteeUserId: membership.userId, label: input.label, capabilities: input.capabilities, startsAt: input.startsAt, endsAt: input.endsAt, createdByUserId: actorUserId } });
    const issued = createDjAccessToken(now, grant.endsAt);
    await tx.djAccessToken.create({ data: { grantId: grant.id, tokenHash: issued.tokenHash, expiresAt: issued.expiresAt } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "DJ_ACCESS_GRANTED", entityType: "DjAccessGrant", entityId: grant.id, details: { channelId: grant.channelId, granteeUserId: grant.granteeUserId, capabilities: grant.capabilities, startsAt: grant.startsAt.toISOString(), endsAt: grant.endsAt.toISOString() } } });
    const hydrated = await tx.djAccessGrant.findUnique({ where: { id: grant.id }, include: grantInclude });
    return { grant: safeDjAccessGrant({ ...hydrated, grantee: hydrated.granteeMembership.user }, now), rawToken: issued.rawToken };
  });
}

export async function rotateDjAccessToken({ organisationId, grantId, actorUserId, now = new Date() }) {
  return prisma.$transaction(async (tx) => {
    const grant = await tx.djAccessGrant.findFirst({ where: { id: grantId, organisationId }, include: grantInclude });
    const availability = djGrantAvailability(grant, now);
    if (!grant) return null;
    if (grant.status !== "ACTIVE" || grant.revokedAt || new Date(grant.endsAt) <= now) throw new Error("Only an open DJ access grant can receive a new link.");
    const issued = createDjAccessToken(now, grant.endsAt);
    await tx.djAccessToken.updateMany({ where: { grantId: grant.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.djAccessToken.create({ data: { grantId: grant.id, tokenHash: issued.tokenHash, expiresAt: issued.expiresAt } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "DJ_ACCESS_TOKEN_ROTATED", entityType: "DjAccessGrant", entityId: grant.id, details: { channelId: grant.channelId, granteeUserId: grant.granteeUserId, stateAtRotation: availability.reason || "ACTIVE" } } });
    const hydrated = await tx.djAccessGrant.findUnique({ where: { id: grant.id }, include: grantInclude });
    return { grant: safeDjAccessGrant({ ...hydrated, grantee: hydrated.granteeMembership.user }, now), rawToken: issued.rawToken };
  });
}

export async function revokeDjAccessGrant({ organisationId, grantId, actorUserId, reason, now = new Date() }) {
  return prisma.$transaction(async (tx) => {
    const grant = await tx.djAccessGrant.findFirst({ where: { id: grantId, organisationId } });
    if (!grant) return null;
    if (grant.status === "REVOKED") return safeDjAccessGrant({ ...grant, channel: null, grantee: null, tokens: [] }, now);
    await tx.djAccessToken.updateMany({ where: { grantId: grant.id, revokedAt: null }, data: { revokedAt: now } });
    const updated = await tx.djAccessGrant.update({ where: { id: grant.id }, data: { status: "REVOKED", revokedAt: now, revokedByUserId: actorUserId, revokeReason: reason || "Revoked by an organisation manager." }, include: grantInclude });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "DJ_ACCESS_REVOKED", entityType: "DjAccessGrant", entityId: grant.id, details: { channelId: grant.channelId, granteeUserId: grant.granteeUserId, reason: updated.revokeReason } } });
    return safeDjAccessGrant({ ...updated, grantee: updated.granteeMembership.user }, now);
  });
}

export async function validateDjAccessToken(database, { rawToken, userId, organisationId = null, channelId = null, requiredCapability = "VIEW_CHANNEL", now = new Date(), markUsed = true }) {
  let tokenHash;
  try { tokenHash = hashDjAccessToken(rawToken); } catch { return null; }
  const token = await database.djAccessToken.findUnique({ where: { tokenHash }, include: { grant: { include: { channel: { select: { id: true, name: true, status: true, station: { select: { id: true, name: true } } } }, granteeMembership: { select: { user: { select: { id: true, name: true, email: true } } } } } } } });
  if (!isDjAccessTokenActive(token, now) || !token?.grant || token.grant.granteeUserId !== userId) return null;
  if (organisationId && token.grant.organisationId !== organisationId) return null;
  if (channelId && token.grant.channelId !== channelId) return null;
  if (token.grant.channel?.status !== "ACTIVE") return null;
  if (!djGrantAvailability(token.grant, now, requiredCapability).allowed) return null;
  if (markUsed) await database.djAccessToken.update({ where: { id: token.id }, data: { lastUsedAt: now } });
  return { grantId: token.grant.id, organisationId: token.grant.organisationId, channelId: token.grant.channelId, granteeUserId: token.grant.granteeUserId, label: token.grant.label, capabilities: token.grant.capabilities, startsAt: token.grant.startsAt, endsAt: token.grant.endsAt, channel: token.grant.channel, grantee: token.grant.granteeMembership.user, tokenExpiresAt: token.expiresAt };
}
