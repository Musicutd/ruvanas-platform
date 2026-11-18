import { runSerializableTransaction } from "./transaction-retry.mjs";
import { loadRetailTestPlayerForEnrolment } from "./retail-test-player-access.mjs";
import { RETAIL_SUBSCRIBER_ORGANISATION_ID as RETAIL_ORG } from "./retail-subscriber-access.mjs";

export async function enrolPlayerCode(db, { enrolmentTokenHash, sessionTokenHash, now = new Date(), env = process.env } = {}) {
  if (![enrolmentTokenHash, sessionTokenHash].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) ||
    !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  return runSerializableTransaction(db, async tx => {
    let pending = await tx.player.findUnique({ where: { enrolmentTokenHash } });
    if (!pending || pending.status === "DISABLED" || pending.retiredAt || pending.sessionRevokedAt ||
      !(pending.enrolmentExpiresAt instanceof Date) || pending.enrolmentExpiresAt <= now) return null;
    const retailTest = pending.organisationId === RETAIL_ORG;
    if (retailTest) {
      pending = await loadRetailTestPlayerForEnrolment(tx, enrolmentTokenHash, { now, env });
      if (!pending) return null;
    } else if (env.RUVANAS_PRIVATE_PREVIEW_ENABLED === "1") return null;
    const consumed = await tx.player.updateMany({ where: { id: pending.id, organisationId: pending.organisationId,
      enrolmentTokenHash, enrolmentExpiresAt: { gt: now }, status: { not: "DISABLED" }, retiredAt: null, sessionRevokedAt: null },
      data: { status: retailTest ? "OFFLINE" : "ONLINE", enrolmentTokenHash: null, enrolmentExpiresAt: null,
        sessionTokenHash, enrolledAt: now, ...(retailTest ? { lastHeartbeatAt: null } : { lastHeartbeatAt: now }) } });
    if (consumed.count !== 1) return null;
    await tx.auditLog.create({ data: { organisationId: pending.organisationId, action: "PLAYER_ENROLLED",
      entityType: "Player", entityId: pending.id, details: { zoneId: pending.zoneId,
        ...(retailTest ? { source: "EXISTING_RETAIL_SHARED_STREAM", playbackConfirmed: false } : {}) } } });
    return { id: pending.id, organisationId: pending.organisationId };
  });
}
