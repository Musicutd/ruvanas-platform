import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server.js";
import { validateAudioUpload } from "../lib/audio-validation.mjs";
import { createDefaultEditDecision } from "../lib/audio-lab.mjs";
import { canDeleteUncommittedCorrectionsRecording } from "../lib/corrections-recording-cleanup.mjs";
import { MAX_CORRECTIONS_RECORDING_BYTES } from "../lib/request-size-policy.mjs";
import { runSerializableTransaction } from "../lib/transaction-retry.mjs";

const routeUrl = new URL("../app/api/corrections/contributor/recordings/route.js", import.meta.url);
const baseUrl = "https://fictional-studio.example.invalid";
const access = {
  session: {
    id: "fictional-session", organisationId: "fictional-org", projectId: "fictional-project",
    supervisorUserId: "fictional-supervisor", facilityId: "fictional-facility",
    contributorId: "fictional-contributor"
  },
  entitlements: { storageLimitGb: 1 }
};

// Execute the actual route body, substituting only its import dependencies.
// No database/storage client is constructed, and no HTTP server is started.
async function loadPost(fixture) {
  const modules = {
    "node:crypto": { createHash, randomUUID },
    "@aws-sdk/client-s3": { DeleteObjectCommand, PutObjectCommand },
    "next/server": { NextResponse },
    "@/lib/prisma": { prisma: fixture.database },
    "@/lib/r2": { getR2Storage: () => fixture.storage },
    "@/lib/audio-validation.mjs": { validateAudioUpload },
    "@/lib/audio-lab.mjs": { createDefaultEditDecision },
    "@/lib/corrections-contributor-auth": {
      currentCorrectionsContributorSession: async (capability) => {
        assert.equal(capability, "RECORD");
        return access;
      },
      sameOrigin: (request) => request.headers.get("origin") === baseUrl
    },
    "@/lib/corrections-studio-service": {
      assertCurrentCorrectionsContributorWrite: async (tx, selectedAccess, capability) => {
        assert.equal(tx.kind, "recording-write");
        assert.equal(selectedAccess, access);
        assert.equal(capability, "RECORD");
        fixture.events.push("authority-rechecked");
        if (fixture.mode === "rejected-write") {
          throw Object.assign(new Error("Your supervised Studio session is unavailable."), { status: 403 });
        }
        return access;
      }
    },
    "@/lib/corrections-recording-cleanup.mjs": { canDeleteUncommittedCorrectionsRecording },
    "@/lib/transaction-retry.mjs": { runSerializableTransaction },
    "@/lib/request-size-policy.mjs": { MAX_CORRECTIONS_RECORDING_BYTES }
  };
  const context = { Buffer, File, console: { error: (...args) => fixture.logs.push(args) } };
  const source = (await readFile(routeUrl, "utf8")).replace(
    /^import\s*\{([^}]+)\}\s+from\s+"([^"]+)";\s*$/gm,
    (declaration, names, specifier) => {
      assert.ok(Object.hasOwn(modules, specifier), `Unexpected route dependency: ${specifier}`);
      for (const name of names.split(",").map((value) => value.trim())) {
        assert.ok(Object.hasOwn(modules[specifier], name), `Unexpected route import: ${name}`);
        assert.ok(!Object.hasOwn(context, name), `Duplicate route binding: ${name}`);
        context[name] = modules[specifier][name];
      }
      return declaration.replace(/[^\n]/g, "");
    }
  ).replace(/^export /gm, "");
  assert.doesNotMatch(source, /^import\b/m, "Every route import must use the explicit synthetic dependency map.");
  return runInNewContext(`${source}\nPOST;`, context, { filename: routeUrl.pathname });
}

function createFixture(mode) {
  const fixture = {
    mode, events: [], logs: [], commands: [], objects: new Map(), transactions: [],
    committed: { media: [], takes: [], audits: [], projectStatus: "DRAFT" }
  };
  const aggregate = async () => ({ _sum: { sizeBytes: 0n } });
  fixture.database = {
    mediaAsset: { aggregate },
    $transaction: async (operation, options) => {
      fixture.transactions.push(options);
      if (options.isolationLevel === "Serializable") {
        const staged = { media: [], takes: [], audits: [], projectStatus: "DRAFT" };
        const tx = {
          kind: "recording-write",
          mediaAsset: {
            aggregate,
            create: async ({ data }) => {
              const row = { id: "fictional-media", ...data };
              staged.media.push(row);
              return row;
            }
          },
          audioTake: { create: async ({ data }) => {
            const row = { id: "fictional-take", ...data };
            staged.takes.push(row);
            return row;
          } },
          audioProject: { update: async ({ where, data }) => {
            assert.equal(where.id, access.session.projectId);
            staged.projectStatus = data.status;
            return { id: where.id, ...data };
          } },
          auditLog: { create: async ({ data }) => {
            staged.audits.push(data);
            return data;
          } }
        };
        // A rejected callback discards its staged writes. Only the first
        // scenario commits them before simulating loss of the acknowledgement.
        await operation(tx);
        fixture.events.push("recording-write-complete");
        if (mode === "committed-ack-lost") {
          fixture.committed = staged;
          fixture.events.push("recording-committed");
        }
        throw new Error("Synthetic recording transaction acknowledgement lost.");
      }
      assert.equal(options.isolationLevel, "ReadCommitted");
      return operation({
        $queryRaw: async (strings, ...values) => {
          assert.match(strings.join("?"), /FROM "AudioProject"[\s\S]*FOR UPDATE/);
          assert.deepEqual(values, [access.session.projectId, access.session.organisationId]);
          fixture.events.push("cleanup-project-lock");
          if (mode === "cleanup-unavailable") throw new Error("Synthetic cleanup database unavailable.");
          return [{ id: access.session.projectId }];
        },
        mediaAsset: { findUnique: async (query) => {
          const put = fixture.commands.find((command) => command instanceof PutObjectCommand);
          assert.deepEqual(query, { where: { storageKey: put.input.Key }, select: { id: true } });
          fixture.events.push("cleanup-exact-reference");
          const row = fixture.committed.media.find((media) => media.storageKey === query.where.storageKey);
          return row ? { id: row.id } : null;
        } }
      });
    }
  };
  fixture.storage = { bucketName: "fictional-bucket", client: { send: async (command) => {
    fixture.commands.push(command);
    assert.equal(command.input.Bucket, "fictional-bucket");
    if (command instanceof PutObjectCommand) {
      fixture.events.push("storage-put");
      fixture.objects.set(command.input.Key, Buffer.from(command.input.Body));
      return {};
    }
    assert.ok(command instanceof DeleteObjectCommand, "Only upload and cleanup commands are allowed.");
    fixture.events.push("storage-delete");
    assert.ok(fixture.objects.delete(command.input.Key), "Cleanup must target the exact uploaded object.");
    return {};
  } } };
  return fixture;
}

function syntheticWav() {
  const wav = Buffer.alloc(44 + 16_000);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24);
  wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

async function upload(fixture) {
  const POST = await loadPost(fixture);
  const form = new FormData();
  form.set("recording", new File([syntheticWav()], "fictional-recording.wav", { type: "audio/wav" }));
  form.set("durationMs", "1000");
  const response = await POST(new Request(`${baseUrl}/api/corrections/contributor/recordings`, {
    method: "POST", headers: { origin: baseUrl }, body: form
  }));
  assert.deepEqual(fixture.transactions.map((options) => options.isolationLevel), ["Serializable", "ReadCommitted"],
    "A non-retryable acknowledgement error must enter cleanup without repeating the write.");
  const put = fixture.commands[0];
  assert.ok(put instanceof PutObjectCommand);
  assert.match(put.input.Key, /^organisations\/fictional-org\/corrections-studio\/fictional-project\/[0-9a-f-]{36}\.wav$/);
  return { response, body: await response.json(), put };
}

test("the recording POST retains committed media, take, audit and bytes after a lost acknowledgement", async () => {
  const fixture = createFixture("committed-ack-lost");
  const { response, body, put } = await upload(fixture);
  assert.equal(response.status, 409);
  assert.deepEqual(body, { error: "The recording outcome could not be confirmed. Ask staff to check before trying again." });
  assert.equal(fixture.commands.length, 1, "A committed recording must never issue DELETE.");
  assert.deepEqual(fixture.objects.get(put.input.Key), syntheticWav());
  assert.equal(fixture.committed.media.length, 1);
  assert.equal(fixture.committed.media[0].storageKey, put.input.Key);
  assert.equal(fixture.committed.media[0].status, "READY");
  assert.equal(fixture.committed.takes.length, 1);
  assert.equal(fixture.committed.takes[0].mediaAssetId, fixture.committed.media[0].id);
  assert.equal(fixture.committed.takes[0].status, "READY");
  assert.equal(fixture.committed.audits.length, 1);
  assert.equal(fixture.committed.audits[0].action, "CORRECTIONS_STUDIO_RECORDING_CREATED");
  assert.equal(fixture.committed.audits[0].entityId, fixture.committed.takes[0].id);
  assert.equal(fixture.committed.projectStatus, "READY");
  assert.ok(fixture.events.indexOf("recording-committed") < fixture.events.indexOf("cleanup-project-lock"));
  assert.ok(fixture.events.indexOf("cleanup-project-lock") < fixture.events.indexOf("cleanup-exact-reference"));
});

test("the recording POST retains uploaded bytes when cleanup cannot consult the database", async () => {
  const fixture = createFixture("cleanup-unavailable");
  const { response, body, put } = await upload(fixture);
  assert.equal(response.status, 409);
  assert.deepEqual(body, { error: "The recording outcome could not be confirmed. Ask staff to check before trying again." });
  assert.equal(fixture.commands.length, 1, "An unavailable cleanup query must never issue DELETE.");
  assert.deepEqual(fixture.objects.get(put.input.Key), syntheticWav());
  assert.equal(fixture.committed.media.length, 0);
  assert.equal(fixture.committed.takes.length, 0);
  assert.equal(fixture.committed.audits.length, 0);
  assert.ok(fixture.events.includes("recording-write-complete"), "The intended transaction fault must occur after the route finishes its write.");
  assert.ok(fixture.events.includes("cleanup-project-lock"));
  assert.ok(!fixture.events.includes("cleanup-exact-reference"));
});

test("the recording POST deletes only its exact uploaded key after a rejected uncommitted write", async () => {
  const fixture = createFixture("rejected-write");
  const { response, body, put } = await upload(fixture);
  assert.equal(response.status, 403);
  assert.deepEqual(body, { error: "Your supervised Studio session is unavailable." });
  assert.equal(fixture.commands.length, 2);
  assert.ok(fixture.commands[1] instanceof DeleteObjectCommand);
  assert.equal(fixture.commands[1].input.Key, put.input.Key);
  assert.equal(fixture.commands[1].input.Bucket, put.input.Bucket);
  assert.equal(fixture.objects.size, 0);
  assert.equal(fixture.committed.media.length, 0);
  assert.equal(fixture.committed.takes.length, 0);
  assert.equal(fixture.committed.audits.length, 0);
  assert.ok(fixture.events.includes("authority-rechecked"));
  assert.ok(!fixture.events.includes("recording-write-complete"), "Rejected authority must abort the write callback.");
  assert.ok(fixture.events.indexOf("cleanup-exact-reference") < fixture.events.indexOf("storage-delete"));
});
