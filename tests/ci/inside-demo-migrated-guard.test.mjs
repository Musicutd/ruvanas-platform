import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertInsideDemoSyntheticDatabase } from "../../scripts/assert-inside-demo-synthetic-database.mjs";
import { checkInsideDemoBeforeMigrate } from "../../lib/inside-demo-startup.mjs";

const ciDatabase = process.env.GITHUB_ACTIONS === "true" &&
  process.env.DATABASE_URL === "postgresql://postgres:postgres@localhost:5432/ruvanas";

test("synthetic-only demo guard accepts only the fresh migrated CI database", async () => {
  assert.ok(ciDatabase, "This read-only check requires the exact disposable CI database.");

  const db = new PrismaClient();
  try {
    // The production migrations install fixed fictional QA fixtures. Run this
    // before any CI tests create their own organisations or operational rows.
    assert.equal(await db.organisation.count(), 3);
    assert.equal(await db.subscription.count(), 3);
    assert.equal(await db.organisationMediaProfile.count(), 1);
    await assertInsideDemoSyntheticDatabase(db);

    // Only the exact disposable CI connection above is used by the injected
    // client. This fictional Render identity exercises the startup wrapper,
    // not connectivity to Render or any customer database.
    const environment = {
      RUVANAS_ENVIRONMENT: "DEMO",
      RENDER_SERVICE_NAME: "ruvanas-inside-demo-20260930",
      RUVANAS_PUBLIC_URL: "https://ruvanas-inside-demo-20260930.onrender.com",
      DATABASE_URL: "postgresql://fictional:fictional@dpg-dauktubncjis73fbsdi0-a/ruvanas_inside_demo",
      INSIDE_DEMO_OWNER_PASSWORD: "fictional-demo-only-password"
    };
    const createDatabase = () => new PrismaClient({ log: [] });
    await checkInsideDemoBeforeMigrate({ environment, createDatabase,
      assertSyntheticDatabase: async (tx) => {
        const [mode] = await tx.$queryRaw`SELECT current_setting('transaction_read_only') AS read_only,
          current_setting('transaction_isolation') AS isolation`;
        assert.equal(mode.read_only, "on");
        assert.equal(mode.isolation, "serializable");
        await assertInsideDemoSyntheticDatabase(tx);
      }
    });
    // Even a future erroneous validator write must be blocked by PostgreSQL.
    // WHERE false ensures no rows would change even if that protection failed.
    await assert.rejects(checkInsideDemoBeforeMigrate({ environment, createDatabase,
      assertSyntheticDatabase: (tx) => tx.$executeRaw`UPDATE "Plan" SET "id" = "id" WHERE false`
    }), (error) => error.code === "P2010" && error.meta?.code === "25006");
    assert.equal(await db.organisation.count(), 3);
    await assertInsideDemoSyntheticDatabase(db);
  } finally {
    await db.$disconnect();
  }
});
