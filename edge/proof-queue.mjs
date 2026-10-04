import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { signCorrectionsEdgeProof, verifyCorrectionsEdgeProof,
  validCorrectionsEdgeProofPayload } from "../lib/corrections-edge-proof.mjs";
import { canonicalEdgeJson } from "../lib/corrections-edge-canonical.mjs";

const ACK_DOMAIN = Buffer.from("ruvanas-inside-edge-proof-ack-v1\0", "utf8");
const HEX = /^[a-f0-9]{64}$/;

function acknowledgementBytes(record) {
  const { schema, nodeId, organisationId, facilityId, sequence, eventHash } = record;
  return Buffer.concat([ACK_DOMAIN, Buffer.from(canonicalEdgeJson({ schema, nodeId,
    organisationId, facilityId, sequence, eventHash }), "utf8")]);
}

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
      if (receipt?.schema !== 1 || receipt.nodeId !== this.scope.nodeId ||
          receipt.organisationId !== this.scope.organisationId || receipt.facilityId !== this.scope.facilityId ||
          !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1 || receipt.sequence > this.records.length ||
          !HEX.test(receipt.eventHash || "") || this.records[receipt.sequence - 1].eventHash !== receipt.eventHash ||
          !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature || "") ||
          !verify(null, acknowledgementBytes(receipt), this.publicKeyPem,
            Buffer.from(receipt.signature, "base64url"))) {
        throw new Error("The Edge proof acknowledgement failed integrity verification.");
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
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence < this.acknowledged ||
        sequence > this.records.length || this.records[sequence - 1]?.eventHash !== eventHash) {
      throw new Error("Cloud acknowledgement did not match the local proof journal.");
    }
    const receipt = { schema: 1, ...this.scope, sequence, eventHash };
    receipt.signature = sign(null, acknowledgementBytes(receipt), this.privateKeyPem).toString("base64url");
    const temporary = path.join(this.root, `proof-ack-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600, flag: "wx" });
    await rename(temporary, path.join(this.root, "proof-ack.json"));
    this.acknowledged = sequence;
  }
}
