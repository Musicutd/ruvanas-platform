import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scopeStationScheduleData } from "../lib/station-schedule-scope.mjs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("station schedule shows only its own channel and versions", () => {
  const payload = {
    canAuthor: true,
    sources: {
      channels: [
        { id: "channel-a", stationId: "station-a" },
        { id: "channel-b", stationId: "station-b" },
        { id: "retail-channel", stationId: null }
      ],
      musicModes: [{ id: "mode-a" }]
    },
    schedules: [
      { id: "schedule-a", channel: { station: { id: "station-a" } } },
      { id: "schedule-b", channel: { station: { id: "station-b" } } },
      { id: "retail-schedule", channel: { station: null } }
    ]
  };

  const scoped = scopeStationScheduleData(payload, "station-a");
  assert.deepEqual(scoped.sources.channels.map((channel) => channel.id), ["channel-a"]);
  assert.deepEqual(scoped.schedules.map((schedule) => schedule.id), ["schedule-a"]);
  assert.equal(scoped.sources.musicModes, payload.sources.musicModes);
  assert.equal(payload.sources.channels.length, 3);
  assert.equal(scopeStationScheduleData(payload, null), payload);
});

test("station page checks tenant and Online Radio family; draft and publish remain separate", () => {
  const page = source("../app/dashboard/radio/schedule/[stationId]/page.js");
  const scheduler = source("../app/dashboard/programming/AdvancedSchedulerWorkspace.js");
  const create = source("../app/api/programming/advanced-scheduler/route.js");
  const publish = source("../app/api/programming/advanced-scheduler/[scheduleId]/versions/[versionId]/publish/route.js");

  assert.match(page, /requireSubscriberProduct\("ONLINE"\)/);
  assert.match(page, /organisationId: context\.membership\.organisationId, productFamily: "ONLINE"/);
  assert.match(page, /AdvancedSchedulerWorkspace stationId=\{station\.id\}/);
  assert.match(scheduler, /scopeStationScheduleData\(payload, stationId\)/);
  assert.match(source("../app/dashboard/programming/page.js"), /Open its station-channel schedule/);
  assert.match(source("../app/dashboard/programming/ProgrammingWorkspace.js"), /Boolean\(onlineRadioStationId\) && data\.targets\.length === 0/);
  assert.match(create, /programmeSchedule\.create/);
  assert.match(publish, /assertProgrammeSchedulePublishable|publishProgrammeScheduleVersion/);
  assert.match(source("../app/admin/music-schedules/new/NewMusicScheduleForm.js"), /Online Radio stations use their own channel schedule/);
});
