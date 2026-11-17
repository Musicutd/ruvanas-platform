import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateNetworkAddress } from "./stream-source-health.mjs";

// DNS-only preflight. It never authenticates a source, fetches audio or starts
// a provider. The transport must independently resolve and pin its socket IP.
export function retailPublicAddress(address) {
  if (typeof address !== "string" || isPrivateNetworkAddress(address)) return false;
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 192 && (b === 0 || b === 2 || b === 88 && c === 99) ||
      a === 198 && (b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Permit global unicast only; exclude mapped IPv4, documentation, tunnelling
  // and special-purpose prefixes instead of treating all IPv6 as public.
  const host = address.toLowerCase();
  return /^[23][0-9a-f]{3}:/.test(host) && !/^2001:(?:0*:|0?db8:|0?0?[01][0-9a-f]:)/.test(host) && !host.startsWith("2002:");
}

function hostname(value) {
  if (typeof value !== "string" || value.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(value)) return null;
  const host = value.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || /\.(?:localhost|local|internal|invalid|test)$/.test(host)) return null;
  try {
    const parsed = new URL(`https://${host}`);
    if (parsed.hostname !== host || parsed.port || parsed.username || parsed.password) return null;
  } catch { return null; }
  return host;
}

async function resolvePublic(host, lookupImpl, timeoutMs) {
  if (!host) return "REJECTED";
  if (isIP(host)) return retailPublicAddress(host) ? "PUBLIC" : "REJECTED";
  let timer;
  try {
    const rows = await Promise.race([
      Promise.resolve().then(() => lookupImpl(host, { all: true, verbatim: true })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs); })
    ]);
    if (!Array.isArray(rows) || !rows.length || rows.length > 64) return "UNAVAILABLE";
    return rows.every(row => retailPublicAddress(row?.address)) ? "PUBLIC" : "REJECTED";
  } catch { return "UNAVAILABLE"; }
  finally { clearTimeout(timer); }
}

export async function inspectRetailSource(source, { lookupImpl = lookup, now = new Date(), timeoutMs = 2500 } = {}) {
  const checkedAt = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : null;
  const report = { checkedAt, sourceDns: "REJECTED", listenerDns: "REJECTED", sourceCredential: "NOT_TESTED", audioTested: false, ready: false, blockers: [] };
  if (!checkedAt || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 ||
    source?.providerKey !== "CENTOVA_CAST" || source?.outputCodec !== "MP3" ||
    !Number.isInteger(source.sourcePort) || source.sourcePort < 1 || source.sourcePort > 65535 ||
    source.sourcePort === 8282 || /^(?:ruvanas_test_radio|ruvanastestradio)$/i.test(source.centovaUsername || "")) {
    report.blockers.push("RETAIL_SOURCE_TARGET_REJECTED"); return report;
  }
  const host = hostname(source.serverHost);
  let listenerHost = null;
  try {
    const url = new URL(source.streamUrl);
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === "443") &&
      !/ruvanas_?test_?radio/i.test(url.hostname)) listenerHost = hostname(url.hostname);
  } catch {}
  [report.sourceDns, report.listenerDns] = await Promise.all([
    resolvePublic(host, lookupImpl, timeoutMs), resolvePublic(listenerHost, lookupImpl, timeoutMs)
  ]);
  if (report.sourceDns !== "PUBLIC") report.blockers.push(`RETAIL_SOURCE_DNS_${report.sourceDns}`);
  if (report.listenerDns !== "PUBLIC") report.blockers.push(`RETAIL_LISTENER_DNS_${report.listenerDns}`);
  report.ready = report.blockers.length === 0;
  return report;
}
