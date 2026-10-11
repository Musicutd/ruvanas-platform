import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  PrivatePreviewCodeError,
  issuePrivatePreviewCode,
  revokePrivatePreviewCodes
} from "@/lib/private-preview-codes.mjs";
import { isPrivatePreviewAdmin, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;
const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive"
});

function json(body, status) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

async function readTargetEmail(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return null;
  const advertised = request.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_BODY_BYTES)) return null;
  const reader = request.body?.getReader?.();
  if (!reader) return null;
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!body || Array.isArray(body) || typeof body !== "object" ||
      Object.keys(body).length !== 1 || typeof body.email !== "string") return null;
    const email = body.email.trim().toLowerCase();
    return email.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}

async function handle(request, action) {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return json({ error: "Private preview is unavailable." }, 503);
  if (request.headers.get("origin") !== policy.previewOrigin) {
    return json({ error: "Request not permitted." }, 403);
  }

  try {
    const session = await getCurrentSession();
    if (session?.authMethod !== "PREVIEW_CODE" || !isPrivatePreviewAdmin(session.user, policy)) {
      return json({ error: "Access denied." }, 403);
    }
    const email = await readTargetEmail(request);
    if (!email) return json({ error: "Invalid request." }, 400);
    // Issuance requires the current allowlist. Revocation must still work after
    // a recipient has been removed, so its pending and active sessions can be ended.
    if (action === "issue" && !policy.allowedEmails.has(email)) {
      return json({ error: "Account unavailable." }, 404);
    }
    const target = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!target) return json({ error: "Account unavailable." }, 404);

    if (action === "issue") {
      const issued = await issuePrivatePreviewCode(prisma, {
        actorUserId: session.userId,
        targetUserId: target.id,
        policy
      });
      securityLog("info", "PRIVATE_PREVIEW_CODE_ISSUED", request, { actorUserId: session.userId });
      return json({ code: issued.code, expiresAt: issued.expiresAt.toISOString(), email: issued.user.email }, 201);
    }
    const revoked = await revokePrivatePreviewCodes(prisma, {
      actorUserId: session.userId,
      targetUserId: target.id,
      policy
    });
    securityLog("info", "PRIVATE_PREVIEW_CODE_ACCESS_REVOKED", request, { actorUserId: session.userId });
    return json(revoked, 200);
  } catch (caught) {
    if (caught instanceof PrivatePreviewCodeError) {
      if (caught.code === "FORBIDDEN") return json({ error: "Access denied." }, 403);
      if (caught.code === "TARGET_UNAVAILABLE") return json({ error: "Account unavailable." }, 404);
      if (caught.code === "TARGET_AUTH_POLICY") return json({ error: "Account sign-in policy blocks preview codes." }, 409);
    }
    securityLog("error", "PRIVATE_PREVIEW_CODE_ADMIN_UNAVAILABLE", request);
    return json({ error: "Private preview is unavailable." }, 503);
  }
}

export async function POST(request) {
  return handle(request, "issue");
}

export async function DELETE(request) {
  return handle(request, "revoke");
}
