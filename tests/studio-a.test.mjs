import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeStudioExperienceMode,
  studioToolForProject,
  summarizeStudioProjects
} from "../lib/studio-workspace.mjs";

test("Studio A defaults to a safe beginner experience", () => {
  assert.equal(normalizeStudioExperienceMode("ADVANCED"), "ADVANCED");
  assert.equal(normalizeStudioExperienceMode("expert"), "BEGINNER");
  assert.equal(normalizeStudioExperienceMode(null), "BEGINNER");
});

test("Studio A project dashboard sends existing projects to the existing editors", () => {
  const projects = [
    { id: "record", type: "QUICK_RECORD", status: "READY", currentVersion: 4, takes: [{ id: "take" }], updatedAt: "2026-09-07T12:00:00Z" },
    { id: "new-record", type: "VOICE_TRACK", status: "DRAFT", currentVersion: 1, takes: [], updatedAt: "2026-09-07T13:00:00Z" },
    { id: "mix", type: "MULTITRACK", status: "SUBMITTED", currentVersion: 3, updatedAt: "2026-09-07T14:00:00Z" }
  ];
  const summary = summarizeStudioProjects(projects);

  assert.equal(studioToolForProject(projects[0]), "waveform");
  assert.equal(studioToolForProject(projects[1]), "record");
  assert.equal(studioToolForProject(projects[2]), "multitrack");
  assert.deepEqual({ total: summary.total, quickRecord: summary.quickRecord, multitrack: summary.multitrack, ready: summary.ready }, { total: 3, quickRecord: 2, multitrack: 1, ready: 2 });
  assert.deepEqual(summary.recent.map((project) => project.id), ["mix", "new-record", "record"]);
});

test("Studio A integrates one accessible workspace without duplicating protected systems", async () => {
  const [workspace, school, audioLab, waveform, multitrack, audioRoute, multitrackRoute, styles] = await Promise.all([
    readFile(new URL("../app/dashboard/school-radio/StudioWorkspaceClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/SchoolRadioClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/AudioLabClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/WaveformEditorClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/MultitrackStudioClient.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/audio-lab/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/school-radio/multitrack/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/school-radio/studio-workspace.module.css", import.meta.url), "utf8")
  ]);

  assert.match(school, /<StudioWorkspaceClient \/>/);
  assert.doesNotMatch(school, /<AudioLabClient \/>|<WaveformEditorClient \/>|<MultitrackStudioClient \/>/);
  assert.match(workspace, /role="tablist"/);
  assert.match(workspace, /role="tab"/);
  assert.match(workspace, /role="tabpanel"/);
  assert.match(workspace, /aria-selected/);
  assert.match(workspace, /ArrowLeft/);
  assert.match(workspace, /ArrowRight/);
  assert.match(workspace, /localStorage\.setItem\("ruvanas:studio-experience"/);
  assert.match(workspace, /<AudioLabClient/);
  assert.match(workspace, /<WaveformEditorClient/);
  assert.match(workspace, /<MultitrackStudioClient/);
  assert.match(audioLab, /project\.type !== "MULTITRACK"/);
  assert.match(waveform, /project\.type !== "MULTITRACK"/);
  assert.match(multitrack, /16 tracks/);
  assert.match(audioRoute, /requireActiveSchoolRadio/);
  assert.match(multitrackRoute, /requireActiveSchoolRadio/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(workspace, /\/api\/studio\/audio|\/api\/studio\/projects/);
});
