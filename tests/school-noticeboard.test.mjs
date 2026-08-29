import assert from "node:assert/strict";
import test from "node:test";
import { compileSchoolNoticeboard, normaliseSchoolNoticeboardPost } from "../lib/school-noticeboard.mjs";

const device = {
  id: "display-1",
  organisationId: "school-1",
  zone: { id: "zone-1", location: { id: "location-1" } }
};

function post(overrides = {}) {
  return {
    id: "notice-1",
    organisationId: "school-1",
    announcementId: "announcement-1",
    locationId: "location-1",
    zoneId: null,
    status: "SCHEDULED",
    theme: "INFORMATION",
    priority: 50,
    displaySeconds: 15,
    startsAt: new Date("2026-09-14T08:00:00.000Z"),
    endsAt: new Date("2026-09-14T10:00:00.000Z"),
    policyVersion: "school-noticeboard-v1",
    announcement: { title: "Library week", summary: "Visit the library at lunchtime.", status: "APPROVED" },
    ...overrides
  };
}

test("noticeboard schedules require one target and a bounded window", () => {
  const result = normaliseSchoolNoticeboardPost({ announcementId: "announcement-1", zoneId: "zone-1", startsAt: "2026-09-14T08:00:00Z", endsAt: "2026-09-14T10:00:00Z", displaySeconds: 20 });
  assert.equal(result.zoneId, "zone-1");
  assert.equal(result.displaySeconds, 20);
  assert.throws(() => normaliseSchoolNoticeboardPost({ announcementId: "announcement-1", locationId: "location-1", zoneId: "zone-1", startsAt: "2026-09-14T08:00:00Z", endsAt: "2026-09-14T10:00:00Z" }), /exactly one/);
  assert.throws(() => normaliseSchoolNoticeboardPost({ announcementId: "announcement-1", zoneId: "zone-1", startsAt: "2026-09-14T08:00:00Z", endsAt: "2026-10-20T10:00:00Z" }), /31 days/);
});

test("only active approved same-school notices reach their target display", () => {
  const instant = new Date("2026-09-14T09:00:00.000Z");
  const items = compileSchoolNoticeboard({
    device,
    instant,
    posts: [
      post(),
      post({ id: "zone", locationId: null, zoneId: "zone-1", priority: 90 }),
      post({ id: "wrong-zone", locationId: null, zoneId: "zone-2" }),
      post({ id: "draft", announcement: { title: "Draft", summary: "", status: "IN_REVIEW" } }),
      post({ id: "other-school", organisationId: "school-2" }),
      post({ id: "cancelled", status: "CANCELLED" })
    ]
  });
  assert.deepEqual(items.map((item) => item.id), ["zone", "notice-1"]);
  assert.equal(items[0].policyVersion, "school-noticeboard-v1");
  assert.equal(JSON.stringify(items).includes("announcementId"), false);
});
