import crypto from "node:crypto";
import dns from "node:dns/promises";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isEmailAddress, notificationEmailConfig } from "../lib/notification-email.mjs";
import { isPrivateNetworkAddress } from "../lib/outgoing-webhooks.mjs";

export const INTEREST_PILLARS = Object.freeze([
  "Ruvanas Retail",
  "Ruvanas School",
  "Ruvanas Online Radio",
  "Ruvanas Health",
  "Ruvanas Faith",
  "Ruvanas Organisations",
  "Ruvanas Inside"
]);

const PAGE_URL = new URL("./index.html", import.meta.url);
const MAX_BODY_BYTES = 4096;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const IP_RATE_LIMIT = 600;
const EMAIL_RATE_LIMIT = 3;
const MAX_RATE_ENTRIES = 10_000;
const FORM_KEYS = ["email", "name", "organisation", "pillar"];
const INVALID_MESSAGE = "Please check the form and try again.";
const UNAVAILABLE_MESSAGE = "We couldn't register your interest right now. Please try again later.";

function sendJson(response, status, message) {
  if (response.destroyed || response.headersSent) return;
  const body = Buffer.from(JSON.stringify({ ok: status === 202, message }));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  response.end(body);
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && isEmailAddress(value) &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value);
}

function cleanText(value, maximumLength) {
  if (typeof value !== "string") return null;
  const text = value.trim().normalize("NFC");
  if (text.length < 2 || text.length > maximumLength || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return null;
  return text;
}

function isSameOriginPost(request) {
  if (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") return false;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") return false;
  try {
    const url = new URL(origin);
    const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (url.protocol === "https:" || isLocalHttp) &&
      url.origin === origin && url.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}

function parseInterest(body) {
  let input;
  try { input = JSON.parse(body); } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (Object.keys(input).sort().join("\u0000") !== FORM_KEYS.join("\u0000")) return null;
  const name = cleanText(input.name, 120);
  const organisation = cleanText(input.organisation, 160);
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!name || !organisation || !validEmail(email) || !INTEREST_PILLARS.includes(input.pillar)) return null;
  return { name, organisation, email, pillar: input.pillar };
}

function readLimitedBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    function cleanup() {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    }
    function finish(value, error) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.pause();
        finish(null);
      } else chunks.push(chunk);
    }
    function onEnd() { finish(Buffer.concat(chunks).toString("utf8")); }
    function onError(error) { finish(null, error); }
    function onAborted() { finish(null, new Error("Request aborted.")); }
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

function createRateLimiter(now, limit) {
  const hits = new Map();
  return (address) => {
    const currentTime = now();
    const key = address || "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= currentTime) {
      if (hits.size >= MAX_RATE_ENTRIES) {
        for (const [otherKey, otherEntry] of hits) {
          if (otherEntry.resetAt <= currentTime) hits.delete(otherKey);
        }
        if (hits.size >= MAX_RATE_ENTRIES) hits.delete(hits.keys().next().value);
      }
      entry = { count: 0, resetAt: currentTime + RATE_WINDOW_MS };
      hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count > limit;
  };
}

async function assertPublicEndpoint(endpoint, dnsLookup) {
  let addresses;
  try {
    addresses = await dnsLookup(new URL(endpoint).hostname, { all: true, verbatim: true });
  } catch {
    throw Object.assign(new Error("Provider DNS lookup failed."), { code: "PROVIDER_DNS_FAILED" });
  }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => isPrivateNetworkAddress(item.address))) {
    throw Object.assign(new Error("Provider endpoint is unavailable."), { code: "PROVIDER_ENDPOINT_BLOCKED" });
  }
}

async function sendWithProvider(provider, message, fetchImpl, dnsLookup) {
  await assertPublicEndpoint(provider.endpoint, dnsLookup);
  const response = await fetchImpl(provider.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${provider.token}`,
      "content-type": "application/json",
      "user-agent": "Ruvanas-Interest/1.0",
      "x-idempotency-key": message.idempotencyKey
    },
    body: JSON.stringify({ ...message, from: provider.from }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw Object.assign(new Error("Provider rejected the message."), { code: `PROVIDER_HTTP_${response.status}` });
  }
}

async function deliverInterest(interest, recipient, config, fetchImpl, dnsLookup) {
  const message = {
    to: recipient,
    subject: "Ruvanas — New interest registration",
    text: `Name: ${interest.name}\nOrganisation: ${interest.organisation}\nEmail: ${interest.email}\nPillar: ${interest.pillar}`,
    idempotencyKey: crypto.randomUUID()
  };
  try {
    await sendWithProvider(config, message, fetchImpl, dnsLookup);
  } catch (error) {
    if (!config.failover || !["PROVIDER_DNS_FAILED", "PROVIDER_HTTP_502", "PROVIDER_HTTP_503", "PROVIDER_HTTP_504"].includes(error?.code)) throw error;
    await sendWithProvider(config.failover, message, fetchImpl, dnsLookup);
  }
}

export function createInterestServer({ env = process.env, fetchImpl = fetch, dnsLookup = dns.lookup, now = Date.now } = {}) {
  const isIpRateLimited = createRateLimiter(now, IP_RATE_LIMIT);
  const isEmailRateLimited = createRateLimiter(now, EMAIL_RATE_LIMIT);
  const server = http.createServer(async (request, response) => {
    let pathname;
    try { pathname = new URL(request.url || "/", "http://localhost").pathname; }
    catch {
      sendJson(response, 404, "Not found.");
      return;
    }
    if ((request.method === "GET" || request.method === "HEAD") && (pathname === "/" || pathname === "/index.html")) {
      try {
        const page = await readFile(PAGE_URL);
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": page.length,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY"
        });
        response.end(request.method === "HEAD" ? undefined : page);
      } catch {
        sendJson(response, 503, UNAVAILABLE_MESSAGE);
      }
      return;
    }
    if (pathname !== "/api/interest") {
      sendJson(response, 404, "Not found.");
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      sendJson(response, 405, "Method not allowed.");
      return;
    }
    if (!isSameOriginPost(request)) {
      response.setHeader("connection", "close");
      sendJson(response, 403, INVALID_MESSAGE);
      return;
    }
    if (isIpRateLimited(request.socket.remoteAddress)) {
      response.setHeader("connection", "close");
      sendJson(response, 429, UNAVAILABLE_MESSAGE);
      return;
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"] || "")) {
      response.setHeader("connection", "close");
      sendJson(response, 415, INVALID_MESSAGE);
      return;
    }
    if (Number(request.headers["content-length"] || 0) > MAX_BODY_BYTES) {
      response.setHeader("connection", "close");
      sendJson(response, 413, INVALID_MESSAGE);
      return;
    }
    try {
      const body = await readLimitedBody(request);
      if (body === null) {
        response.setHeader("connection", "close");
        response.once("finish", () => request.destroy());
        sendJson(response, 413, INVALID_MESSAGE);
        return;
      }
      const interest = parseInterest(body);
      if (!interest) {
        sendJson(response, 400, INVALID_MESSAGE);
        return;
      }
      const emailKey = crypto.createHash("sha256").update(interest.email).digest("hex");
      if (isEmailRateLimited(emailKey)) {
        sendJson(response, 429, UNAVAILABLE_MESSAGE);
        return;
      }
      const config = notificationEmailConfig(env);
      const recipient = String(env.RUVANAS_INTEREST_RECIPIENT || "").trim().toLowerCase();
      if (!config.configured || config.failoverInvalid || !validEmail(recipient)) {
        sendJson(response, 503, UNAVAILABLE_MESSAGE);
        return;
      }
      await deliverInterest(interest, recipient, config, fetchImpl, dnsLookup);
      sendJson(response, 202, "Thank you. Your interest has been registered.");
    } catch {
      sendJson(response, 503, UNAVAILABLE_MESSAGE);
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  createInterestServer().listen(port, process.env.HOST || "0.0.0.0");
}
