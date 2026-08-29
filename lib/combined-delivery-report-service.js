import { prisma } from "@/lib/prisma";
import { normaliseCombinedDeliveryFilters } from "@/lib/combined-delivery-report.mjs";

export async function loadCombinedDeliveryReport(organisationId, input = {}, limit = 2000) {
  const filters = normaliseCombinedDeliveryFilters(input);
  const audioWhere = { organisationId, itemType: "PROMO", occurredAt: { gte: filters.fromInstant, lt: filters.until }, eventType: { in: ["COMPLETED", "FAILED"] } };
  const visualWhere = { organisationId, occurredAt: { gte: filters.fromInstant, lt: filters.until }, eventType: { in: ["COMPLETED", "FAILED"] } };
  const [audio, visual, audioCounts, visualCounts, takeoverCompleted, retailMediaVisualCompleted] = await Promise.all([
    prisma.proofOfPlayEvent.findMany({
      where: audioWhere,
      select: { id: true, eventType: true, occurredAt: true, playerName: true, locationName: true, zoneName: true, trackTitle: true, campaign: { select: { name: true } } },
      orderBy: { occurredAt: "desc" }, take: limit
    }),
    prisma.digitalSignageDeliveryProof.findMany({
      where: visualWhere,
      select: { id: true, eventType: true, occurredAt: true, takeoverId: true, retailMediaOrderId: true, device: { select: { name: true, zone: { select: { name: true, location: { select: { name: true } } } } } }, asset: { select: { name: true } }, retailMediaOrder: { select: { name: true } }, takeover: { select: { name: true } } },
      orderBy: { occurredAt: "desc" }, take: limit
    }),
    prisma.proofOfPlayEvent.groupBy({ by: ["eventType"], where: audioWhere, _count: { _all: true } }),
    prisma.digitalSignageDeliveryProof.groupBy({ by: ["eventType"], where: visualWhere, _count: { _all: true } }),
    prisma.digitalSignageDeliveryProof.count({ where: { ...visualWhere, eventType: "COMPLETED", takeoverId: { not: null } } }),
    prisma.digitalSignageDeliveryProof.count({ where: { ...visualWhere, eventType: "COMPLETED", retailMediaOrderId: { not: null } } })
  ]);
  const rows = [
    ...audio.map((event) => ({ medium: "AUDIO", occurredAt: event.occurredAt.toISOString(), eventType: event.eventType, device: event.playerName, location: event.locationName, zone: event.zoneName, content: event.trackTitle, campaignOrOrder: event.campaign?.name || "", takeover: "" })),
    ...visual.map((event) => ({ medium: "VISUAL", occurredAt: event.occurredAt.toISOString(), eventType: event.eventType, device: event.device.name, location: event.device.zone.location.name, zone: event.device.zone.name, content: event.asset.name, campaignOrOrder: event.retailMediaOrder?.name || "", takeover: event.takeover?.name || "" }))
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const count = (groups, eventType) => groups.find((group) => group.eventType === eventType)?._count?._all || 0;
  const summary = { audioCompleted: count(audioCounts, "COMPLETED"), audioFailed: count(audioCounts, "FAILED"), visualCompleted: count(visualCounts, "COMPLETED"), visualFailed: count(visualCounts, "FAILED"), takeoverCompleted, retailMediaVisualCompleted };
  return { filters: { from: filters.from, to: filters.to }, summary, rows, truncated: audio.length === limit || visual.length === limit };
}
