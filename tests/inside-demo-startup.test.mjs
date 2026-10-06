import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertInsideDemoStartupEnvironment, checkInsideDemoBeforeMigrate } from "../lib/inside-demo-startup.mjs";

const demoEnvironment = {
  RUVANAS_ENVIRONMENT: "DEMO",
  RENDER_SERVICE_NAME: "ruvanas-inside-demo-20260930",
  RUVANAS_PUBLIC_URL: "https://ruvanas-inside-demo-20260930.onrender.com",
  DATABASE_URL: "postgresql://fictional:fictional@dpg-dauktubncjis73fbsdi0-a/ruvanas_inside_demo",
  INSIDE_DEMO_OWNER_PASSWORD: "fictional-demo-only-password"
};

test("demo pre-migration guard accepts only its named isolated environment", () => {
  assert.doesNotThrow(() => assertInsideDemoStartupEnvironment(demoEnvironment));
  assert.doesNotThrow(() => assertInsideDemoStartupEnvironment({ ...demoEnvironment,
    DATABASE_URL: demoEnvironment.DATABASE_URL.replace("postgresql:", "postgres:") }));
  assert.doesNotThrow(() => assertInsideDemoStartupEnvironment({ ...demoEnvironment,
    DATABASE_URL: `${demoEnvironment.DATABASE_URL}?schema=public&sslmode=require` }));
});

test("wrong destination or storage/Edge configuration is refused before a database client exists", async (t) => {
  for (const [label, changes] of [
    ["production environment", { RUVANAS_ENVIRONMENT: "PRODUCTION" }],
    ["production service", { RENDER_SERVICE_NAME: "ruvanas-platform" }],
    ["production public URL", { RUVANAS_PUBLIC_URL: "https://ruvanas.com" }],
    ["other database host", { DATABASE_URL: "postgresql://fictional:fictional@127.0.0.1/ruvanas_inside_demo" }],
    ["other database name", { DATABASE_URL: "postgresql://fictional:fictional@dpg-dauktubncjis73fbsdi0-a/production" }],
    ["other database port", { DATABASE_URL: "postgresql://fictional:fictional@dpg-dauktubncjis73fbsdi0-a:5544/ruvanas_inside_demo" }],
    ["wrong protocol", { DATABASE_URL: "https://dpg-dauktubncjis73fbsdi0-a/ruvanas_inside_demo" }],
    ["malformed connection", { DATABASE_URL: "not-a-connection" }],
    ["missing connection", { DATABASE_URL: "" }],
    ["other schema", { DATABASE_URL: `${demoEnvironment.DATABASE_URL}?schema=other` }],
    ["host override", { DATABASE_URL: `${demoEnvironment.DATABASE_URL}?host=%2Ftmp%2Fother` }],
    ["credential file", { DATABASE_URL: `${demoEnvironment.DATABASE_URL}?sslidentity=%2Ftmp%2Fsecret` }],
    ["insecure SSL modifier", { DATABASE_URL: `${demoEnvironment.DATABASE_URL}?sslmode=disable` }],
    ["duplicate namespace", { DATABASE_URL: `${demoEnvironment.DATABASE_URL}?schema=public&schema=public` }],
    ["connection fragment", { DATABASE_URL: `${demoEnvironment.DATABASE_URL}#fragment` }],
    ["missing strong demo password", { INSIDE_DEMO_OWNER_PASSWORD: "short" }],
    ["storage credentials", { R2_SECRET_ACCESS_KEY: "fictional-forbidden-storage" }],
    ["Edge configuration", { CORRECTIONS_EDGE_ENABLED: "true" }],
    ["C8 lab configuration", { C8_SYNTHETIC_ONLY: "true" }]
  ]) {
    await t.test(label, async () => {
      let clients = 0;
      await assert.rejects(checkInsideDemoBeforeMigrate({
        environment: { ...demoEnvironment, ...changes },
        createDatabase: () => { clients += 1; }, assertSyntheticDatabase: async () => {}
      }), /Inside demo startup/);
      assert.equal(clients, 0);
    });
  }
});

test("synthetic preflight runs in a fresh PostgreSQL-enforced read-only transaction and disconnects", async () => {
  const calls = [];
  const tx = { $executeRaw: async (sql) => { calls.push(sql.join("?")); } };
  const db = {
    $transaction: async (operation, options) => {
      assert.deepEqual(options, { isolationLevel: "Serializable", maxWait: 20_000, timeout: 90_000 });
      calls.push("transaction");
      await operation(tx);
    },
    $disconnect: async () => { calls.push("disconnect"); }
  };
  await checkInsideDemoBeforeMigrate({ environment: demoEnvironment,
    createDatabase: () => { calls.push("client"); return db; },
    assertSyntheticDatabase: async (received) => { assert.equal(received, tx); calls.push("synthetic-guard"); }
  });
  assert.deepEqual(calls, ["client", "transaction", "SET TRANSACTION READ ONLY", "synthetic-guard", "disconnect"]);
});

test("unexpected data or uncertain database outcomes stop preflight and still disconnect", async () => {
  for (const atTransaction of [false, true]) {
    let disconnected = false;
    const failure = new Error("fictional-private-dependency-details");
    const db = {
      $transaction: async (operation) => {
        if (atTransaction) throw failure;
        await operation({ $executeRaw: async () => {} });
      },
      $disconnect: async () => { disconnected = true; }
    };
    await assert.rejects(checkInsideDemoBeforeMigrate({ environment: demoEnvironment,
      createDatabase: () => db, assertSyntheticDatabase: async () => { throw failure; }
    }), (error) => error === failure);
    assert.equal(disconnected, true);
  }
});

test("standalone pre-migration command returns a redacted failure and never launches migrations or seeding", async () => {
  const script = new URL("../scripts/check-inside-demo-before-migrate.mjs", import.meta.url);
  const source = await readFile(script, "utf8");
  assert.doesNotMatch(source, /spawn|exec\(|db:migrate|seed-inside-demo|console\.error\([^\"]*error/);
  const sentinel = "fictional-connection-detail-never-print";
  const result = spawnSync(process.execPath, [fileURLToPath(script)], {
    encoding: "utf8", timeout: 10_000, env: { ...process.env, ...demoEnvironment,
      DATABASE_URL: sentinel, RENDER_SERVICE_NAME: "ruvanas-platform" }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Inside demo pre-migration check refused startup\./);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(sentinel));
});
