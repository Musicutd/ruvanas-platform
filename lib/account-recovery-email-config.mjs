import { notificationEmailConfig } from "./notification-email.mjs";

// Recovery alone may use this existing, explicitly approved mailbox. General
// notifications retain their existing HTTPS provider and configuration.
export function accountRecoveryEmailConfig(env = process.env) {
  const transport = env.ACCOUNT_RECOVERY_EMAIL_TRANSPORT;
  if (transport === undefined || transport === "" || transport === "https") {
    return { ...notificationEmailConfig(env), transport: "https" };
  }
  if (transport !== "smtps") return { configured: false, invalid: true, transport: null };
  const host = env.ACCOUNT_RECOVERY_SMTP_HOST;
  const user = env.ACCOUNT_RECOVERY_SMTP_USER;
  const password = env.ACCOUNT_RECOVERY_SMTP_PASSWORD;
  if (host !== "mail.ruvanas.com" || user !== "info@ruvanas.com" ||
      env.ACCOUNT_RECOVERY_SMTP_PORT !== "465" || typeof password !== "string" ||
      password.length === 0 || password.length > 1024 || /[\r\n\0]/.test(password)) {
    return { configured: false, invalid: true, transport: "smtps" };
  }
  return { configured: true, transport: "smtps", host, port: 465, user, password, from: user };
}
