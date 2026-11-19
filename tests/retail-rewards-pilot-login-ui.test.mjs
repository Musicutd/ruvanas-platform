import test from "node:test";
import assert from "node:assert/strict";
import { pilotLoginDestination, pilotLoginMessage } from "../lib/retail-rewards/pilot-login-ui.mjs";

test("pilot sign-in navigates only to exact fixed Rewards destinations", () => {
  for (const landing of ["/admin/retail-rewards/pilot", "/dashboard/retail/rewards", "/dashboard/retail/rewards/redeem"])
    assert.equal(pilotLoginDestination({ ok: true, landing }), landing);
  for (const landing of ["/admin", "/dashboard", "/register", "//outside.invalid", "https://outside.invalid/", "/dashboard/retail/rewards?token=secret", "/dashboard/retail/rewards#next", "/dashboard/retail/rewards/", "/admin/retail-rewards/pilot/../stations", null, 1])
    assert.equal(pilotLoginDestination({ ok: true, landing }), null);
});

test("pilot sign-in rejects contradictory or secret-bearing successful responses", () => {
  for (const value of [null, [], { ok: false, landing: "/admin/retail-rewards/pilot" }, { ok: "true", landing: "/admin/retail-rewards/pilot" },
    { ok: true, landing: "/admin/retail-rewards/pilot", token: "secret" }, { ok: true, landing: "/admin/retail-rewards/pilot", email: "private@example.test" }])
    assert.equal(pilotLoginDestination(value), null);
});

test("pilot sign-in exposes no arbitrary server error or account-existence distinction", () => {
  assert.equal(pilotLoginMessage("AUTH_FAILED"), pilotLoginMessage("FORBIDDEN"));
  assert.equal(pilotLoginMessage("UNAUTHENTICATED"), pilotLoginMessage("FORBIDDEN"));
  assert.equal(pilotLoginMessage("secret-password"), pilotLoginMessage());
  assert.equal(pilotLoginMessage("<script>"), pilotLoginMessage());
  assert.match(pilotLoginMessage("RATE_LIMITED"), /wait/);
});
