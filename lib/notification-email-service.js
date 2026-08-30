import dns from "node:dns/promises";
import { buildNotificationEmail, notificationEmailConfig } from "./notification-email.mjs";
import { isPrivateNetworkAddress } from "./outgoing-webhooks.mjs";

async function assertPublicEndpoint(endpoint) {
  const url = new URL(endpoint);
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
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

export async function sendNotificationEmail({ event, recipientEmail, fetchImpl = fetch, env = process.env }) {
  const config = notificationEmailConfig(env);
  if (!config.configured) return { configured: false, skipped: true };
  const message = buildNotificationEmail({ event, recipientEmail, from: config.from });
  await assertPublicEndpoint(config.endpoint);
  let response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
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
  return { configured: true, delivered: true, idempotencyKey: message.idempotencyKey };
}
