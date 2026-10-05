import { PrismaClient } from "@prisma/client";
import { checkInsideDemoBeforeMigrate } from "../lib/inside-demo-startup.mjs";
import { assertInsideDemoSyntheticDatabase } from "./assert-inside-demo-synthetic-database.mjs";

try {
  await checkInsideDemoBeforeMigrate({
    environment: process.env,
    createDatabase: () => new PrismaClient({ log: [] }),
    assertSyntheticDatabase: assertInsideDemoSyntheticDatabase
  });
  console.log("Inside demo pre-migration check passed: exact isolated resources and synthetic-only database.");
} catch {
  // Dependency failures can contain URLs or row values. Never print those
  // errors; a failed guard must stop the chained startup before migration.
  console.error("Inside demo pre-migration check refused startup. No migration or seed was run by this check.");
  process.exitCode = 1;
}
