import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { hashShopperSessionToken, requireRewardShopperAccess, SHOPPER_COOKIE } from "../lib/retail-rewards/shopper-access.mjs";

const NOW = new Date("2026-11-14T12:00:00Z"), TOKEN = "ab".repeat(32), SECRET = "synthetic-shopper-secret-32-characters";
const ENV = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true", SESSION_SECRET: SECRET };
function fixture() {
  const row = { id: "shopper-session", shopperId: "shopper-one", tokenHash: hashShopperSessionToken(TOKEN, SECRET),
    authVersion: 2, createdAt: new Date("2026-11-14T11:00:00Z"), expiresAt: new Date("2026-11-15T11:00:00Z"), revokedAt: null,
    shopper: { id: "shopper-one", status: "ACTIVE", authVersion: 2, membership: { id: "shopper-membership", shopperId: "shopper-one",
      status: "ACTIVE", source: "MANUAL_INTERNAL", startsAt: new Date("2026-11-01T00:00:00Z"),
      expiresAt: new Date("2026-12-01T00:00:00Z"), revokedAt: null, version: 1 } } };
  const calls = [];
  const db = { rewardShopperSession: { async findUnique(input) { calls.push(input); return structuredClone(row); } } };
  return { row, calls, db, run: patch => requireRewardShopperAccess({ db, env: ENV, token: TOKEN, clock: () => NOW, ...patch }) };
}

test("shopper tokens are independently domain-separated from business sessions", () => {
  const shopperHash = hashShopperSessionToken(TOKEN, SECRET);
  assert.equal(SHOPPER_COOKIE, "ruvanas_rewards_shopper");
  assert.notEqual(shopperHash, createHmac("sha256", SECRET).update(TOKEN).digest("hex"));
  assert.equal(shopperHash, createHmac("sha256", SECRET).update(`ruvanas-rewards-shopper:v1:${TOKEN}`).digest("hex"));
  for (const token of [TOKEN.toUpperCase(), TOKEN.slice(2), ` ${TOKEN}`, null]) assert.throws(() => hashShopperSessionToken(token, SECRET));
  assert.throws(() => hashShopperSessionToken(TOKEN, "short"));
});

test("disabled or malformed shopper gates do zero token, clock or database work", async () => {
  for (const env of [{}, { ...ENV, RUVANAS_RETAIL_REWARDS_ENABLED: "false" }, { ...ENV, RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "1" }]) {
    const result = await requireRewardShopperAccess({ env, db: new Proxy({}, { get() { throw new Error("read forbidden"); } }),
      clock: () => { throw new Error("clock forbidden"); } });
    assert.equal(result.code, "FEATURE_DISABLED");
  }
});

test("valid manual shopper access returns only internal shopper identity and performs no writes", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { ok: true, shopperId: "shopper-one", sessionId: "shopper-session", membershipId: "shopper-membership" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].where.tokenHash, f.row.tokenHash);
  assert.ok(!JSON.stringify(f.calls).includes(TOKEN));
});

test("business-shaped context or token cannot stand in for shopper session", async () => {
  const f = fixture();
  for (const token of [undefined, "business-session", TOKEN.toUpperCase()]) assert.equal((await f.run({ token })).code, "UNAUTHENTICATED");
  assert.equal(f.calls.length, 0);
  const result = await f.run({ db: { rewardShopperSession: { findUnique: async () => ({ id: "business", userId: "owner", role: "SUPER_ADMIN" }) } } });
  assert.equal(result.code, "UNAUTHENTICATED");
});

test("expired, revoked, future, mismatched and overlong shopper sessions fail closed", async () => {
  const changes = [row => { row.expiresAt = NOW; }, row => { row.revokedAt = NOW; },
    row => { row.createdAt = new Date(NOW.getTime() + 1); }, row => { row.expiresAt = new Date(row.createdAt.getTime() + 86400_001); },
    row => { row.authVersion = 1; }, row => { row.shopper.id = "another-shopper"; },
    row => { row.tokenHash = "cd".repeat(32); }, row => { row.shopper.status = "SUSPENDED"; },
    row => { row.shopper.status = "DISABLED"; }, row => { row.createdAt = new Date(NaN); }];
  for (const change of changes) { const f = fixture(); change(f.row); assert.equal((await f.run()).code, "UNAUTHENTICATED"); }
});

test("shopper membership requires explicit current manual access and correct identity", async () => {
  const changes = [m => { m.expiresAt = NOW; }, m => { m.revokedAt = NOW; }, m => { m.status = "SUSPENDED"; },
    m => { m.startsAt = new Date(NOW.getTime() + 1); }, m => { m.shopperId = "foreign-shopper"; },
    m => { m.source = "PAID"; }, m => { m.version = 0; }];
  for (const change of changes) { const f = fixture(); change(f.row.shopper.membership); assert.equal((await f.run()).code, "FORBIDDEN"); }
  const f = fixture(); f.row.shopper.membership = null; assert.equal((await f.run()).code, "FORBIDDEN");
});

test("authority expiry is checked after lookup and failures expose no database details", async () => {
  const f = fixture(); let tick = 0;
  assert.equal((await f.run({ clock: () => tick++ ? f.row.expiresAt : NOW })).code, "UNAUTHENTICATED");
  const result = await f.run({ db: { rewardShopperSession: { findUnique: async () => { throw new Error("secret database URL"); } } } });
  assert.equal(result.code, "UNAVAILABLE"); assert.ok(!JSON.stringify(result).includes("secret"));
});
