import test from "node:test";
import assert from "node:assert/strict";

import {
  isOrganisationRoleAllowed,
  isPlatformAdminRole,
  ORGANISATION_CONTENT_ROLES,
  ORGANISATION_MANAGER_ROLES,
  ORGANISATION_MEMBER_ROLES
} from "../lib/permissions.mjs";

test("platform administration is limited to platform roles", () => {
  assert.equal(isPlatformAdminRole("SUPER_ADMIN"), true);
  assert.equal(isPlatformAdminRole("SUPPORT"), true);
  assert.equal(isPlatformAdminRole("OWNER"), false);
  assert.equal(isPlatformAdminRole(undefined), false);
});

test("all organisation roles can read organisation resources", () => {
  for (const role of ["OWNER", "MANAGER", "CONTENT_EDITOR", "VIEWER"]) {
    assert.equal(isOrganisationRoleAllowed(role, ORGANISATION_MEMBER_ROLES), true);
  }

  assert.equal(
    isOrganisationRoleAllowed("SUPER_ADMIN", ORGANISATION_MEMBER_ROLES),
    false
  );
});

test("only owners and managers can manage organisation structure", () => {
  assert.equal(isOrganisationRoleAllowed("OWNER", ORGANISATION_MANAGER_ROLES), true);
  assert.equal(isOrganisationRoleAllowed("MANAGER", ORGANISATION_MANAGER_ROLES), true);
  assert.equal(
    isOrganisationRoleAllowed("CONTENT_EDITOR", ORGANISATION_MANAGER_ROLES),
    false
  );
  assert.equal(isOrganisationRoleAllowed("VIEWER", ORGANISATION_MANAGER_ROLES), false);
});

test("content editors can manage media but viewers cannot", () => {
  assert.equal(
    isOrganisationRoleAllowed("CONTENT_EDITOR", ORGANISATION_CONTENT_ROLES),
    true
  );
  assert.equal(isOrganisationRoleAllowed("VIEWER", ORGANISATION_CONTENT_ROLES), false);
});
