import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { issuePrivatePreviewCode } from "../lib/private-preview-codes.mjs";
import { isPrivatePreviewAdmin, readPrivatePreviewPolicy } from "../lib/private-preview-policy.mjs";

const INVOCATION = "--issue-owner-code";
const CONFIRMATION = "ISSUE OWNER CODE FOR APPROVED ISOLATED PREVIEW DATABASE";

function configuredDatabase(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      Boolean(url.hostname && url.pathname && url.pathname !== "/");
  } catch {
    return false;
  }
}

// Pure preflight: a noninteractive invocation stops before examining any
// configuration, importing Prisma, or attempting a database connection.
export function privatePreviewOwnerBootstrapPreflight({
  args = [], stdinIsTTY = false, stdoutIsTTY = false, env = {}
} = {}) {
  if (!stdinIsTTY || !stdoutIsTTY) return { ok: false, code: "INTERACTIVE_TERMINAL_REQUIRED" };
  if (args.length !== 1 || args[0] !== INVOCATION) {
    return { ok: false, code: "EXPLICIT_INVOCATION_REQUIRED" };
  }
  if (env.RUVANAS_PRIVATE_PREVIEW_BOOTSTRAP_APPROVED !== "1") {
    return { ok: false, code: "OPERATOR_APPROVAL_REQUIRED" };
  }
  const policy = readPrivatePreviewPolicy(env);
  if (!policy.enabled || !policy.valid || !policy.adminEmail) {
    return { ok: false, code: "PRIVATE_PREVIEW_CONFIG_UNAVAILABLE" };
  }
  if (!configuredDatabase(env.DATABASE_URL)) {
    return { ok: false, code: "DATABASE_CONFIG_UNAVAILABLE" };
  }
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) {
    return { ok: false, code: "SESSION_CONFIG_UNAVAILABLE" };
  }
  return { ok: true, policy };
}

async function run() {
  const preflight = privatePreviewOwnerBootstrapPreflight({
    args: process.argv.slice(2),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    env: process.env
  });
  if (!preflight.ok) {
    process.stderr.write(`Owner preview bootstrap refused: ${preflight.code}.\n`);
    process.exitCode = 1;
    return;
  }

  // The operator must verify the database is an approved isolated preview
  // database; its URL and the session secret are never displayed or logged.
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let confirmed = false;
  try {
    const answer = await prompt.question(`Type exactly '${CONFIRMATION}' to issue the first owner code: `);
    confirmed = answer === CONFIRMATION;
  } finally {
    prompt.close();
  }
  if (!confirmed || !process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Owner preview bootstrap cancelled.\n");
    process.exitCode = 1;
    return;
  }

  let database;
  let issued;
  try {
    // Import only after terminal, configuration, and human confirmation gates.
    const { PrismaClient } = await import("@prisma/client");
    database = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: []
    });
    const actor = await database.user.findUnique({
      where: { email: preflight.policy.adminEmail },
      select: { id: true, email: true, role: true }
    });
    if (!isPrivatePreviewAdmin(actor, preflight.policy)) {
      process.stderr.write("Owner preview bootstrap refused: OWNER_ACCOUNT_UNAVAILABLE.\n");
      process.exitCode = 1;
      return;
    }
    issued = await issuePrivatePreviewCode(database, {
      actorUserId: actor.id,
      targetUserId: actor.id,
      policy: preflight.policy,
      secret: process.env.SESSION_SECRET
    });
  } catch {
    process.stderr.write("Owner preview bootstrap failed without displaying a code.\n");
    process.exitCode = 1;
    return;
  } finally {
    if (database) {
      try {
        await database.$disconnect();
      } catch {
        process.stderr.write("Owner preview bootstrap database cleanup could not be verified.\n");
        process.exitCode = 1;
      }
    }
  }

  if (process.exitCode || !process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Owner preview code was not displayed. Reissue from an approved interactive session if needed.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("One-use owner code (shown once; expires after 24 hours):\n");
  process.stdout.write(`${issued.code}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await run();
}
