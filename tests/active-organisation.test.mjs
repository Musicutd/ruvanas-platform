import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveMembership } from "../lib/active-organisation.mjs";

const memberships = [
  { id: "membership-a", organisationId: "organisation-a" },
  { id: "membership-b", organisationId: "organisation-b" }
];

test("active organisation selection honours the session choice", () => {
  assert.equal(
    selectActiveMembership(memberships, "organisation-b")?.id,
    "membership-b"
  );
});

test("active organisation selection falls back deterministically", () => {
  assert.equal(
    selectActiveMembership(memberships, "deleted-organisation")?.id,
    "membership-a"
  );
  assert.equal(selectActiveMembership([], "organisation-a"), null);
});

