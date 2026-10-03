import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertInsideDemoSyntheticDatabase } from "../../scripts/assert-inside-demo-synthetic-database.mjs";

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
  } finally {
    await db.$disconnect();
  }
});
