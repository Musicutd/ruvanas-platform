import { inventoryCorrectionsRecordingStorage, parseCorrectionsRecordingInventoryOptions } from "../lib/corrections-recording-storage-inventory.mjs";

let database;
try {
  // Scope and explicit operator opt-in must pass before initializing any
  // credentials. There is deliberately no delete, repair or broadcast mode.
  const options = parseCorrectionsRecordingInventoryOptions(process.argv.slice(2));
  const [{ PrismaClient }, { getR2Storage }] = await Promise.all([
    import("@prisma/client"), import("../lib/r2.js")
  ]);
  // The shared application's Prisma logger prints raw dependency failures
  // before a catch can redact them. This restricted operator owns a silent
  // client so failures cannot leak database/query details to its output.
  database = new PrismaClient({ log: [] });
  const report = await inventoryCorrectionsRecordingStorage({ database, storage: getR2Storage(), ...options });
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const safeMessages = new Set([
    "Explicit private read-only inventory opt-in is required.",
    "Use only the documented single-organisation inventory options.",
    "A single valid organisation ID is required.", "The page limit must be 1-200.",
    "A bounded storage continuation cursor is required.", "The selected organisation does not exist.",
    "The storage listing exceeded its page bound.", "The storage listing returned an out-of-scope object.",
    "The storage listing has no usable continuation cursor."
  ]);
  process.stderr.write(`${JSON.stringify({ event: "corrections_recording_inventory_failed",
    reason: safeMessages.has(error?.message) ? error.message : "A read-only inventory dependency failed." })}\n`);
  process.exitCode = 1;
} finally {
  if (database) {
    try { await database.$disconnect(); }
    catch { process.exitCode = 1; }
  }
}
