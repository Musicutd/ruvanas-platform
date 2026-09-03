import crypto from "node:crypto";

export const SUBSCRIBER_TEAM_ROLES = ["MANAGER", "CONTENT_EDITOR", "VIEWER"];
export const TEAM_INVITATION_TTL_DAYS = 7;

export const subscriberTeamRoleDetails = {
  OWNER: {
    label: "Owner",
    description: "Full organisation control, including team access and account details."
  },
  MANAGER: {
    label: "Manager",
    description: "Runs day-to-day radio operations and can manage editors and viewers."
  },
  CONTENT_EDITOR: {
    label: "Content editor",
    description: "Creates and submits programming and audio without account administration."
  },
  VIEWER: {
    label: "Viewer",
    description: "Read-only access to service status, content and reports."
  }
};

export function normalizeTeamEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export function normalizeOrganisationName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100) {
    throw new Error("Organisation name must contain between 2 and 100 characters.");
  }
  return name;
}

export function normalizeSubscriberTeamRole(value) {
  const role = String(value || "").trim().toUpperCase();
  if (!SUBSCRIBER_TEAM_ROLES.includes(role)) {
    throw new Error("Choose a supported team role.");
  }
  return role;
}

export function canManageSubscriberTeam(role) {
  return role === "OWNER" || role === "MANAGER";
}

export function canAssignSubscriberTeamRole(actorRole, targetRole) {
  if (!SUBSCRIBER_TEAM_ROLES.includes(targetRole)) return false;
  if (actorRole === "OWNER") return true;
  return actorRole === "MANAGER" && ["CONTENT_EDITOR", "VIEWER"].includes(targetRole);
}

export function canManageSubscriberMember(actorRole, targetRole) {
  if (actorRole === "OWNER") return targetRole !== "OWNER";
  return actorRole === "MANAGER" && ["CONTENT_EDITOR", "VIEWER"].includes(targetRole);
}

export function createOrganisationInvitation(now = new Date()) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + TEAM_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1_000);
  return { token, tokenHash: hashOrganisationInvitationToken(token), expiresAt };
}

export function hashOrganisationInvitationToken(token) {
  const value = String(token || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("This invitation link is incomplete.");
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function isInvitationActive(invitation, now = new Date()) {
  return Boolean(
    invitation &&
    invitation.tokenHash &&
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    new Date(invitation.expiresAt) > now
  );
}

export function teamMemberVisibility({ viewerRole, viewerUserId, member }) {
  const showEmail = canManageSubscriberTeam(viewerRole) || viewerUserId === member.userId;
  return {
    id: member.id,
    userId: member.userId,
    name: member.user.name || "Team member",
    email: showEmail ? member.user.email : null,
    role: member.role,
    joinedAt: member.createdAt
  };
}
