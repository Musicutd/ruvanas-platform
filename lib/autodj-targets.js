import { prisma } from "@/lib/prisma";

export async function listAutoDjTargets(organisationId, entitlements) {
  const [locations, channels] = await Promise.all([
    entitlements.retailRadioEnabled || entitlements.schoolRadioEnabled ? prisma.location.findMany({
      where: { organisationId, status: "ACTIVE" },
      select: { id: true, name: true, timezone: true, countryCode: true, zones: { where: { status: "ACTIVE" }, select: { id: true, name: true, channelAssignments: { where: { activeFrom: { lte: new Date() }, OR: [{ activeTo: null }, { activeTo: { gt: new Date() } }] }, select: { channelId: true } } } } },
      orderBy: { name: "asc" },
      take: 200
    }) : [],
    entitlements.onlineRadioEnabled || entitlements.schoolRadioEnabled ? prisma.channel.findMany({
      where: { organisationId, status: "ACTIVE" },
      select: { id: true, name: true, station: { select: { id: true, name: true } }, programmeSchedule: { select: { timezone: true } } },
      orderBy: { name: "asc" },
      take: 200
    }) : []
  ]);
  const targets = [];
  if (entitlements.retailRadioEnabled) {
    for (const location of locations) {
      const locationChannels = [...new Set(location.zones.flatMap((zone) => zone.channelAssignments.map((assignment) => assignment.channelId)))];
      targets.push({ id: location.id, type: "LOCATION", label: location.name, timezone: location.timezone, territory: location.countryCode, rightsUse: "RETAIL_RADIO", product: "RETAIL", channelId: locationChannels.length === 1 ? locationChannels[0] : null });
      for (const zone of location.zones) targets.push({ id: zone.id, type: "ZONE", label: `${location.name} / ${zone.name}`, timezone: location.timezone, territory: location.countryCode, rightsUse: "RETAIL_RADIO", product: "RETAIL", channelId: zone.channelAssignments.length === 1 ? zone.channelAssignments[0].channelId : null });
    }
  }
  if (entitlements.schoolRadioEnabled) {
    for (const channel of channels) targets.push({ id: channel.id, type: "SCHOOL", label: `${channel.station?.name ? `${channel.station.name} / ` : ""}${channel.name}`, timezone: channel.programmeSchedule?.timezone || "Europe/Malta", territory: null, rightsUse: "SCHOOL_RADIO", product: "SCHOOL", channelId: channel.id });
  }
  if (entitlements.onlineRadioEnabled) {
    for (const channel of channels) targets.push({ id: channel.id, type: "CHANNEL", label: `${channel.station?.name ? `${channel.station.name} / ` : ""}${channel.name}`, timezone: channel.programmeSchedule?.timezone || "UTC", territory: null, rightsUse: "ONLINE_RADIO", product: "ONLINE", channelId: channel.id });
  }
  return targets;
}

export async function resolveAutoDjTarget(organisationId, targetType, targetId, entitlements) {
  const target = (await listAutoDjTargets(organisationId, entitlements)).find((entry) => entry.type === targetType && entry.id === targetId);
  if (!target) {
    const error = new Error("The selected AutoDJ target is not available for this organisation and product plan.");
    error.code = "TARGET_NOT_ALLOWED";
    throw error;
  }
  return target;
}
