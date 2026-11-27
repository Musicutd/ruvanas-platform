import dns from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import { accountRecoveryEmailConfig } from "./account-recovery-email-config.mjs";
import { buildAccountRecoveryEmail } from "./account-recovery.mjs";
import { isPrivateNetworkAddress } from "./outgoing-webhooks.mjs";

const TOTAL_TIMEOUT_MS = 15_000;
const SMTP_TIMEOUT_MS = 8_000;
const safeError = (code) => Object.assign(new Error("Recovery email delivery is unavailable."), { code });

function singleRecipient(value) {
  return typeof value === "string" && value.length <= 254 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value);
}

export async function sendAccountRecoverySmtp({
  recovery, env = process.env, dnsLookup = dns.lookup,
  createTransport = nodemailer.createTransport, deliveryTimeoutMs = TOTAL_TIMEOUT_MS
}) {
  const config = accountRecoveryEmailConfig(env);
  if (!config.configured || config.transport !== "smtps") return { configured: false, skipped: true };
  const controller = new AbortController();
  let transport;
  let timer;
  let timedOut = false;
  const timeoutMs = Number.isInteger(deliveryTimeoutMs) && deliveryTimeoutMs > 0
    ? Math.min(deliveryTimeoutMs, TOTAL_TIMEOUT_MS) : TOTAL_TIMEOUT_MS;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(); // Nodemailer 10.6.1 closes the SMTP connection on abort.
      reject(safeError("EMAIL_PROVIDER_TIMEOUT"));
    }, timeoutMs);
  });
  const deliver = async () => {
    let message;
    try {
      message = buildAccountRecoveryEmail({ ...recovery, from: config.user });
      if (!singleRecipient(message.to)) throw new Error("Invalid recipient");
    } catch {
      throw safeError("EMAIL_PROVIDER_MESSAGE_INVALID");
    }
    let addresses;
    try {
      addresses = await dnsLookup(config.host, { family: 4, all: true, verbatim: true });
    } catch {
      throw safeError("EMAIL_PROVIDER_DNS_FAILED");
    }
    // Do not continue a late DNS lookup after the enclosing request timed out.
    if (controller.signal.aborted) throw safeError("EMAIL_PROVIDER_TIMEOUT");
    if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) =>
      isIP(item?.address) !== 4 || isPrivateNetworkAddress(item.address) || item.address.startsWith("192.88.99."))) {
      throw safeError("EMAIL_PROVIDER_ENDPOINT_BLOCKED");
    }
    transport = createTransport({
      host: addresses[0].address, port: config.port, secure: true,
      name: "ruvanas.com", pool: false, forceAuth: true,
      auth: { user: config.user, pass: config.password },
      tls: { servername: config.host, minVersion: "TLSv1.2", rejectUnauthorized: true },
      connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS, dnsTimeout: SMTP_TIMEOUT_MS, socketCloseTimeout: 0,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true, maxRecipients: 1
    });
    const result = await transport.sendMail({
      from: { address: config.user }, to: [{ address: message.to }],
      envelope: { from: config.user, to: [message.to] },
      subject: message.subject, text: message.text,
      messageId: `<recovery-${message.idempotencyKey}@ruvanas.com>`,
      disableFileAccess: true, disableUrlAccess: true, maxRecipients: 1,
      signal: controller.signal
    });
    if (controller.signal.aborted) throw safeError("EMAIL_PROVIDER_TIMEOUT");
    if (!Array.isArray(result?.accepted) || result.accepted.length !== 1 ||
        result.accepted[0] !== message.to || !Array.isArray(result.rejected) || result.rejected.length) {
      throw safeError("EMAIL_PROVIDER_REJECTED");
    }
    // SMTP acceptance is not confirmation of inbox delivery. There is no retry:
    // a disconnected or aborted send may already have been accepted remotely.
    return { configured: true, delivered: true, provider: "smtps", idempotencyKey: message.idempotencyKey };
  };
  try {
    return await Promise.race([deliver(), deadline]);
  } catch (error) {
    const known = new Set(["EMAIL_PROVIDER_MESSAGE_INVALID", "EMAIL_PROVIDER_DNS_FAILED", "EMAIL_PROVIDER_ENDPOINT_BLOCKED", "EMAIL_PROVIDER_REJECTED"]);
    throw safeError(timedOut ? "EMAIL_PROVIDER_TIMEOUT" : known.has(error?.code) ? error.code : "EMAIL_PROVIDER_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    controller.abort();
    try { transport?.close(); } catch { /* Never expose provider diagnostics. */ }
  }
}
