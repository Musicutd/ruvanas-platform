import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const seedUrl = new URL("../scripts/seed-inside-demo.mjs", import.meta.url);

test("demo seed retains exact destination guards and rollback-only inventory validation", async () => {
  const source = await readFile(seedUrl, "utf8");
  assert.match(source, /RUVANAS_ENVIRONMENT !== "DEMO"/);
  assert.match(source, /RENDER_SERVICE_NAME !== DEMO_SERVICE_NAME/);
  assert.match(source, /url\.hostname !== DEMO_DATABASE_HOST/);
  assert.match(source, /url\.pathname !== `\/\$\{DEMO_DATABASE_NAME\}`/);
  assert.match(source, /password\.length < 20/);
  assert.ok(source.indexOf("throw new Error(\"Inside demo seed is restricted") < source.indexOf("new PrismaClient()"));
  assert.match(source, /validateInsideInventoryDemo\(db,/);
  assert.match(source, /update: \{ passwordHash \}/);
});

test("wrong demo service is refused before any database connection", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(seedUrl)], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      RUVANAS_ENVIRONMENT: "DEMO",
      RENDER_SERVICE_NAME: "not-the-inside-demo-service",
      DATABASE_URL: "postgresql://ignored:ignored@dpg-dauktubncjis73fbsdi0-a/ruvanas_inside_demo",
      INSIDE_DEMO_OWNER_PASSWORD: "synthetic-only-password-123456"
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Inside demo seed is restricted to its named service and database/);
});
