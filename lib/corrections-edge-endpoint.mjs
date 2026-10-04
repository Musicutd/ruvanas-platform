// The browser may contact only an operator-provisioned, node-bound origin.
// It still verifies the Edge's separate proof key before sending a grant.
export function normaliseCorrectionsEdgeEndpoint(value, { allowLoopbackHttp = false } = {}) {
  if (typeof value !== "string" || value.length > 255 || value !== value.trim()) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowLoopbackHttp && loopback && url.protocol === "http:")) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      url.origin !== value.replace(/\/$/, "") || !url.hostname) return null;
  return url.origin;
}
