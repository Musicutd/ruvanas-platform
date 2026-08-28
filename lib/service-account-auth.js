import { prisma } from "@/lib/prisma";
import {
  hashServiceApiKey,
  scopeAllows,
  serviceAccountIsUsable
} from "@/lib/enterprise-security.mjs";

function hashingSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }
  return secret;
}

export async function authenticateServiceAccount(request, requiredScope) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(rvsa_[a-f0-9]{12}_[a-f0-9]{64})$/i);

  if (!match) {
    return { ok: false, status: 401, error: "A valid service-account bearer key is required." };
  }

  const key = await prisma.apiKey.findUnique({
    where: { tokenHash: hashServiceApiKey(match[1], hashingSecret()) },
    include: {
      serviceAccount: { include: { organisation: true } }
    }
  });

  if (!key || !serviceAccountIsUsable(key.serviceAccount, key)) {
    return { ok: false, status: 401, error: "This service-account key is invalid or inactive." };
  }

  if (requiredScope && !scopeAllows(key.serviceAccount.scopes, requiredScope)) {
    return { ok: false, status: 403, error: "This service account does not have the required scope." };
  }

  const usedAt = new Date();
  await prisma.$transaction([
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: usedAt } }),
    prisma.serviceAccount.update({ where: { id: key.serviceAccountId }, data: { lastUsedAt: usedAt } })
  ]);

  return {
    ok: true,
    key,
    serviceAccount: key.serviceAccount,
    organisation: key.serviceAccount.organisation
  };
}
