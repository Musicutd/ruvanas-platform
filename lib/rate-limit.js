import crypto from "crypto";
import { prisma } from "./prisma";
import { getClientAddress } from "./security-log";

function hashIdentifier(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createRateLimitKey(scope, request, subject = "") {
  const identifier = `${getClientAddress(request)}|${subject.trim().toLowerCase()}`;
  return `${scope}:${hashIdentifier(identifier)}`;
}

export async function consumeRateLimit({ key, limit, windowMs }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);

  const [bucket] = await prisma.$queryRaw`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStartedAt", "expiresAt", "updatedAt")
    VALUES (${key}, 1, ${now}, ${expiresAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${now}
        ELSE "RateLimitBucket"."windowStartedAt"
      END,
      "expiresAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt}
        ELSE "RateLimitBucket"."expiresAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "expiresAt"
  `;

  const allowed = bucket.count <= limit;
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000));

  return { allowed, remaining: Math.max(0, limit - bucket.count), retryAfterSeconds };
}

export async function clearRateLimit(key) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}
