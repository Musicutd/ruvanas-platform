export const CORRECTIONS_SCHEDULING_LOCK_MESSAGE = "Ruvanas Inside scheduling is locked until private delivery and approval-guard integration are ready.";

export async function assertCorrectionsSchedulingAllowed(client, { organisationId, locationId, zoneId, channelId }) {
  if (!organisationId) throw new Error("An organisation is required for scheduling.");
  const correctionsLocation = locationId && await client.correctionsFacility.findFirst({ where: { locationId, location: { organisationId } }, select: { locationId: true } });
  const correctionsZone = zoneId && await client.correctionsFacility.findFirst({ where: { location: { organisationId, zones: { some: { id: zoneId } } } }, select: { locationId: true } });
  const correctionsChannel = channelId && await client.channel.findFirst({
    where: { id: channelId, organisationId, OR: [
      { musicRightsUse: "CORRECTIONS_RADIO" },
      { station: { productFamily: "CORRECTIONS" } },
      { zoneAssignments: { some: { zone: { location: { correctionsFacility: { isNot: null } } } } } }
    ] }, select: { id: true }
  });
  if (correctionsLocation || correctionsZone || correctionsChannel) {
    const error = new Error(CORRECTIONS_SCHEDULING_LOCK_MESSAGE);
    error.code = "CORRECTIONS_SCHEDULING_LOCKED";
    throw error;
  }
}
