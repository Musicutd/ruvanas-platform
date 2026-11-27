import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Duplex } from "node:stream";
import nodemailer from "nodemailer";
import { accountRecoveryEmailConfig } from "../lib/account-recovery-email-config.mjs";
import { notificationEmailConfig } from "../lib/notification-email.mjs";
import { sendAccountRecoverySmtp } from "../lib/account-recovery-smtp.mjs";
import { sendAccountRecoveryEmail } from "../lib/account-recovery-email-service.js";
import { createAccountRecoveryService } from "../lib/account-recovery-service.mjs";

const ENV = {
  ACCOUNT_RECOVERY_EMAIL_TRANSPORT: "smtps",
  ACCOUNT_RECOVERY_SMTP_HOST: "mail.ruvanas.com",
  ACCOUNT_RECOVERY_SMTP_PORT: "465",
  ACCOUNT_RECOVERY_SMTP_USER: "info@ruvanas.com",
  ACCOUNT_RECOVERY_SMTP_PASSWORD: "synthetic-mailbox-password-not-a-secret"
};
const HTTPS = {
  NOTIFICATION_EMAIL_ENDPOINT: "https://mail.example.invalid/send",
  NOTIFICATION_EMAIL_TOKEN: "synthetic-provider-token-longer-than-24",
  NOTIFICATION_EMAIL_FROM: "recovery@example.invalid",
  NOTIFICATION_EMAIL_FAILOVER_ENDPOINT: "https://backup.example.invalid/send",
  NOTIFICATION_EMAIL_FAILOVER_TOKEN: "synthetic-failover-token-longer-than-24",
  NOTIFICATION_EMAIL_FAILOVER_FROM: "backup@example.invalid"
};
const RECOVERY = {
  recipientEmail: "SHOP@EXAMPLE.INVALID", resetUrl: "https://ruvanas.com/reset-password#token=synthetic-only",
  tokenId: "synthetic-reset-id", expiresAt: new Date("2026-11-27T18:00:00Z")
};
function fixture(overrides = {}) {
  const state = { resolutions: [], transports: [], messages: [], closed: 0 };
  const args = {
    recovery: RECOVERY, env: ENV,
    dnsLookup: async (...args) => { state.resolutions.push(args); return [{ address: "8.8.8.8", family: 4 }, { address: "1.1.1.1", family: 4 }]; },
    createTransport: (options) => {
      state.transports.push(options);
      return {
        sendMail: async (message) => { state.messages.push(message); return { accepted: ["shop@example.invalid"], rejected: [] }; },
        close: () => { state.closed++; }
      };
    }, ...overrides
  };
  return { state, args };
}

test("recovery defaults to the unchanged HTTPS provider; SMTP cannot alter general notifications", () => {
  assert.deepEqual(accountRecoveryEmailConfig({}), { ...notificationEmailConfig({}), transport: "https" });
  assert.deepEqual(accountRecoveryEmailConfig(HTTPS), { ...notificationEmailConfig(HTTPS), transport: "https" });
  assert.deepEqual(accountRecoveryEmailConfig({ ...HTTPS, ACCOUNT_RECOVERY_EMAIL_TRANSPORT: "https" }), { ...notificationEmailConfig(HTTPS), transport: "https" });
  assert.equal(accountRecoveryEmailConfig({ ...ENV, ACCOUNT_RECOVERY_EMAIL_TRANSPORT: undefined }).configured, false);
  assert.equal(notificationEmailConfig(ENV).configured, false);
  assert.deepEqual(notificationEmailConfig({ ...ENV, ...HTTPS }), notificationEmailConfig(HTTPS));
});

test("SMTP configuration only accepts the explicitly approved mailbox, host and TLS port", () => {
  assert.deepEqual(accountRecoveryEmailConfig(ENV), {
    configured: true, transport: "smtps", host: "mail.ruvanas.com", port: 465,
    user: "info@ruvanas.com", password: ENV.ACCOUNT_RECOVERY_SMTP_PASSWORD, from: "info@ruvanas.com"
  });
  const invalid = [
    ["ACCOUNT_RECOVERY_EMAIL_TRANSPORT", "smtp"], ["ACCOUNT_RECOVERY_EMAIL_TRANSPORT", " smtps"],
    ["ACCOUNT_RECOVERY_SMTP_HOST", "attacker.example.invalid"], ["ACCOUNT_RECOVERY_SMTP_HOST", "127.0.0.1"],
    ["ACCOUNT_RECOVERY_SMTP_HOST", "mail.ruvanas.com."], ["ACCOUNT_RECOVERY_SMTP_HOST", "MAIL.RUVANAS.COM"],
    ["ACCOUNT_RECOVERY_SMTP_USER", "other@ruvanas.com"], ["ACCOUNT_RECOVERY_SMTP_USER", "info@ruvanas.com\r\nX: y"],
    ["ACCOUNT_RECOVERY_SMTP_PORT", "25"], ["ACCOUNT_RECOVERY_SMTP_PORT", "587"], ["ACCOUNT_RECOVERY_SMTP_PORT", 465],
    ["ACCOUNT_RECOVERY_SMTP_PASSWORD", ""], ["ACCOUNT_RECOVERY_SMTP_PASSWORD", undefined],
    ["ACCOUNT_RECOVERY_SMTP_PASSWORD", "secret\n"], ["ACCOUNT_RECOVERY_SMTP_PASSWORD", "a".repeat(1025)]
  ];
  for (const [key, value] of invalid) {
    const result = accountRecoveryEmailConfig({ ...ENV, ...HTTPS, [key]: value });
    assert.equal(result.configured, false, key);
    assert.equal(result.password, undefined);
    assert.equal(result.token, undefined);
  }
});

test("valid SMTP sends one text recovery message to a pinned IP with verified hostname TLS", async () => {
  const { state, args } = fixture();
  const result = await sendAccountRecoverySmtp(args);
  assert.equal(result.delivered, true);
  assert.equal(result.provider, "smtps");
  assert.deepEqual(state.resolutions, [["mail.ruvanas.com", { family: 4, all: true, verbatim: true }]]);
  assert.equal(state.transports.length, 1);
  const transport = state.transports[0];
  assert.equal(transport.host, "8.8.8.8");
  assert.equal(transport.port, 465);
  assert.equal(transport.secure, true);
  assert.deepEqual(transport.tls, { servername: "mail.ruvanas.com", minVersion: "TLSv1.2", rejectUnauthorized: true });
  assert.deepEqual(transport.auth, { user: "info@ruvanas.com", pass: ENV.ACCOUNT_RECOVERY_SMTP_PASSWORD });
  assert.equal(transport.forceAuth, true);
  for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout", "dnsTimeout"]) assert.equal(transport[key], 8000);
  assert.equal(transport.socketCloseTimeout, 0);
  for (const key of ["pool", "logger", "debug"]) assert.equal(transport[key], false);
  for (const key of ["disableFileAccess", "disableUrlAccess"]) assert.equal(transport[key], true);
  assert.equal(transport.maxRecipients, 1);
  assert.equal(state.messages.length, 1);
  const mail = state.messages[0];
  assert.deepEqual(mail.envelope, { from: "info@ruvanas.com", to: ["shop@example.invalid"] });
  assert.deepEqual(mail.from, { address: "info@ruvanas.com" });
  assert.deepEqual(mail.to, [{ address: "shop@example.invalid" }]);
  assert.equal(mail.subject, "Reset your Ruvanas password");
  assert.match(mail.text, /https:\/\/ruvanas.com\/reset-password#token=synthetic-only/);
  assert.match(mail.messageId, /^<recovery-[a-f0-9]{64}@ruvanas.com>$/);
  for (const key of ["cc", "bcc", "html", "attachments", "raw", "auth"]) assert.equal(mail[key], undefined);
  assert.equal(mail.disableFileAccess, true); assert.equal(mail.disableUrlAccess, true);
  assert.ok(mail.signal instanceof AbortSignal);
  assert.equal(state.closed, 1);
  assert.doesNotMatch(JSON.stringify(result), /password|synthetic-only|shop@example/);
});

test("recovery service selects SMTP without using HTTPS or accepting sender overrides", async () => {
  const { state, args } = fixture({ env: { ...ENV, ...HTTPS }, recovery: { ...RECOVERY, from: "attacker@example.invalid", to: ["other@example.invalid"] } });
  const result = await sendAccountRecoveryEmail({ ...args, fetchImpl: () => assert.fail("No HTTPS delivery for SMTP") });
  assert.equal(result.provider, "smtps");
  assert.deepEqual(state.messages[0].from, { address: "info@ruvanas.com" });
  assert.deepEqual(state.messages[0].envelope.to, ["shop@example.invalid"]);
});

test("incomplete SMTP config skips before DNS or transport creation and never falls back", async () => {
  for (const send of [sendAccountRecoverySmtp, sendAccountRecoveryEmail]) {
    const { state, args } = fixture({ env: { ...ENV, ...HTTPS, ACCOUNT_RECOVERY_SMTP_PASSWORD: "" } });
    assert.deepEqual(await send(args), { configured: false, skipped: true });
    assert.equal(state.resolutions.length, 0); assert.equal(state.transports.length, 0);
  }
});

test("all DNS results must be public IPv4; a mixed response cannot hide a private address", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.1.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "192.88.99.1", "198.51.100.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "2001:4860:4860::8888", "mail.ruvanas.com", undefined]) {
    const { state, args } = fixture({ dnsLookup: async () => [{ address: "8.8.8.8" }, { address }] });
    await assert.rejects(sendAccountRecoverySmtp(args), { code: "EMAIL_PROVIDER_ENDPOINT_BLOCKED" });
    assert.equal(state.transports.length, 0);
  }
  for (const addresses of [[], null, {}, [null]]) {
    const { state, args } = fixture({ dnsLookup: async () => addresses });
    await assert.rejects(sendAccountRecoverySmtp(args), { code: "EMAIL_PROVIDER_ENDPOINT_BLOCKED" });
    assert.equal(state.transports.length, 0);
  }
});

test("DNS failure and a late DNS answer never send a message", async () => {
  const failed = fixture({ dnsLookup: async () => { throw new Error("sensitive DNS diagnostic"); } });
  await assert.rejects(sendAccountRecoverySmtp(failed.args), { code: "EMAIL_PROVIDER_DNS_FAILED", message: "Recovery email delivery is unavailable." });
  assert.equal(failed.state.transports.length, 0);
  let resolveDns;
  const late = fixture({ dnsLookup: () => new Promise(resolve => { resolveDns = resolve; }), deliveryTimeoutMs: 10 });
  await assert.rejects(sendAccountRecoverySmtp(late.args), { code: "EMAIL_PROVIDER_TIMEOUT" });
  resolveDns([{ address: "8.8.8.8" }]);
  await delay(10);
  assert.equal(late.state.transports.length, 0);
});

test("recipient/header injection and invalid message cannot open an SMTP connection", async () => {
  for (const recipientEmail of ["first@example.invalid,second@example.invalid", "first,second@example.invalid", "display<shop@example.invalid>", "shop@example.invalid\r\nBcc: x@example.invalid", "shop@example.invalid;", "x".repeat(260) + "@example.invalid"]) {
    const { state, args } = fixture({ recovery: { ...RECOVERY, recipientEmail } });
    await assert.rejects(sendAccountRecoverySmtp(args), { code: "EMAIL_PROVIDER_MESSAGE_INVALID" });
    assert.equal(state.resolutions.length, 0);
    assert.equal(state.transports.length, 0);
  }
  const { state, args } = fixture({ recovery: { ...RECOVERY, resetUrl: "file:///private" } });
  await assert.rejects(sendAccountRecoverySmtp(args), { code: "EMAIL_PROVIDER_MESSAGE_INVALID" });
  assert.equal(state.transports.length, 0);
});

test("SMTP rejection, TLS failure, authentication failure and ambiguous disconnect never retry or leak diagnostics", async () => {
  for (const code of ["EAUTH", "ETLS", "ESOCKET", "ECONNECTION", "EENVELOPE", "EMESSAGE"]) {
    let calls = 0, closed = 0, created = 0;
    const { args } = fixture({ env: { ...ENV, ...HTTPS }, createTransport: () => {
      created++;
      return { sendMail: async () => { calls++; throw Object.assign(new Error("secret SMTP conversation and reset token"), { code, response: "sensitive" }); }, close: () => { closed++; } };
    } });
    await assert.rejects(sendAccountRecoveryEmail({ ...args, fetchImpl: () => assert.fail("Must not fail over") }), error => {
      assert.equal(error.code, "EMAIL_PROVIDER_UNAVAILABLE");
      assert.equal(error.message, "Recovery email delivery is unavailable.");
      assert.equal(error.cause, undefined); assert.equal(error.response, undefined);
      return true;
    });
    assert.equal(calls, 1); assert.equal(created, 1); assert.equal(closed, 1);
  }
});

test("accepted SMTP response must identify only the expected recipient", async () => {
  for (const response of [undefined, {}, { accepted: [], rejected: [] }, { accepted: ["other@example.invalid"], rejected: [] },
    { accepted: ["shop@example.invalid", "other@example.invalid"], rejected: [] }, { accepted: ["shop@example.invalid"], rejected: ["shop@example.invalid"] }]) {
    let closed = 0;
    const { args } = fixture({ createTransport: () => ({ sendMail: async () => response, close: () => { closed++; } }) });
    await assert.rejects(sendAccountRecoverySmtp(args), { code: "EMAIL_PROVIDER_REJECTED" });
    assert.equal(closed, 1);
  }
});

test("total timeout actively aborts an in-flight SMTP send and closes transport without a retry", async () => {
  let sent = 0, aborted = 0, closed = 0;
  const { args } = fixture({ deliveryTimeoutMs: 10, createTransport: () => ({
    sendMail: ({ signal }) => new Promise((_, reject) => {
      sent++;
      signal.addEventListener("abort", () => { aborted++; reject(new Error("provider abort details")); }, { once: true });
    }), close: () => { closed++; }
  }) });
  await assert.rejects(sendAccountRecoverySmtp(args), { code: "EMAIL_PROVIDER_TIMEOUT" });
  assert.equal(sent, 1); assert.equal(aborted, 1); assert.equal(closed, 1);
});

test("unexpected creation/cleanup errors cannot leak provider data", async () => {
  const failed = fixture({ createTransport: () => { throw new Error("secret-password"); } });
  await assert.rejects(sendAccountRecoverySmtp(failed.args), { code: "EMAIL_PROVIDER_UNAVAILABLE", message: "Recovery email delivery is unavailable." });
  const closed = fixture({ createTransport: () => ({ sendMail: async () => ({ accepted: ["shop@example.invalid"], rejected: [] }), close: () => { throw new Error("sensitive-close"); } }) });
  assert.equal((await sendAccountRecoverySmtp(closed.args)).delivered, true);
});

test("installed Nodemailer cancels a DATA-phase send and destroys its socket on the total deadline", async () => {
  let opened = 0, reachedData = false, bodyWritten = false;
  // In-memory SMTP peer only: no listener, DNS, TLS connection or real email.
  // The TLS options are separately asserted above; this tests the actual library's cancellation.
  const socket = new Duplex({
    read() {}, write(chunk, _encoding, callback) {
      const command = chunk.toString();
      callback();
      if (reachedData) { bodyWritten = true; return; } // Withhold final DATA acknowledgement.
      const response = command.startsWith("EHLO ") ? "250-local.test\r\n250 AUTH PLAIN\r\n"
        : command.startsWith("AUTH ") ? "235 Authenticated\r\n"
        : command.startsWith("MAIL FROM:") || command.startsWith("RCPT TO:") ? "250 OK\r\n"
        : command.startsWith("DATA") ? "354 Send data\r\n" : null;
      if (command.startsWith("DATA")) reachedData = true;
      if (response) setImmediate(() => { if (!socket.destroyed) socket.push(response); });
    }
  });
  socket.setTimeout = () => socket;
  const { args } = fixture({ deliveryTimeoutMs: 1500,
    createTransport: options => nodemailer.createTransport({ ...options, getSocket: (_options, callback) => {
      opened++;
      callback(null, { connection: socket, secured: true });
      setImmediate(() => { if (!socket.destroyed) socket.push("220 local.test ESMTP\r\n"); });
    } })
  });
  await assert.rejects(sendAccountRecoverySmtp(args), { code: "EMAIL_PROVIDER_TIMEOUT" });
  assert.equal(opened, 1); assert.equal(reachedData, true); assert.equal(bodyWritten, true);
  assert.equal(socket.destroyed, true);
});

test("service readiness accepts SMTP independently of HTTPS and invalid config denies before account lookup", async () => {
  let reads = 0;
  const service = createAccountRecoveryService({ env: ENV, db: { user: { findUnique: async () => { reads++; return null; } } },
    sendEmail: () => assert.fail("An absent account sends no email") });
  assert.equal((await service.request({ email: "absent@example.invalid" })).ok, true);
  assert.equal(reads, 1);
  const unavailable = createAccountRecoveryService({ env: { ...ENV, ACCOUNT_RECOVERY_SMTP_PASSWORD: "" },
    db: new Proxy({}, { get: () => assert.fail("No account lookup without delivery readiness") }),
    sendEmail: () => assert.fail("No email") });
  assert.deepEqual(await unavailable.request({ email: "absent@example.invalid" }), { ok: false, code: "DELIVERY_UNAVAILABLE" });
});

test("legacy HTTPS recovery preserves acceptance and safe failover behavior", async () => {
  const calls = [];
  const result = await sendAccountRecoveryEmail({ recovery: RECOVERY, env: HTTPS,
    dnsLookup: async () => [{ address: "8.8.8.8" }], createTransport: () => assert.fail("No SMTP"),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? { ok: false, status: 503 } : { ok: true, status: 202 }; }
  });
  assert.equal(result.provider, "failover"); assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["x-idempotency-key"], calls[1].options.headers["x-idempotency-key"]);
  assert.equal(calls[0].options.redirect, "error");
  let attempted = 0;
  await assert.rejects(sendAccountRecoveryEmail({ recovery: RECOVERY, env: HTTPS, dnsLookup: async () => [{ address: "8.8.8.8" }],
    fetchImpl: async () => { attempted++; throw new Error("ambiguous-network-result"); }
  }), { code: "EMAIL_PROVIDER_UNAVAILABLE" });
  assert.equal(attempted, 1);
});
