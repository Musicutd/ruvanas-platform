import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { catalogueTestWorkerMode } from "../scripts/catalogue-test-worker.mjs";

test("diagnostic worker defaults to no streaming or database clients", () => {
  for (const args of [[], ["--check"]]) assert.equal(catalogueTestWorkerMode(args), "CHECK_ONLY");
  const result = spawnSync(process.execPath, ["scripts/catalogue-test-worker.mjs", "--check"], { cwd: new URL("..", import.meta.url), encoding: "utf8",
    env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {} });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).streamingStarted, false);
});
test("serve mode requires exact two opt-ins and rejects mixed flags", () => {
  const env = { RUVANAS_CATALOGUE_TEST_ALLOW_LIVE: "true", RUVANAS_CATALOGUE_TEST_STATION_ID: "cmvcnbwi20008hr23sd76psi8" };
  assert.equal(catalogueTestWorkerMode(["--serve-tests"], env), "SERVE_EXPLICIT_OWNER_TESTS");
  for (const args of [["--live"], ["--serve-tests", "--check"], ["--station", "other"]]) assert.throws(() => catalogueTestWorkerMode(args, env));
  assert.throws(() => catalogueTestWorkerMode(["--serve-tests"], {}));
  assert.throws(() => catalogueTestWorkerMode(["--serve-tests"], { ...env, RUVANAS_CATALOGUE_TEST_STATION_ID: "other" }));
});
test("default web startup never adds the catalogue test worker", async () => {
  const startup = await readFile(new URL("../scripts/start-production.mjs", import.meta.url), "utf8");
  assert.equal(startup.includes("catalogue-test-worker"), false);
  const docker = await readFile(new URL("../Dockerfile.catalogue-test-worker", import.meta.url), "utf8");
  assert.match(docker, /CMD \["node", "scripts\/catalogue-test-worker.mjs", "--check"\]/);
});
