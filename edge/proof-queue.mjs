import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicKey } from "node:crypto";
import { signCorrectionsEdgeProof, verifyCorrectionsEdgeProof,
  validCorrectionsEdgeProofPayload } from "../lib/corrections-edge-proof.mjs";

export class CorrectionsEdgeProofQueue {
  constructor({ root, privateKeyPem, scope }) {
    if (!root || !privateKeyPem || !scope?.nodeId || !scope.organisationId || !scope.facilityId) {
      throw new Error("An Edge proof store, signing key and fixed facility scope are required.");
    }
    this.root = path.resolve(root);
    if (this.root === path.parse(this.root).root || this.root.length < path.parse(this.root).root.length + 12) {
      throw new Error("Choose a dedicated Edge proof directory.");
    }
    this.privateKeyPem = privateKeyPem;
    this.publicKeyPem = createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" });
    this.scope = scope;
    this.records = [];
    this.acknowledged = 0;
    this.pendingWrite = Promise.resolve();
    this.failure = null;
  }

  async initialise() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    let data = "";
    try { data = await readFile(path.join(this.root, "proof.jsonl"), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (data && !data.endsWith("\n")) throw new Error("The Edge proof journal ends in an incomplete record.");
    let previousHash = null;
    for (const line of data.split("\n").filter(Boolean)) {
      const record = JSON.parse(line);
      if (!validCorrectionsEdgeProofPayload(record.payload, this.scope) ||
          !verifyCorrectionsEdgeProof(record, this.publicKeyPem,
            { sequence: this.records.length + 1, previousHash })) {
        throw new Error("The append-only Edge proof journal failed integrity verification.");
      }
      this.records.push(record);
      previousHash = record.eventHash;
    }
    try {
      const receipt = JSON.parse(await readFile(path.join(this.root, "proof-ack.json"), "utf8"));
      if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 0 || receipt.sequence > this.records.length ||
          (receipt.sequence > 0 && this.records[receipt.sequence - 1].eventHash !== receipt.eventHash)) {
        throw new Error("The Edge proof acknowledgement does not match the journal.");
      }
      this.acknowledged = receipt.sequence;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  append(payload) {
    const task = this.pendingWrite.then(async () => {
      if (this.failure) throw this.failure;
      if (!validCorrectionsEdgeProofPayload(payload, this.scope)) throw new Error("Invalid Edge playback proof payload.");
      const sequence = this.records.length + 1;
      const previousHash = this.records.at(-1)?.eventHash || null;
      const record = signCorrectionsEdgeProof(sequence, previousHash, payload, this.privateKeyPem);
      await appendFile(path.join(this.root, "proof.jsonl"), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      this.records.push(record);
      return record;
    });
    this.pendingWrite = task.catch((error) => { this.failure = error; });
    return task;
  }

  pending(limit = 100) { return this.records.slice(this.acknowledged, this.acknowledged + limit); }
  get pendingCount() { return this.records.length - this.acknowledged; }

  async acknowledge(sequence, eventHash) {
    if (!Number.isSafeInteger(sequence) || sequence < this.acknowledged || sequence > this.records.length ||
        (sequence && this.records[sequence - 1]?.eventHash !== eventHash)) {
      throw new Error("Cloud acknowledgement did not match the local proof journal.");
    }
    const temporary = path.join(this.root, `proof-ack-${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify({ sequence, eventHash: eventHash || null }), { mode: 0o600 });
    await rename(temporary, path.join(this.root, "proof-ack.json"));
    this.acknowledged = sequence;
  }
}
