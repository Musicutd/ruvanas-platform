export function flattenGroupZones(locations) {
  if (!Array.isArray(locations)) {
    return [];
  }

  const zones = [];
  const seen = new Set();

  for (const location of locations) {
    for (const zone of location?.zones || []) {
      if (!zone?.id || seen.has(zone.id)) {
        continue;
      }

      seen.add(zone.id);
      zones.push({
        id: zone.id,
        name: zone.name || "Unnamed zone",
        locationId: location.id,
        locationName: location.name || "Unnamed location",
        currentChannelId: zone.channelAssignments?.[0]?.channelId || null,
        currentChannelName: zone.channelAssignments?.[0]?.channel?.name || null
      });
    }
  }

  return zones;
}

export function buildGroupAssignmentPreview(locations, channelId) {
  const zones = flattenGroupZones(locations).map((zone) => ({
    ...zone,
    willChange: Boolean(channelId) && zone.currentChannelId !== channelId
  }));

  return {
    zones,
    zoneCount: zones.length,
    changedZoneCount: zones.filter((zone) => zone.willChange).length,
    unchangedZoneCount: zones.filter(
      (zone) => Boolean(channelId) && !zone.willChange
    ).length
  };
}

export function planGroupAssignmentChanges(zoneIds, activeAssignments, channelId) {
  const requestedZoneIds = [...new Set((zoneIds || []).filter(Boolean))];
  const assignmentsByZone = new Map();

  for (const assignment of activeAssignments || []) {
    if (!assignmentsByZone.has(assignment.zoneId)) {
      assignmentsByZone.set(assignment.zoneId, []);
    }
    assignmentsByZone.get(assignment.zoneId).push(assignment);
  }

  const changes = [];
  const unchangedZoneIds = [];

  for (const zoneId of requestedZoneIds) {
    const currentAssignments = assignmentsByZone.get(zoneId) || [];
    const alreadyAssigned =
      currentAssignments.length === 1 &&
      currentAssignments[0].channelId === channelId;

    if (alreadyAssigned) {
      unchangedZoneIds.push(zoneId);
      continue;
    }

    changes.push({
      zoneId,
      previousChannelIds: currentAssignments.map(
        (assignment) => assignment.channelId
      )
    });
  }

  return { changes, unchangedZoneIds };
}

