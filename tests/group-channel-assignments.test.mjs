import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupAssignmentPreview,
  flattenGroupZones,
  planGroupAssignmentChanges
} from "../lib/group-channel-assignments.mjs";

const locations = [
  {
    id: "location-1",
    name: "Valletta",
    zones: [
      {
        id: "zone-1",
        name: "Main floor",
        channelAssignments: [
          { channelId: "channel-a", channel: { name: "Channel A" } }
        ]
      },
      { id: "zone-2", name: "Cafe", channelAssignments: [] }
    ]
  },
  {
    id: "location-2",
    name: "Sliema",
    zones: [
      {
        id: "zone-1",
        name: "Duplicate should be ignored",
        channelAssignments: []
      }
    ]
  }
];

test("group zones are flattened with location and current-channel context", () => {
  assert.deepEqual(flattenGroupZones(locations), [
    {
      id: "zone-1",
      name: "Main floor",
      locationId: "location-1",
      locationName: "Valletta",
      currentChannelId: "channel-a",
      currentChannelName: "Channel A"
    },
    {
      id: "zone-2",
      name: "Cafe",
      locationId: "location-1",
      locationName: "Valletta",
      currentChannelId: null,
      currentChannelName: null
    }
  ]);
});

test("assignment preview separates changes from zones already on the channel", () => {
  const preview = buildGroupAssignmentPreview(locations, "channel-a");

  assert.equal(preview.zoneCount, 2);
  assert.equal(preview.changedZoneCount, 1);
  assert.equal(preview.unchangedZoneCount, 1);
  assert.equal(preview.zones[0].willChange, false);
  assert.equal(preview.zones[1].willChange, true);
});

test("assignment plans are idempotent and repair duplicate active assignments", () => {
  const plan = planGroupAssignmentChanges(
    ["zone-1", "zone-2", "zone-3", "zone-3"],
    [
      { zoneId: "zone-1", channelId: "channel-a" },
      { zoneId: "zone-2", channelId: "channel-b" },
      { zoneId: "zone-3", channelId: "channel-a" },
      { zoneId: "zone-3", channelId: "channel-b" }
    ],
    "channel-a"
  );

  assert.deepEqual(plan.unchangedZoneIds, ["zone-1"]);
  assert.deepEqual(plan.changes, [
    { zoneId: "zone-2", previousChannelIds: ["channel-b"] },
    {
      zoneId: "zone-3",
      previousChannelIds: ["channel-a", "channel-b"]
    }
  ]);
});

