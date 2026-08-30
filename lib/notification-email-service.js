import dns from "node:dns/promises";
import { buildNotificationEmail, notificationEmailConfig } from "./notification-email.mjs";
import { isPrivateNetworkAddress } from "./outgoing-webhooks.mjs";

async function assertPublicEndpoint(endpoint, dnsLookup = dns.lookup) {
  const url = new URL(endpoint);
  let addresses;
  try {
    addresses = await dnsLookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw Object.assign(new Error("Email provider endpoint is unavailable."), { code: "EMAIL_PROVIDER_DNS_FAILED" });
  }
  if (!addresses.length || addresses.some((item) => isPrivateNetworkAddress(item.address))) {
    throw Object.assign(new Error("Email provider endpoint is unavailable."), { code: "EMAIL_PROVIDER_ENDPOINT_BLOCKED" });
  }
}

export function isNotificationEmailConfigured(env = process.env) {
  return notificationEmailConfig(env).configured === true;
}

async function sendWithProvider({ provider, event, recipientEmail, fetchImpl, dnsLookup }) {
  const message = buildNotificationEmail({ event, recipientEmail, from: provider.from });
  await assertPublicEndpoint(provider.endpoint, dnsLookup);
  let response;
  try {
    response = await fetchImpl(provider.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.token}`,
        "content-type": "application/json",
        "user-agent": "Ruvanas-Notifications/1.0",
        "x-idempotency-key": message.idempotencyKey
      },
      body: JSON.stringify(message),
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw Object.assign(new Error("Email provider request failed."), { code: "EMAIL_PROVIDER_UNAVAILABLE" });
  }
  if (!response.ok) throw Object.assign(new Error("Email provider rejected the request."), { code: `EMAIL_PROVIDER_HTTP_${response.status}` });
  return message;
}

function canSafelyFailOver(error) {
  return error?.code === "EMAIL_PROVIDER_DNS_FAILED" || ["EMAIL_PROVIDER_HTTP_502", "EMAIL_PROVIDER_HTTP_503", "EMAIL_PROVIDER_HTTP_504"].includes(error?.code);
}

export async function sendNotificationEmail({ event, recipientEmail, fetchImpl = fetch, dnsLookup = dns.lookup, env = process.env }) {
  const config = notificationEmailConfig(env);
  if (!config.configured) return { configured: false, skipped: true };
  try {
    const message = await sendWithProvider({ provider: config, event, recipientEmail, fetchImpl, dnsLookup });
    return { configured: true, delivered: true, provider: "primary", idempotencyKey: message.idempotencyKey };
  } catch (error) {
    if (!config.failover || !canSafelyFailOver(error)) throw error;
    const message = await sendWithProvider({ provider: config.failover, event, recipientEmail, fetchImpl, dnsLookup });
    return { configured: true, delivered: true, provider: "failover", idempotencyKey: message.idempotencyKey };
  }
}
