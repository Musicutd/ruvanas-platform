import test from "node:test";
import assert from "node:assert/strict";
import { readPilotPreviewPolicy, pilotPreviewOrganisationIds, pilotPreviewOrganisationAllowed, pilotPreviewOrganisationWhere } from "../lib/retail-rewards/pilot-preview-policy.mjs";
import { pilotPreviewShopperAllowed } from "../lib/retail-rewards/pilot-preview-shopper.mjs";
import { requireRewardShopperAccess, hashShopperSessionToken } from "../lib/retail-rewards/shopper-access.mjs";
import { pilotPreviewEnvironment } from "./fixtures/rewards-pilot-preview.mjs";

test("pilot preview bridge defaults off and composes strict feature and exact organisation gates", () => {
  assert.equal(readPilotPreviewPolicy({}).enabled, false);
  const env = pilotPreviewEnvironment(["org-two", "org-one"]);
  assert.deepEqual(readPilotPreviewPolicy(env), { enabled: true, valid: true, organisationIds: ["org-one", "org-two"] });
  for (const patch of [{ RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: undefined }, { RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "false" },
    { RUVANAS_RETAIL_REWARDS_PILOT_PREVIEW_ENABLED: "1" }, { RUVANAS_RETAIL_REWARDS_ENABLED: "false" },
    { RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED: "false" }, { RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS: '["org-one","org-one"]' },
    { RUVANAS_PRIVATE_PREVIEW_ENABLED: "invalid" }, { RUVANAS_PRIVATE_PREVIEW_ADMIN_EMAIL: "unknown@example.invalid" }]) {
    assert.equal(readPilotPreviewPolicy({ ...env, ...patch }).enabled, false);
    assert.deepEqual(pilotPreviewOrganisationIds({ ...env, ...patch }), []);
  }
  assert.equal(pilotPreviewOrganisationAllowed(env, "org-one"), true);
  assert.equal(pilotPreviewOrganisationAllowed(env, "foreign-org"), false);
  assert.deepEqual(pilotPreviewOrganisationWhere(env), { organisationId: { in: ["org-one", "org-two"] } });
});

test("ordinary non-preview shopper operation remains unchanged and performs no pilot lookup", async () => {
  const no = new Proxy({}, { get() { throw new Error("Unexpected pilot lookup"); } });
  assert.equal(pilotPreviewOrganisationIds({}), null);
  assert.deepEqual(pilotPreviewOrganisationWhere({}), {});
  assert.equal(pilotPreviewOrganisationAllowed({}, "any-ordinary-org"), true);
  assert.equal(await pilotPreviewShopperAllowed({ db: no, env: {}, shopperId: "ordinary-shopper" }), true);
});

test("preview shopper access requires an exact immutable pilot enrollment and fails closed after policy changes", async () => {
  const env = pilotPreviewEnvironment(), calls = [];
  const db = { rewardPilotShopperEnrollment: { async findUnique(query) {
    calls.push(query); return { shopperId: "shopper-one", organisationId: "org-one" };
  } } };
  assert.equal(await pilotPreviewShopperAllowed({ db, env, shopperId: "shopper-one" }), true);
  assert.deepEqual(calls[0], { where: { shopperId: "shopper-one" }, select: { shopperId: true, organisationId: true } });
  for (const row of [null, { shopperId: "other", organisationId: "org-one" }, { shopperId: "shopper-one", organisationId: "foreign" }]) {
    db.rewardPilotShopperEnrollment.findUnique = async () => row;
    assert.equal(await pilotPreviewShopperAllowed({ db, env, shopperId: "shopper-one" }), false);
  }
  db.rewardPilotShopperEnrollment.findUnique = async () => {
    env.RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS = '["different-org"]';
    return { shopperId: "shopper-one", organisationId: "org-one" };
  };
  assert.equal(await pilotPreviewShopperAllowed({ db, env, shopperId: "shopper-one" }), false);
  db.rewardPilotShopperEnrollment.findUnique = async () => { throw new Error("private connection details"); };
  assert.equal(await pilotPreviewShopperAllowed({ db, env, shopperId: "shopper-one" }), false);
});

test("shopper sessions stay independent and are denied when pilot enrollment is removed or authority expires during its lookup", async () => {
  const now = new Date("2026-11-14T12:00:00Z"), end = new Date(now.getTime() + 1000), token = "ab".repeat(32);
  const env = { ...pilotPreviewEnvironment(), RUVANAS_RETAIL_REWARDS_SHOPPER_ENABLED: "true", SESSION_SECRET: "local-only-session-secret-32-characters" };
  const row = { id: "session-one", shopperId: "shopper-one", tokenHash: hashShopperSessionToken(token, env.SESSION_SECRET),
    authVersion: 1, createdAt: now, expiresAt: end, revokedAt: null,
    shopper: { id: "shopper-one", status: "ACTIVE", authVersion: 1, membership: { id: "membership-one", shopperId: "shopper-one",
      status: "ACTIVE", source: "MANUAL_INTERNAL", startsAt: now, expiresAt: end, revokedAt: null, version: 1 } } };
  let tick = now, enrollment = { shopperId: "shopper-one", organisationId: "org-one" };
  const db = { rewardShopperSession: { findUnique: async () => structuredClone(row) },
    rewardPilotShopperEnrollment: { findUnique: async () => enrollment } };
  const run = () => requireRewardShopperAccess({ db, env, token, clock: () => tick });
  assert.equal((await run()).ok, true);
  enrollment = null; assert.equal((await run()).code, "FORBIDDEN");
  enrollment = { shopperId: "shopper-one", organisationId: "org-one" };
  db.rewardPilotShopperEnrollment.findUnique = async () => { tick = end; return enrollment; };
  assert.equal((await run()).code, "UNAUTHENTICATED");
});
