import { CorrectionsEdgeCache } from "./cache.mjs";

function secureCloudUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("Secure Edge cloud sync requires HTTPS (or isolated loopback testing).");
  }
  return url;
}

export class CorrectionsEdgeSyncClient {
  constructor({ cloudUrl, machineCredential, root, cacheKey, publicKeyPem, scope, fetchImpl = fetch, now }) {
    this.base = secureCloudUrl(cloudUrl);
    if (!machineCredential || !machineCredential.startsWith(`rve.${scope.nodeId}.`)) throw new Error("Use this node's scoped machine credential.");
    this.credential = machineCredential;
    this.fetchImpl = fetchImpl;
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
    return this.fetchImpl(url, { method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: { authorization: `Bearer ${this.credential}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  }

  async initialise() { return this.cache.initialise(); }

  async sync({ softwareVersion = "c8-development", pendingProofCount = 0 } = {}) {
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
    return result;
  }
}
