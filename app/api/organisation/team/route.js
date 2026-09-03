import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganisationContext } from "@/lib/auth";
import { getRequestId } from "@/lib/security-log";
import {
  canAssignSubscriberTeamRole,
  canManageSubscriberMember,
  canManageSubscriberTeam,
  createOrganisationInvitation,
  normalizeOrganisationName,
  normalizeSubscriberTeamRole,
  normalizeTeamEmail,
  teamMemberVisibility
} from "@/lib/subscriber-team.mjs";

function denied(status, error) {
  return NextResponse.json({ error }, { status });
}

async function activeContext() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true } }
  });
  if (!context) return { response: denied(401, "Sign in to manage your organisation.") };
  if (context.user.role === "STUDENT") return { response: denied(403, "Student accounts cannot access organisation settings.") };
  if (!context.membership) return { response: denied(403, "Select an organisation before managing its team.") };
  return { context };
}

function invitationSummary(invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    invitedBy: invitation.invitedBy?.name || invitation.invitedBy?.email || "Team administrator"
  };
}

export async function GET() {
  try {
    const access = await activeContext();
    if (access.response) return access.response;
    const { membership, user } = access.context;
    const canManage = canManageSubscriberTeam(membership.role);
    const [members, invitations] = await Promise.all([
      prisma.organisationMember.findMany({
        where: { organisationId: membership.organisationId },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: { user: { select: { id: true, name: true, email: true } } }
      }),
      canManage ? prisma.organisationInvitation.findMany({
        where: {
          organisationId: membership.organisationId,
          acceptedAt: null,
          revokedAt: null,
          tokenHash: { not: null },
          expiresAt: { gt: new Date() }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        include: { invitedBy: { select: { name: true, email: true } } }
      }) : Promise.resolve([])
    ]);

    const subscription = membership.organisation.subscription;
    return NextResponse.json({
      organisation: {
        id: membership.organisation.id,
        name: membership.organisation.name,
        slug: membership.organisation.slug,
        planName: subscription?.plan?.name || "No active plan",
        subscriptionStatus: subscription?.status || "INACTIVE"
      },
      currentUserId: user.id,
      currentRole: membership.role,
      permissions: {
        canManage,
        canRenameOrganisation: membership.role === "OWNER"
      },
      members: members.map((member) => teamMemberVisibility({
        viewerRole: membership.role,
        viewerUserId: user.id,
        member
      })),
      invitations: invitations.map(invitationSummary)
    });
  } catch (error) {
    console.error("Load subscriber team error:", error);
    return denied(500, "Unable to load your organisation team.");
  }
}

export async function POST(request) {
  try {
    const access = await activeContext();
    if (access.response) return access.response;
    const { membership, user } = access.context;
    if (!canManageSubscriberTeam(membership.role)) return denied(403, "Only an owner or manager can invite team members.");

    let email;
    let role;
    try {
      const body = await request.json();
      email = normalizeTeamEmail(body.email);
      role = normalizeSubscriberTeamRole(body.role);
    } catch (error) {
      return denied(400, error instanceof Error ? error.message : "Check the invitation details.");
    }
    if (!canAssignSubscriberTeamRole(membership.role, role)) return denied(403, "Your role cannot assign that level of access.");

    const existingMember = await prisma.organisationMember.findFirst({
      where: { organisationId: membership.organisationId, user: { email } },
      select: { id: true }
    });
    if (existingMember) return denied(409, "That person is already a member of this organisation.");

    const activeInvitationCount = await prisma.organisationInvitation.count({
      where: {
        organisationId: membership.organisationId,
        acceptedAt: null,
        revokedAt: null,
        tokenHash: { not: null },
        expiresAt: { gt: new Date() }
      }
    });
    if (activeInvitationCount >= 50) return denied(429, "Revoke an unused invitation before creating another one.");

    const generated = createOrganisationInvitation();
    const invitation = await prisma.$transaction(async (tx) => {
      const pending = await tx.organisationInvitation.findFirst({
        where: {
          organisationId: membership.organisationId,
          email,
          acceptedAt: null,
          revokedAt: null
        },
        orderBy: { createdAt: "desc" }
      });
      const saved = pending ? await tx.organisationInvitation.update({
        where: { id: pending.id },
        data: {
          role,
          tokenHash: generated.tokenHash,
          expiresAt: generated.expiresAt,
          invitedByUserId: user.id
        }
      }) : await tx.organisationInvitation.create({
        data: {
          organisationId: membership.organisationId,
          email,
          role,
          tokenHash: generated.tokenHash,
          expiresAt: generated.expiresAt,
          invitedByUserId: user.id
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: membership.organisationId,
          actorUserId: user.id,
          action: pending ? "ORGANISATION_INVITATION_REISSUED" : "ORGANISATION_INVITATION_CREATED",
          entityType: "OrganisationInvitation",
          entityId: saved.id,
          details: { email, role, expiresAt: generated.expiresAt.toISOString(), requestId: getRequestId(request) }
        }
      });
      return saved;
    });

    return NextResponse.json({
      ok: true,
      invitation: invitationSummary({ ...invitation, invitedBy: user }),
      invitationPath: `/team-invitation/accept#token=${generated.token}`,
      warning: "This private invitation link is shown once. Share it only with the intended team member."
    }, { status: 201 });
  } catch (error) {
    console.error("Create subscriber team invitation error:", error);
    return denied(500, "Unable to create the team invitation.");
  }
}

export async function PATCH(request) {
  try {
    const access = await activeContext();
    if (access.response) return access.response;
    const { membership, user } = access.context;
    if (!canManageSubscriberTeam(membership.role)) return denied(403, "Only an owner or manager can manage team access.");

    const body = await request.json();
    const action = String(body.action || "").trim().toUpperCase();

    if (action === "UPDATE_ORGANISATION") {
      if (membership.role !== "OWNER") return denied(403, "Only an organisation owner can change the organisation name.");
      let name;
      try { name = normalizeOrganisationName(body.name); } catch (error) { return denied(400, error.message); }
      const organisation = await prisma.$transaction(async (tx) => {
        const saved = await tx.organisation.update({ where: { id: membership.organisationId }, data: { name } });
        await tx.auditLog.create({ data: {
          organisationId: membership.organisationId,
          actorUserId: user.id,
          action: "ORGANISATION_PROFILE_UPDATED",
          entityType: "Organisation",
          entityId: membership.organisationId,
          details: { name, requestId: getRequestId(request) }
        } });
        return saved;
      });
      return NextResponse.json({ ok: true, organisation: { id: organisation.id, name: organisation.name } });
    }

    if (action === "REVOKE_INVITATION") {
      const invitationId = String(body.invitationId || "").trim();
      const invitation = await prisma.organisationInvitation.findFirst({
        where: { id: invitationId, organisationId: membership.organisationId, acceptedAt: null, revokedAt: null }
      });
      if (!invitation) return denied(404, "That active invitation was not found.");
      if (!canAssignSubscriberTeamRole(membership.role, invitation.role)) return denied(403, "Your role cannot revoke that invitation.");
      await prisma.$transaction([
        prisma.organisationInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date(), tokenHash: null } }),
        prisma.auditLog.create({ data: {
          organisationId: membership.organisationId,
          actorUserId: user.id,
          action: "ORGANISATION_INVITATION_REVOKED",
          entityType: "OrganisationInvitation",
          entityId: invitation.id,
          details: { email: invitation.email, role: invitation.role, requestId: getRequestId(request) }
        } })
      ]);
      return NextResponse.json({ ok: true });
    }

    const memberId = String(body.memberId || "").trim();
    const target = await prisma.organisationMember.findFirst({
      where: { id: memberId, organisationId: membership.organisationId },
      include: { user: { select: { email: true, name: true } } }
    });
    if (!target) return denied(404, "That team member was not found.");
    if (target.userId === user.id) return denied(409, "Use another organisation owner to change your own access.");
    if (!canManageSubscriberMember(membership.role, target.role)) return denied(403, "Your role cannot change that team member.");

    if (action === "UPDATE_ROLE") {
      let role;
      try { role = normalizeSubscriberTeamRole(body.role); } catch (error) { return denied(400, error.message); }
      if (!canAssignSubscriberTeamRole(membership.role, role)) return denied(403, "Your role cannot assign that level of access.");
      const saved = await prisma.$transaction(async (tx) => {
        const result = await tx.organisationMember.update({ where: { id: target.id }, data: { role } });
        await tx.auditLog.create({ data: {
          organisationId: membership.organisationId,
          actorUserId: user.id,
          action: "ORGANISATION_MEMBER_ROLE_UPDATED",
          entityType: "OrganisationMember",
          entityId: target.id,
          details: { email: target.user.email, fromRole: target.role, toRole: role, requestId: getRequestId(request) }
        } });
        return result;
      });
      return NextResponse.json({ ok: true, member: { id: saved.id, role: saved.role } });
    }

    if (action === "REMOVE_MEMBER") {
      await prisma.$transaction(async (tx) => {
        await tx.organisationMember.delete({ where: { id: target.id } });
        await tx.session.updateMany({
          where: { userId: target.userId, activeOrganisationId: membership.organisationId, revokedAt: null },
          data: { activeOrganisationId: null }
        });
        await tx.auditLog.create({ data: {
          organisationId: membership.organisationId,
          actorUserId: user.id,
          action: "ORGANISATION_MEMBER_REMOVED",
          entityType: "OrganisationMember",
          entityId: target.id,
          details: { email: target.user.email, role: target.role, requestId: getRequestId(request) }
        } });
      });
      return NextResponse.json({ ok: true });
    }

    return denied(400, "Choose a supported team action.");
  } catch (error) {
    console.error("Update subscriber team error:", error);
    return denied(500, "Unable to update team access.");
  }
}
