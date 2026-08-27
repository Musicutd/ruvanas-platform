import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignConfigurationHash,
  campaignTargetCreateData,
  expandCampaignTargets,
  normaliseCampaignPayload,
  previewCampaign
} from "../lib/campaign-scheduling.mjs";

function payload(overrides = {}) {
  return {
    organisationId: "organisation-1",
    promoVersionId: "promo-version-1",
    name: "Lunch promotion",
    priority: "NORMAL",
    schedulingMode: "PLAYS_PER_HOUR",
    playsPerHour: 2,
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-09-07",
    maxPromoMinutesPerHour: 12,
    minSamePromoGapMinutes: 15,
    minAnyPromoGapMinutes: 2,
    targets: [{ targetType: "LOCATION", targetId: "location-1" }],
    schedules: [{ weekday: 2, startsAt: "09:00", endsAt: "17:00" }],
    ...overrides
  };
}

test("normalises plays-per-hour, interval, exact-time and advanced campaign rules", () => {
  const hourly = normaliseCampaignPayload(payload());
  assert.equal(hourly.schedules[0].windowMode, "PLAYS_PER_HOUR");
  assert.equal(hourly.schedules[0].playsPerHour, 2);

  const interval = normaliseCampaignPayload(payload({
    schedulingMode: "INTERVAL",
    playsPerHour: undefined,
    intervalMinutes: 30
  }));
  assert.equal(interval.schedules[0].windowMode, "INTERVAL");
  assert.equal(interval.schedules[0].intervalMinutes, 30);

  const exact = normaliseCampaignPayload(payload({
    schedulingMode: "EXACT_TIMES",
    playsPerHour: undefined,
    schedules: [{ weekday: 2, at: "10:15" }, { weekday: 2, at: "14:45" }]
  }));
  assert.deepEqual(exact.schedules.map((entry) => entry.exactMinute), [615, 885]);

  const advanced = normaliseCampaignPayload(payload({
    schedulingMode: "ADVANCED_DAYPART",
    playsPerHour: undefined,
    schedules: [
      { weekday: 2, startsAt: "09:00", endsAt: "12:00", frequencyMode: "PLAYS_PER_HOUR", playsPerHour: 3 },
      { weekday: 2, startsAt: "12:00", endsAt: "17:00", frequencyMode: "INTERVAL", intervalMinutes: 30 }
    ]
  }));
  assert.deepEqual(advanced.schedules.map((entry) => entry.windowMode), ["PLAYS_PER_HOUR", "INTERVAL"]);
});

test("rejects unsafe campaign dates, duplicate coverage, overlaps and excessive frequency", () => {
  assert.throws(() => normaliseCampaignPayload(payload({ effectiveTo: "2026-08-31" })), /end date/i);
  assert.throws(() => normaliseCampaignPayload(payload({
    targets: [
      { targetType: "ALL_LOCATIONS" },
      { targetType: "LOCATION", targetId: "location-1" }
    ]
  })), /already includes/i);
  assert.throws(() => normaliseCampaignPayload(payload({
    schedules: [
      { weekday: 2, startsAt: "09:00", endsAt: "12:00" },
      { weekday: 2, startsAt: "11:00", endsAt: "13:00" }
    ]
  })), /overlap/i);
  assert.throws(() => normaliseCampaignPayload(payload({ playsPerHour: 13 })), /between 1 and 12/i);
});

test("expands brand, group, location and zone targets without duplicate playback zones", () => {
  const zones = expandCampaignTargets({
    targets: [
      { targetType: "BRAND", targetId: "brand-1" },
      { targetType: "LOCATION_GROUP", targetId: "group-1" },
      { targetType: "ZONE", targetId: "zone-2" }
    ],
    brands: [{ id: "brand-1" }],
    groups: [{ id: "group-1", locationIds: ["location-2"] }],
    locations: [
      { id: "location-1", name: "Valletta", brandId: "brand-1", timezone: "Europe/Malta", openingHoursConfigured: true },
      { id: "location-2", name: "Sliema", brandId: null, timezone: "Europe/Malta", openingHoursConfigured: false }
    ],
    zones: [
      { id: "zone-1", name: "Main", locationId: "location-1" },
      { id: "zone-2", name: "Cafe", locationId: "location-2" }
    ]
  });
  assert.deepEqual(zones.map((zone) => zone.id), ["zone-1", "zone-2"]);
});

test("preview estimates plays and blocks same-gap and hourly-minute violations", () => {
  const campaign = normaliseCampaignPayload(payload({ playsPerHour: 4, minSamePromoGapMinutes: 20, maxPromoMinutesPerHour: 1 }));
  const preview = previewCampaign({
    campaign,
    durationSeconds: 30,
    targetZones: [{ id: "zone-1", openingHoursConfigured: true }]
  });
  assert.equal(preview.canPublish, false);
  assert.ok(preview.errors.some((error) => /same-promo gap/i.test(error)));
  assert.ok(preview.errors.some((error) => /promo minutes/i.test(error)));
  assert.equal(preview.estimatedPlaysPerZone, 32);
});

test("preview reports competing mandatory campaigns and unconfigured opening hours", () => {
  const campaign = normaliseCampaignPayload(payload());
  const preview = previewCampaign({
    campaign,
    durationSeconds: 20,
    targetZones: [{ id: "zone-1", openingHoursConfigured: false }],
    existingCampaigns: [{
      name: "Corporate message",
      mandatory: true,
      effectiveFrom: "2026-09-01",
      effectiveTo: "2026-09-30",
      targetZoneIds: ["zone-1"],
      schedules: [{ weekday: 2, windowMode: "PLAYS_PER_HOUR", startMinute: 600, endMinute: 720, playsPerHour: 1 }]
    }]
  });
  assert.equal(preview.canPublish, true);
  assert.ok(preview.warnings.some((warning) => /opening hours/i.test(warning)));
  assert.ok(preview.warnings.some((warning) => /Mandatory campaign/i.test(warning)));
});

test("configuration hashes are stable and target persistence keeps one typed relation", () => {
  const campaign = normaliseCampaignPayload(payload());
  assert.equal(campaignConfigurationHash(campaign), campaignConfigurationHash({ ...campaign }));
  assert.deepEqual(campaignTargetCreateData({ targetType: "LOCATION", targetId: "location-1" }), {
    targetType: "LOCATION",
    brandId: null,
    locationGroupId: null,
    locationId: "location-1",
    zoneId: null
  });
});
