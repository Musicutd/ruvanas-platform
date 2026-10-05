import { CorrectionsEdgeCache } from "./cache.mjs";
import { CorrectionsEdgeProofQueue } from "./proof-queue.mjs";
import path from "node:path";

function secureCloudUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("Secure Edge cloud sync requires HTTPS (or isolated loopback testing).");
  }
  return url;
}

export class CorrectionsEdgeSyncClient {
  constructor({ cloudUrl, machineCredential, root, cacheKey, publicKeyPem, proofPrivateKeyPem, scope, fetchImpl = fetch, now }) {
    this.base = secureCloudUrl(cloudUrl);
    if (!machineCredential || !machineCredential.startsWith(`rve.${scope.nodeId}.`)) throw new Error("Use this node's scoped machine credential.");
    this.credential = machineCredential;
    this.fetchImpl = fetchImpl;
    this.proofQueue = proofPrivateKeyPem ? new CorrectionsEdgeProofQueue({
      root: path.join(root, "proof"), privateKeyPem: proofPrivateKeyPem, scope }) : null;
    this.cache = new CorrectionsEdgeCache({ root, key: cacheKey, publicKeyPem, scope, now,
      fetchMedia: async (item) => {
        const response = await this.request(`/api/corrections/edge/media/${encodeURIComponent(item.mediaAssetId)}`);
        const length = Number(response.headers.get("content-length"));
        if (!response.ok || (Number.isFinite(length) && length !== item.sizeBytes)) {
          throw new Error("Cloud rejected protected Edge media or returned a mismatched size.");
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== item.sizeBytes) throw new Error("Cloud media transfer was incomplete.");
        return bytes;
      } });
  }

  async request(path, body) {
    const url = new URL(path, this.base);
    const response = await this.fetchImpl(url, { method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: { authorization: `Bearer ${this.credential}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if ([401, 403].includes(response.status)) await this.cache.suspend("CLOUD_REJECTED");
    return response;
  }

  async initialise() {
    let active;
    let cacheError;
    try { active = await this.cache.initialise(); }
    catch (error) { cacheError = error; }
    if (this.proofQueue) await this.proofQueue.initialise();
    if (cacheError) throw cacheError;
    return active;
  }

  async uploadProof() {
    if (!this.proofQueue) return 0;
    let uploaded = 0;
    for (let batch = 0; batch < 10; batch += 1) {
      const records = this.proofQueue.pending(100);
      if (!records.length) break;
      const response = await this.request("/api/corrections/edge/proof", { records });
      if (!response.ok) throw new Error(`Edge proof reconciliation rejected (${response.status}).`);
      const receipt = await response.json();
      if (receipt.acknowledgedSequence !== records.at(-1).sequence ||
          receipt.acknowledgedHash !== records.at(-1).eventHash) {
        throw new Error("Cloud Edge proof acknowledgement did not match the signed journal.");
      }
      await this.proofQueue.acknowledge(receipt.acknowledgedSequence, receipt.acknowledgedHash);
      uploaded += records.length;
    }
    return uploaded;
  }

  async sync({ softwareVersion = "c8-development" } = {}) {
    const pendingProofCount = this.proofQueue?.pendingCount || 0;
    const heartbeat = await this.request("/api/corrections/edge/heartbeat", { softwareVersion,
      storageHealth: "HEALTHY", syncStatus: "SYNCING", pendingProofCount,
      cachedContentCount: this.cache.active?.payload.content.length || 0 });
    if (!heartbeat.ok) throw new Error(`Edge heartbeat rejected (${heartbeat.status}).`);
    const manifestResponse = await this.request("/api/corrections/edge/manifest");
    if (!manifestResponse.ok) throw new Error(`Edge manifest rejected (${manifestResponse.status}).`);
    const result = await this.cache.sync(await manifestResponse.json());
    const active = this.cache.active;
    const receipt = await this.request("/api/corrections/edge/sync", { sequence: active.payload.sequence,
      version: active.version, downloaded: result.downloaded,
      reused: result.unchanged ? active.payload.content.length : result.reused });
    if (!receipt.ok) throw new Error(`Edge sync receipt rejected (${receipt.status}).`);
    await this.cache.resumeAfterCloudValidation();
    const proofUploaded = await this.uploadProof();
    return { ...result, proofUploaded, pendingProofCount: this.proofQueue?.pendingCount || 0 };
  }
}
