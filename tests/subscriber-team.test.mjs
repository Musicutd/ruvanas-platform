import assert from "node:assert/strict";
import test from "node:test";
import {
  canAssignSubscriberTeamRole,
  canManageSubscriberMember,
  createOrganisationInvitation,
  hashOrganisationInvitationToken,
  isInvitationActive,
  normalizeOrganisationName,
  normalizeSubscriberTeamRole,
  normalizeTeamEmail,
  teamMemberVisibility
} from "../lib/subscriber-team.mjs";

test("subscriber team inputs are normalised and unsafe roles are rejected", () => {
  assert.equal(normalizeTeamEmail("  Person@Example.COM "), "person@example.com");
  assert.equal(normalizeOrganisationName("  Ruvanas   Malta  "), "Ruvanas Malta");
  assert.equal(normalizeSubscriberTeamRole("content_editor"), "CONTENT_EDITOR");
  assert.throws(() => normalizeSubscriberTeamRole("SUPER_ADMIN"), /supported team role/);
  assert.throws(() => normalizeTeamEmail("not-an-email"), /valid email/);
});

test("owners and managers retain different team authority", () => {
  assert.equal(canAssignSubscriberTeamRole("OWNER", "MANAGER"), true);
  assert.equal(canAssignSubscriberTeamRole("MANAGER", "MANAGER"), false);
  assert.equal(canAssignSubscriberTeamRole("MANAGER", "VIEWER"), true);
  assert.equal(canAssignSubscriberTeamRole("CONTENT_EDITOR", "VIEWER"), false);
  assert.equal(canManageSubscriberMember("OWNER", "OWNER"), false);
  assert.equal(canManageSubscriberMember("OWNER", "MANAGER"), true);
  assert.equal(canManageSubscriberMember("MANAGER", "CONTENT_EDITOR"), true);
  assert.equal(canManageSubscriberMember("MANAGER", "MANAGER"), false);
});

test("organisation invitations are high-entropy, hashed and time limited", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const invitation = createOrganisationInvitation(now);
  assert.match(invitation.token, /^[a-f0-9]{64}$/);
  assert.equal(invitation.tokenHash, hashOrganisationInvitationToken(invitation.token));
  assert.notEqual(invitation.token, invitation.tokenHash);
  assert.equal(invitation.expiresAt.toISOString(), "2026-09-10T12:00:00.000Z");
  assert.equal(isInvitationActive({ ...invitation, acceptedAt: null, revokedAt: null }, now), true);
  assert.equal(isInvitationActive({ ...invitation, acceptedAt: now, revokedAt: null }, now), false);
  assert.equal(isInvitationActive({ ...invitation, acceptedAt: null, revokedAt: now }, now), false);
  assert.equal(isInvitationActive({ ...invitation, expiresAt: now, acceptedAt: null, revokedAt: null }, now), false);
});

test("ordinary viewers see names and roles but not colleague email addresses", () => {
  const member = {
    id: "member-1",
    userId: "user-2",
    role: "CONTENT_EDITOR",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    user: { name: "Editor", email: "editor@example.com" }
  };
  assert.equal(teamMemberVisibility({ viewerRole: "VIEWER", viewerUserId: "user-1", member }).email, null);
  assert.equal(teamMemberVisibility({ viewerRole: "MANAGER", viewerUserId: "user-1", member }).email, "editor@example.com");
  assert.equal(teamMemberVisibility({ viewerRole: "VIEWER", viewerUserId: "user-2", member }).email, "editor@example.com");
});
