import test from "node:test";
import assert from "node:assert/strict";
import { complimentaryAccessCreateSchema } from "../lib/complimentary-access-request.mjs";

test("a one-use code accepts the stable public plan IDs shown in Super Admin", () => {
  const result = complimentaryAccessCreateSchema.safeParse({
    mode: "CODE",
    recipientEmail: "recipient@example.com",
    planId: "public-plan-retail-enterprise"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.planId, "public-plan-retail-enterprise");
});

test("a one-use code still requires an eligible email and a bounded plan ID", () => {
  assert.equal(complimentaryAccessCreateSchema.safeParse({ mode: "CODE", planId: "public-plan-retail-enterprise" }).success, false);
  assert.equal(complimentaryAccessCreateSchema.safeParse({ mode: "CODE", recipientEmail: "recipient@example.com", planId: " " }).success, false);
  assert.equal(complimentaryAccessCreateSchema.safeParse({ mode: "CODE", recipientEmail: "recipient@example.com", planId: "x".repeat(121) }).success, false);
});
