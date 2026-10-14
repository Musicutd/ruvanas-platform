import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PrivatePreviewCodeError, redeemPrivatePreviewCode } from "@/lib/private-preview-codes.mjs";
import { privatePreviewDashboardRoute, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

const MAX_BODY_BYTES = 16 * 1024;
const CODE_ATTEMPTS = 10;
const CODE_WINDOW_MS = 15 * 60 * 1000;
const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive"
});

function json(body, status) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function formRedirect(reason) {
  const error = ["invalid", "rate-limited", "unavailable"].includes(reason) ? reason : "unavailable";
  return new Response(null, {
    status: 303,
    headers: { ...RESPONSE_HEADERS, location: `/preview-login?error=${error}` }
  });
}

async function boundedText(request) {
  const advertised = request.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_BODY_BYTES)) {
    throw new Error("invalid-body");
  }
  const reader = request.body?.getReader?.();
  if (!reader) throw new Error("invalid-body");
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => {});
      throw new Error("invalid-body");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

async function readCode(request, form) {
  const body = await boundedText(request);
  if (form) {
    const params = new URLSearchParams(body);
    if ([...params.keys()].some((key) => key !== "code") || params.getAll("code").length !== 1) {
      throw new Error("invalid-body");
    }
    return params.get("code");
  }
  const parsed = JSON.parse(body);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" ||
    Object.keys(parsed).length !== 1 || typeof parsed.code !== "string") {
    throw new Error("invalid-body");
  }
  return parsed.code;
}

export async function POST(request) {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled) return json({ error: "Not found." }, 404);
  if (!policy.valid) return json({ error: "Private preview is unavailable." }, 503);

  const contentType = request.headers.get("content-type") || "";
  const form = /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(contentType);
  const jsonRequest = /^application\/json(?:\s*;|$)/i.test(contentType);
  if (request.headers.get("origin") !== policy.previewOrigin) {
    return json({ error: "Request not permitted." }, 403);
  }
  if (!form && !jsonRequest) return json({ error: "Invalid access code." }, 415);

  try {
    const rateLimitKey = createRateLimitKey("private-preview-code", request);
    const limit = await consumeRateLimit({ key: rateLimitKey, limit: CODE_ATTEMPTS, windowMs: CODE_WINDOW_MS });
    if (!limit.allowed) {
      securityLog("warn", "PRIVATE_PREVIEW_CODE_RATE_LIMITED", request);
      return form ? formRedirect("rate-limited") : json({ error: "Too many attempts. Please try again later." }, 429);
    }

    let code;
    try {
      code = await readCode(request, form);
    } catch {
      return form ? formRedirect("invalid") : json({ error: "Invalid access code." }, 401);
    }

    const redeemed = await redeemPrivatePreviewCode(prisma, { code, policy });
    const recommendedDashboardRoute = privatePreviewDashboardRoute(redeemed.user, policy);
    if (!recommendedDashboardRoute) throw new Error("No permitted preview destination.");
    // The one-use code is committed as claimed before the normal session cookie is set.
    await setSessionCookie(redeemed.rawSessionToken, redeemed.expiresAt);
    securityLog("info", "PRIVATE_PREVIEW_CODE_REDEEMED", request);
    if (form) {
      return new Response(null, {
        status: 303,
        headers: { ...RESPONSE_HEADERS, location: recommendedDashboardRoute }
      });
    }
    return json({ success: true, recommendedDashboardRoute }, 200);
  } catch (caught) {
    if (caught instanceof PrivatePreviewCodeError && caught.code === "INVALID_CODE") {
      securityLog("warn", "PRIVATE_PREVIEW_CODE_REJECTED", request);
      return form ? formRedirect("invalid") : json({ error: "Invalid access code." }, 401);
    }
    securityLog("error", "PRIVATE_PREVIEW_CODE_UNAVAILABLE", request);
    return form ? formRedirect("unavailable") : json({ error: "Private preview is unavailable." }, 503);
  }
}
