import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { parseProgrammeScheduleInput } from "../lib/advanced-scheduler.mjs";
import { parseSimplePlaylist } from "../lib/subscriber-playlists.mjs";
import { createMultitrackProjectSchema } from "../lib/multitrack-create-schema.mjs";
import { complimentaryAccessCreateSchema } from "../lib/complimentary-access-request.mjs";
import { ASSIGNMENT_TEMPLATE_CODES } from "../lib/school-learning.mjs";

const id = letter => `c${letter.repeat(24)}`;
async function actualSchema(path, name = "requestSchema") {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `Missing actual schema in ${path}`);
  const statement = source.slice(start).split(/;\r?\n/, 1)[0];
  // Only the schema declaration is evaluated. No route, auth, database,
  // processing or network function is imported or invoked.
  return new Function("z", `${statement}; return ${name};`)(z);
}

test("one exact patched Zod release is pinned in the manifest and lockfile", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies.zod, "4.6.6");
  assert.equal(lock.packages[""].dependencies.zod, "4.6.6");
  assert.equal(lock.packages["node_modules/zod"].version, "4.6.6");
  assert.equal(lock.packages["node_modules/zod"].integrity, "sha512-4UmzQUF5fxvfcYHlbjBmejU+w+hbDnWFx4aS8kBx7nPBHcO2SqPbpAG8snbdg+Xse4pRefR98hgjFgIMCI/UhA==");
});
test("oversized bounded arrays fail before parsing any element or allocating per-element issues", () => {
  for (const bound of [schema => schema.max(2), schema => schema.length(2)]) {
    let visited = 0;
    const element = z.preprocess(value => { visited++; return value; }, z.string());
    const result = bound(z.array(element)).safeParse(Array.from({ length: 32 }, () => null));
    assert.equal(result.success, false); assert.equal(visited, 0);
    assert.equal(result.error.issues.length, 1); assert.equal(result.error.issues[0].code, "too_big");
  }
});
test("oversized bounded maps and sets reject before walking entries", () => {
  let visited = 0;
  const key = z.preprocess(value => { visited++; return value; }, z.string());
  const map = z.map(key, z.number()).max(2), set = z.set(key).max(2);
  const mapResult = map.safeParse(new Map(Array.from({ length: 32 }, (_, i) => [`key-${i}`, null])));
  const setResult = set.safeParse(new Set(Array.from({ length: 32 }, (_, i) => `key-${i}`)));
  assert.equal(mapResult.success, false); assert.equal(setResult.success, false); assert.equal(visited, 0);
  assert.equal(mapResult.error.issues.length, 1); assert.equal(setResult.error.issues.length, 1);
});
test("actual audio-editor and multitrack record schemas preserve nested JSON state after migration", async () => {
  const state = { tracks: [{ id: "voice", gainDb: -3, muted: false }], clips: [], effects: { limiter: true }, sampleRate: 48000, selection: null };
  for (const path of [
    "app/api/school-radio/multitrack/projects/[projectId]/route.js",
    "app/api/corrections/contributor/multitrack/projects/[projectId]/route.js",
    "app/api/school-radio/audio-lab/projects/[projectId]/editor/route.js",
    "app/api/corrections/contributor/audio-lab/projects/[projectId]/editor/route.js"
  ]) {
    const schema = await actualSchema(path, path.includes("/corrections/") ? "schema" : "requestSchema"), input = { action: "SAVE", state, reason: "  Timing correction  " };
    const parsed = schema.safeParse(input); assert.equal(parsed.success, true, path);
    assert.deepEqual(parsed.data.state, state); assert.equal(parsed.data.reason, "Timing correction");
    assert.equal(schema.safeParse({ action: "SAVE", state: ["not a record"] }).success, false);
    assert.deepEqual(input.state, state);
  }
});
test("actual metrics dimensions retain string/number values and reject unexpected value types", async () => {
  const schema = await actualSchema("app/api/v1/integration-metrics/route.js", "dimensionSchema");
  assert.deepEqual(schema.parse({ campaign: "Autumn", completed: 12 }), { campaign: "Autumn", completed: 12 });
  assert.equal(schema.parse(null), null); assert.equal(schema.parse(undefined), undefined);
  assert.equal(schema.safeParse({ completed: { nested: "unexpected" } }).success, false);
  assert.equal(schema.safeParse({ completed: true }).success, false);
});
test("actual learning action preserves default empty roles and validates each role value", async () => {
  const source = await readFile(new URL("../app/api/school-radio/learning/route.js", import.meta.url), "utf8");
  const declarations = source.slice(source.indexOf("const criterionSchema ="), source.indexOf("const assignmentInclude ="));
  const schema = new Function("z", "ASSIGNMENT_TEMPLATE_CODES", `${declarations}; return actionSchema;`)(z, ASSIGNMENT_TEMPLATE_CODES);
  const input = { action: "SUBMIT_ASSIGNMENT", assignmentId: id("a"), contributorIds: [id("c")] };
  assert.deepEqual(schema.parse(input).projectRoles, {});
  assert.deepEqual(schema.parse({ ...input, projectRoles: { narrator: "  Voice  " } }).projectRoles, { narrator: "Voice" });
  assert.equal(schema.safeParse({ ...input, projectRoles: { narrator: 123 } }).success, false);
});
test("programme and playlist coercion/defaults and existing safety bounds remain compatible", () => {
  const input = { channelId: id("c"), name: "  Shop week  ", timezone: "Europe/Malta", items: [{ label: " Afternoon ",
    recurrence: "WEEKLY", sourceType: "MUSIC_MODE", sourceId: id("m"), weekday: "5", startTime: "14:00", durationMinutes: "30" }] };
  const parsed = parseProgrammeScheduleInput(input); assert.equal(parsed.ok, true);
  assert.equal(parsed.data.name, "Shop week"); assert.equal(parsed.data.items[0].durationMinutes, 30);
  assert.equal(parsed.data.items[0].weekday, 5); assert.equal(parsed.data.items[0].priority, 0);
  assert.equal(parseProgrammeScheduleInput({ ...input, items: Array.from({ length: 201 }, () => null) }).ok, false);
  const playlist = parseSimplePlaylist({ name: " Shop mix ", durationValue: "2", durationUnit: "HOURS", buildMode: "RANDOM_GENRE_POOL", genreCodes: ["pop"] }, new Set(["POP"]));
  assert.equal(playlist.ok, true); assert.equal(playlist.data.durationMinutes, 120); assert.deepEqual(playlist.data.genreCodes, ["POP"]);
  assert.equal(parseSimplePlaylist({ name: "Too many", durationValue: 1, durationUnit: "HOURS", buildMode: "GENRE_SEQUENCE", genreCodes: Array(49).fill("POP") }).ok, false);
});
test("optional form IDs and custom access validation still accept intended inputs and reject invalid ones", () => {
  const empty = createMultitrackProjectSchema.safeParse({ title: "New programme", programmeId: "", episodeId: "", studentGroupId: "" });
  assert.equal(empty.success, true); assert.equal(empty.data.programmeId, null); assert.equal(empty.data.episodeId, null);
  assert.equal(createMultitrackProjectSchema.safeParse({ title: "New programme", programmeId: "foreign-invalid-id" }).success, false);
  const direct = complimentaryAccessCreateSchema.safeParse({ planId: "public-plan-retail-focused", organisationId: id("o") });
  assert.equal(direct.success, true); assert.equal(direct.data.mode, "DIRECT");
  const missing = complimentaryAccessCreateSchema.safeParse({ planId: "public-plan-retail-focused" });
  assert.equal(missing.success, false); assert.equal(missing.error.issues[0].message, "Choose a client organisation.");
  assert.equal(complimentaryAccessCreateSchema.safeParse({ planId: "public-plan-retail-focused", organisationId: id("o"), role: "SUPER_ADMIN" }).success, false);
});
test("application validators do not retain vulnerable v3 imports or removed single-argument records", async () => {
  let consumers = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) await visit(url);
      else if (/\.(?:m?js)$/.test(entry.name)) {
        const source = await readFile(url, "utf8"); if (!source.includes('from "zod')) continue;
        consumers++;
        assert.doesNotMatch(source, /from\s+["']zod\/v3(?:\/|["'])/, url.pathname);
        assert.doesNotMatch(source, /z\.record\(\s*z\.unknown\(\)\s*\)/, url.pathname);
      }
    }
  }
  await visit(new URL("../lib/", import.meta.url)); await visit(new URL("../app/", import.meta.url));
  assert.ok(consumers > 100);
});
