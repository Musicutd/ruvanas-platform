import { readFile, stat } from "node:fs/promises";
import { inventoryStudioAudioStorage } from "../lib/studio-audio-storage-inventory.mjs";

const allowed = new Set(["organisation-id", "limit", "final-cursor", "legacy-after-id", "previous-file"]);

function optionsFromArguments(argv) {
  const options = {};
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match || !allowed.has(match[1]) || options[match[1]] !== undefined) {
      throw new Error("Use only the documented, single-organisation inventory options.");
    }
    options[match[1]] = match[2];
  }
  if (!options["organisation-id"]) throw new Error("An organisation ID is required.");
  const limit = options.limit === undefined ? 100 : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("The page limit must be 1–200.");
  return {
    organisationId: options["organisation-id"], limit,
    finalCursor: options["final-cursor"] || null,
    legacyAfterId: options["legacy-after-id"] || null,
    previousFile: options["previous-file"] || null
  };
}

let database;
try {
  const { previousFile, ...options } = optionsFromArguments(process.argv.slice(2));
  let previous = null;
  if (previousFile) {
    const file = await stat(previousFile);
    if (!file.isFile() || file.size > 2 * 1024 * 1024) throw new Error("The previous report is not a bounded JSON file.");
    previous = JSON.parse(await readFile(previousFile, "utf8"));
  }
  // Do not initialize credentials or contact either system until the read-only
  // scope has been parsed. This command has no delete, abort or write mode.
  const [{ prisma }, { getR2Storage }] = await Promise.all([
    import("../lib/prisma.js"), import("../lib/r2.js")
  ]);
  database = prisma;
  const report = await inventoryStudioAudioStorage({
    database, storage: getR2Storage(), ...options, previous
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const safeMessages = new Set([
    "Use only the documented, single-organisation inventory options.",
    "An organisation ID is required.", "The page limit must be 1–200.",
    "The previous report is not a bounded JSON file.",
    "A single valid organisation ID is required.",
    "The previous report belongs to another inventory scope or schema.",
    "The object listing was truncated without a usable next cursor.",
    "The object listing exceeded the requested page bound."
  ]);
  process.stderr.write(`${JSON.stringify({ event: "studio_audio_inventory_failed",
    reason: safeMessages.has(error?.message) ? error.message : "A read-only inventory dependency failed." })}\n`);
  process.exitCode = 1;
} finally {
  if (database) await database.$disconnect();
}
