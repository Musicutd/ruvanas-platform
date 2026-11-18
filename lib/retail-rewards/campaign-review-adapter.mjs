import { campaignConfigurationHash, expandCampaignTargets } from "../campaign-scheduling.mjs";

// Pure mirror of the publisher's persistedCampaignToInput projection. No global
// Prisma client, scheduler, media URL, or publication action is imported here.
export function reviewCampaignInput(row) {
  return { organisationId: row.organisationId, promoVersionId: row.promoVersionId, name: row.name, priority: row.priority,
    schedulingMode: row.schedulingMode, mandatory: row.mandatory, respectOpeningHours: row.respectOpeningHours,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10), effectiveTo: row.effectiveTo.toISOString().slice(0, 10),
    maxPromoMinutesPerHour: row.maxPromoMinutesPerHour, minSamePromoGapMinutes: row.minSamePromoGapMinutes, minAnyPromoGapMinutes: row.minAnyPromoGapMinutes,
    exactTimeHardStart: row.rule?.exactTimeHardStart || false, playsPerHour: row.rule?.playsPerHour || null, intervalMinutes: row.rule?.intervalMinutes || null,
    targets: row.targets.map(t => ({ targetType: t.targetType, targetId: t.brandId || t.locationGroupId || t.locationId || t.zoneId || t.stationId || t.channelId || null })),
    schedules: row.schedules.map(s => ({ weekday: s.weekday, windowMode: s.windowMode, startMinute: s.startMinute, endMinute: s.endMinute,
      exactMinute: s.exactMinute, playsPerHour: s.playsPerHour, intervalMinutes: s.intervalMinutes })) };
}
export function reviewCampaignHash(row, locations) {
  const input = reviewCampaignInput(row);
  // Retain publisher ordering (locations by name, zones by name). Never sort
  // the resulting array differently or omit topology from the published hash.
  const targetZoneIds = expandCampaignTargets({ targets: input.targets, locations, zones: locations.flatMap(l => l.zones) }).map(z => z.id);
  return campaignConfigurationHash({ ...input, targetZoneIds });
}
export function localCampaignDay(instant, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function campaignDatesOverlap(row, terms, locations) {
  const from = row.effectiveFrom.toISOString().slice(0, 10), to = row.effectiveTo.toISOString().slice(0, 10);
  if (from > to) return false;
  return locations.every(l => from <= localCampaignDay(new Date(Date.parse(terms.endsAt) - 1), l.timezone) &&
    to >= localCampaignDay(new Date(terms.startsAt), l.timezone));
}
