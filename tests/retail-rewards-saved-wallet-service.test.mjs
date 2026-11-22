import test from "node:test";
import assert from "node:assert/strict";
import { createShopperSavedWalletService } from "../lib/retail-rewards/shopper-saved-wallet-service.mjs";
const ON = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true" };
const access = { ok: true, shopperId: "shopper-a", sessionId: "session-a", membershipId: "membership-a" };
function fixture(overrides = {}) {
  const calls = [], env = { ...ON };
  const db = { rewardSavedVoucher: {
    deleteMany: async value => { calls.push(["delete", value]); return { count: 0 }; },
    findMany: async value => { calls.push(["find", value]); return []; },
    count: async value => { calls.push(["count", value]); return 0; }
  } };
  db.$transaction = async (callback, options) => { calls.push(["transaction", options]); return callback(db); };
  const service = createShopperSavedWalletService({ db, env, loadShopper: async () => access, ...overrides });
  return { calls, db, service, env };
}
test("disabled gate and invalid selectors prevent database access", async () => {
  const off = fixture({ env: {} }); assert.equal((await off.service.list()).code, "FEATURE_DISABLED"); assert.deepEqual(off.calls, []);
  const h = fixture();
  assert.equal((await h.service.list({ shopperId: "other" })).code, "INVALID_REQUEST");
  assert.equal((await h.service.save({ shopSlug: "test-shop", offerSlug: "test-offer", shopperId: "other" })).code, "INVALID_REQUEST");
  assert.equal((await h.service.remove("../foreign")).code, "INVALID_REQUEST");
  assert.deepEqual(h.calls, []);
});
test("list/count/remove queries scope to server-authenticated shopper and foreign absence is indistinguishable", async () => {
  const h = fixture(), list = await h.service.list({ page: 2 });
  assert.deepEqual(list, { ok: true, items: [], page: 2, hasMore: false, savedCount: 0 });
  assert.deepEqual(h.calls.find(value => value[0] === "find")[1].where, { shopperId: "shopper-a" });
  assert.equal(h.calls.find(value => value[0] === "find")[1].skip, 25);
  assert.deepEqual(h.calls.find(value => value[0] === "count")[1].where, { shopperId: "shopper-a" });
  assert.deepEqual(await h.service.remove("foreign-or-absent"), { ok: true, removed: true });
  assert.deepEqual(h.calls.at(-1), ["delete", { where: { id: "foreign-or-absent", shopperId: "shopper-a" } }]);
});
test("status returns only requested public pairs and shopper-owned IDs", async () => {
  const h = fixture(), pair = { shopSlug: "test-shop", offerSlug: "test-offer" };
  assert.deepEqual(await h.service.status({ offers: [pair] }), { ok: true, items: [{ ...pair, savedId: null }] });
  assert.equal(h.calls.find(value => value[0] === "find")[1].where.shopperId, "shopper-a");
  assert.deepEqual(await h.service.status({ offers: [] }), { ok: true, items: [] });
});
test("session change suppresses reads and invalid access prevents writes", async () => {
  let reads = 0;
  const h = fixture({ loadShopper: async () => ++reads === 1 ? access : { ...access, shopperId: "shopper-b" } });
  assert.equal((await h.service.list()).code, "UNAUTHENTICATED");
  const denied = fixture({ loadShopper: async () => ({ ok: false, code: "UNAUTHENTICATED" }) });
  assert.equal((await denied.service.remove("saved-own")).code, "UNAUTHENTICATED");
  assert.equal(denied.calls.some(value => value[0] === "delete"), false);
});
test("serializable conflicts retry boundedly and unknown database errors stay private", async () => {
  const h = fixture(); let attempts = 0;
  h.db.$transaction = async callback => { if (++attempts < 3) throw { code: "P2034" }; return callback(h.db); };
  assert.equal((await h.service.list()).ok, true); assert.equal(attempts, 3);
  h.db.$transaction = async () => { throw new Error("private database credential"); };
  assert.equal((await h.service.list()).code, "UNAVAILABLE");
});
