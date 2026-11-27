import { prisma } from "./prisma";
import { createAccountRecoveryService } from "./account-recovery-service.mjs";
import { createAccountRecoveryHttp } from "./account-recovery-http.mjs";
import { sendAccountRecoveryEmail } from "./account-recovery-email-service";
import { consumeRateLimit, createRateLimitKey } from "./rate-limit";
import { getRequestId, securityLog } from "./security-log";

export function accountRecoveryHandlers(request) {
  return createAccountRecoveryHttp({ env: process.env, requestId: getRequestId,
    rateLimit: ({ request, operation, subject }) => consumeRateLimit({
      key: createRateLimitKey(`account-recovery-${operation}-${subject === undefined ? "ip" : "subject"}`, request, subject || ""),
      limit: subject === undefined ? 12 : operation === "request" ? 3 : 8,
      windowMs: (operation === "request" ? 15 : 30) * 60 * 1000 }),
    loadService: async () => createAccountRecoveryService({ db: prisma, env: process.env, sendEmail: sendAccountRecoveryEmail,
      log: event => securityLog("info", event, request) }) });
}
