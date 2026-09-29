import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CorrectionsEdgeProofQueue } from "../edge/proof-queue.mjs";
import { signCorrectionsEdgeProof, verifyCorrectionsEdgeProof } from "../lib/corrections-edge-proof.mjs";

test("C8D proof queue signs an append-only chain, replays safely and detects tampering", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ruvanas-c8-proof-"));
  const pair = generateKeyPairSync("ed25519");
  const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" });
  const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" });
  const scope = { nodeId: "node-one", organisationId: "org-one", facilityId: "facility-one" };
  const payload = { schema: 1, ...scope, zoneId: "zone-one", playerId: "player-one",
    eventId: randomUUID(), sessionId: randomUUID(), manifestVersion: "a".repeat(64),
    contentKey: `media-one:version-one:${"b".repeat(64)}`, programmingSource: "CORRECTIONS_CENTRAL",
    windowId: "window-one", overrideId: null, eventType: "STARTED", occurredAt: new Date().toISOString(), positionSeconds: 0 };
  const queue = new CorrectionsEdgeProofQueue({ root, privateKeyPem, scope });
  await queue.initialise();
  const first = await queue.append(payload);
  const second = await queue.append({ ...payload, eventId: randomUUID(), eventType: "COMPLETED", positionSeconds: 10 });
  assert.equal(verifyCorrectionsEdgeProof(first, publicKeyPem, { sequence: 1, previousHash: null }), true);
  assert.equal(verifyCorrectionsEdgeProof(second, publicKeyPem, { sequence: 2, previousHash: first.eventHash }), true);
  assert.equal(verifyCorrectionsEdgeProof({ ...second, payload: { ...second.payload, facilityId: "other" } },
    publicKeyPem, { sequence: 2, previousHash: first.eventHash }), false);
  assert.equal(queue.pendingCount, 2);
  await queue.acknowledge(1, first.eventHash);
  const resumed = new CorrectionsEdgeProofQueue({ root, privateKeyPem, scope });
  await resumed.initialise();
  assert.equal(resumed.pendingCount, 1);
  assert.equal(resumed.pending()[0].sequence, 2);
  await assert.rejects(queue.acknowledge(2, "0".repeat(64)));
  const forged = signCorrectionsEdgeProof(2, first.eventHash,
    { ...payload, eventId: randomUUID(), facilityId: "other" }, privateKeyPem);
  assert.equal(verifyCorrectionsEdgeProof(forged, publicKeyPem, { sequence: 2, previousHash: first.eventHash }), true);
  const journal = path.join(root, "proof.jsonl");
  const lines = (await readFile(journal, "utf8")).trim().split("\n");
  lines[1] = JSON.stringify({ ...second, eventHash: "0".repeat(64) });
  await writeFile(journal, `${lines.join("\n")}\n`);
  await assert.rejects(new CorrectionsEdgeProofQueue({ root, privateKeyPem, scope }).initialise(), /integrity/);
});
