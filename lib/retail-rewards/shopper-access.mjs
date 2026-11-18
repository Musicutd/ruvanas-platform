import { createHmac } from "node:crypto";
import { z } from "zod";
import { rewardIdSchema } from "./contracts.mjs";
import { rewardsDenied } from "./errors.mjs";
import { readShopperFeaturePolicy } from "./shopper-contracts.mjs";
import { pilotPreviewShopperAllowed } from "./pilot-preview-shopper.mjs";

export const SHOPPER_COOKIE = "ruvanas_rewards_shopper";
const TOKEN = /^[a-f0-9]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const date = z.date().refine(value => Number.isFinite(value.getTime()));
const version = z.number().int().positive().max(2_147_483_647);
const membershipSchema = z.object({
  id: rewardIdSchema, shopperId: rewardIdSchema, status: z.literal("ACTIVE"),
  source: z.literal("MANUAL_INTERNAL"), startsAt: date, expiresAt: date,
  revokedAt: z.null(), version
}).strict();
const sessionSchema = z.object({
  id: rewardIdSchema, shopperId: rewardIdSchema, tokenHash: z.string().regex(TOKEN),
  authVersion: version, createdAt: date, expiresAt: date, revokedAt: z.null(),
  shopper: z.object({ id: rewardIdSchema, status: z.literal("ACTIVE"), authVersion: version,
    membership: z.unknown() }).strict()
}).strict();
const sessionSelect = Object.freeze({
  id: true, shopperId: true, tokenHash: true, authVersion: true,
  createdAt: true, expiresAt: true, revokedAt: true,
  shopper: { select: { id: true, status: true, authVersion: true,
    membership: { select: { id: true, shopperId: true, status: true, source: true,
      startsAt: true, expiresAt: true, revokedAt: true, version: true } } } }
});

export function hashShopperSessionToken(token, secret) {
  if (typeof token !== "string" || !TOKEN.test(token) || typeof secret !== "string" || secret.length < 32) {
    throw new Error("Shopper session configuration is unavailable.");
  }
  return createHmac("sha256", secret).update(`ruvanas-rewards-shopper:v1:${token}`).digest("hex");
}

function currentTime(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Invalid clock.");
  return new Date(value.getTime());
}

/** Read-only shopper authentication. Never consult User, Session, an organisation
 * membership, client billing, the business cookie or private-preview roles. */
export async function requireRewardShopperAccess({ db, env = {}, token, clock = () => new Date() } = {}) {
  try {
    if (!readShopperFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
    if (typeof token !== "string" || !TOKEN.test(token)) return rewardsDenied("UNAUTHENTICATED");
    const tokenHash = hashShopperSessionToken(token, env.SESSION_SECRET);
    const started = currentTime(clock);
    const parsed = sessionSchema.safeParse(await db.rewardShopperSession.findUnique({ where: { tokenHash }, select: sessionSelect }));
    if (!parsed.success) return rewardsDenied("UNAUTHENTICATED");
    const row = parsed.data, now = currentTime(clock);
    if (now < started || row.tokenHash !== tokenHash || row.shopper.id !== row.shopperId ||
      row.authVersion !== row.shopper.authVersion || row.createdAt > now || row.expiresAt <= now ||
      row.expiresAt <= row.createdAt || row.expiresAt.getTime() - row.createdAt.getTime() > DAY_MS) {
      return rewardsDenied("UNAUTHENTICATED");
    }
    const membership = membershipSchema.safeParse(row.shopper.membership);
    if (!membership.success || membership.data.shopperId !== row.shopperId ||
      membership.data.startsAt > now || membership.data.expiresAt <= now ||
      membership.data.startsAt >= membership.data.expiresAt) return rewardsDenied("FORBIDDEN");
    if (!await pilotPreviewShopperAllowed({ db, env, shopperId: row.shopperId })) return rewardsDenied("FORBIDDEN");
    const final = currentTime(clock);
    if (final < now || row.expiresAt <= final || membership.data.expiresAt <= final) return rewardsDenied("UNAUTHENTICATED");
    if (!readShopperFeaturePolicy(env).enabled) return rewardsDenied("FEATURE_DISABLED");
    return Object.freeze({ ok: true, shopperId: row.shopperId, sessionId: row.id, membershipId: membership.data.id });
  } catch {
    return rewardsDenied("UNAVAILABLE");
  }
}
