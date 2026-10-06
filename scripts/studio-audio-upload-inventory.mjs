import { inventoryStudioAudioUploads } from "../lib/studio-audio-upload-inventory.mjs";

const allowed = new Set(["organisation-id", "limit", "quarantine-cursor", "multipart-cursor"]);

function optionsFromArguments(argv) {
  const options = {};
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match || !allowed.has(match[1]) || options[match[1]] !== undefined) {
      throw new Error("Use only the documented, single-organisation upload inventory options.");
    }
    options[match[1]] = match[2];
  }
  if (!options["organisation-id"]) throw new Error("An organisation ID is required.");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options["organisation-id"])) {
    throw new Error("A single valid organisation ID is required.");
  }
  const limit = options.limit === undefined ? 100 : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("The page limit must be 1–200.");
  if (options["quarantine-cursor"]?.length > 8192 || options["multipart-cursor"]?.length > 8192) {
    throw new Error("An inventory cursor is invalid.");
  }
  return { organisationId: options["organisation-id"], limit,
    quarantineCursor: options["quarantine-cursor"] || null,
    multipartCursor: options["multipart-cursor"] || null };
}

let database;
try {
  const options = optionsFromArguments(process.argv.slice(2));
  // Scope errors are rejected before initializing credentials. This command
  // has no abort, delete, database update or production deployment mode.
  const [{ prisma }, { getR2Storage }] = await Promise.all([
    import("../lib/prisma.js"), import("../lib/r2.js")
  ]);
  database = prisma;
  const report = await inventoryStudioAudioUploads({ database, storage: getR2Storage(), ...options });
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const safeMessages = new Set([
    "Use only the documented, single-organisation upload inventory options.",
    "An organisation ID is required.", "The page limit must be 1–200.",
    "A single valid organisation ID is required.", "The quarantine cursor is invalid.",
    "An inventory cursor is invalid.",
    "The multipart cursor is invalid.", "The multipart cursor belongs to another or invalid scope.",
    "The quarantine listing was truncated without a usable next cursor.",
    "The multipart listing was truncated without a usable next cursor.",
    "The quarantine listing exceeded its page bound.", "The multipart listing exceeded its page bound."
  ]);
  process.stderr.write(`${JSON.stringify({ event: "studio_audio_upload_inventory_failed",
    reason: safeMessages.has(error?.message) ? error.message : "A read-only inventory dependency failed." })}\n`);
  process.exitCode = 1;
} finally {
  if (database) await database.$disconnect();
}
