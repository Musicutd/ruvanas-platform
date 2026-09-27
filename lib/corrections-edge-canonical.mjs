// Kept free of Node APIs so the browser can verify a local Edge attestation
// using the same deterministic encoding as server-signed manifests.
export function canonicalEdgeJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Manifest numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalEdgeJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalEdgeJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Manifest contains an unsupported value.");
}
