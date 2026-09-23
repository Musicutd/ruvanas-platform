import { runSerializableTransaction } from "./transaction-retry.mjs";

export async function prepareRetailAreaChannel(database, {
  organisationId,
  actorUserId,
  zoneId,
  streamLimit,
  instant = new Date()
}) {
  return runSerializableTransaction(database, async (tx) => {
    const zone = await tx.zone.findFirst({
      where: { id: zoneId, status: "ACTIVE", location: { organisationId, status: "ACTIVE" } },
      select: { id: true, name: true, location: { select: { name: true } } }
    });
    if (!zone) return { ok: false, status: 404, error: "This shop area is no longer available." };

    const assignments = await tx.channelAssignment.findMany({
      where: { zoneId, OR: [{ activeTo: null }, { activeTo: { gt: instant } }] },
      select: { channelId: true, activeFrom: true, channel: { select: { organisationId: true, status: true, musicRightsUse: true } } }
    });
    if (assignments.length) {
      if (assignments.length !== 1 || assignments[0].activeFrom > instant || assignments[0].channel.organisationId !== organisationId || assignments[0].channel.status !== "ACTIVE" || assignments[0].channel.musicRightsUse !== "RETAIL_RADIO") {
        return { ok: false, status: 409, error: "This area already has a channel that needs review. Ask Ruvanas for setup help." };
      }
      const sharedAssignments = await tx.channelAssignment.count({
        where: { channelId: assignments[0].channelId, OR: [{ activeTo: null }, { activeTo: { gt: instant } }] }
      });
      if (sharedAssignments !== 1) return { ok: false, status: 409, error: "This channel serves another area. Ask Ruvanas to separate them before saving music." };
      return { ok: true, channelId: assignments[0].channelId, prepared: false };
    }

    const slug = `retail-area-${zoneId}`;
    const existing = await tx.channel.findUnique({ where: { organisationId_slug: { organisationId, slug } }, select: { id: true, status: true, stationId: true, musicRightsUse: true } });
    if (existing && (existing.status === "ARCHIVED" || existing.stationId || existing.musicRightsUse !== "RETAIL_RADIO")) {
      return { ok: false, status: 409, error: "This area's previous channel needs review. Ask Ruvanas for setup help." };
    }
    if (existing) {
      const inUse = await tx.channelAssignment.count({
        where: { channelId: existing.id, OR: [{ activeTo: null }, { activeTo: { gt: instant } }] }
      });
      if (inUse) return { ok: false, status: 409, error: "This area's channel is already in use. Ask Ruvanas for setup help." };
    }

    let reusable = null;
    if (!existing) {
      const unused = await tx.channel.findMany({
        where: {
          organisationId, status: "ACTIVE", musicRightsUse: "RETAIL_RADIO", stationId: null,
          autoDjPolicy: { is: null }, programmeSchedule: { is: null },
          zoneAssignments: { none: { OR: [{ activeTo: null }, { activeTo: { gt: instant } }] } }
        },
        select: { id: true },
        take: 2
      });
      if (unused.length === 1) reusable = unused[0];
    }

    if ((!existing || existing.status !== "ACTIVE") && !reusable) {
      const activeChannels = await tx.channel.count({ where: { organisationId, status: "ACTIVE" } });
      if (!Number.isInteger(streamLimit) || streamLimit < 1 || activeChannels >= streamLimit) {
        return { ok: false, status: 409, error: "Your plan has no free channel slot for this shop. Ask Ruvanas to review your setup." };
      }
    }

    const channel = reusable || (existing
      ? await tx.channel.update({ where: { id: existing.id }, data: { status: "ACTIVE" }, select: { id: true } })
      : await tx.channel.create({ data: { organisationId, name: `${zone.location.name} / ${zone.name}`.slice(0, 120), slug, status: "ACTIVE", musicRightsUse: "RETAIL_RADIO" }, select: { id: true } }));
    const previousAssignment = await tx.channelAssignment.findUnique({ where: { channelId_zoneId: { channelId: channel.id, zoneId } }, select: { id: true } });
    if (previousAssignment) await tx.channelAssignment.update({ where: { id: previousAssignment.id }, data: { activeFrom: instant, activeTo: null } });
    else await tx.channelAssignment.create({ data: { channelId: channel.id, zoneId, activeFrom: instant } });
    await tx.auditLog.create({ data: {
      organisationId, actorUserId, action: "RETAIL_AREA_CHANNEL_PREPARED", entityType: "Channel", entityId: channel.id,
      details: { zoneId, createdChannel: !existing && !reusable, reusedChannel: Boolean(reusable), streamingConfigured: false }
    } });
    return { ok: true, channelId: channel.id, prepared: true };
  });
}
