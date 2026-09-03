import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { consumeRateLimit, createRateLimitKey } from "@/lib/rate-limit";
import { getRequestId, securityLog } from "@/lib/security-log";
import {
  hashOrganisationInvitationToken,
  isInvitationActive,
  subscriberTeamRoleDetails
} from "@/lib/subscriber-team.mjs";

function denied(status, error) {
  return NextResponse.json({ error }, { status });
}

async function loadInvitation(token) {
  let tokenHash;
  try { tokenHash = hashOrganisationInvitationToken(token); } catch (error) { return { error: error.message }; }
  const invitation = await prisma.organisationInvitation.findUnique({
    where: { tokenHash },
    include: { organisation: { select: { id: true, name: true } } }
  });
  if (!isInvitationActive(invitation)) return { error: "This invitation has expired, was revoked, or has already been used." };
  return { invitation, tokenHash };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = String(body.action || "INSPECT").trim().toUpperCase();
    const loaded = await loadInvitation(body.token);
    if (loaded.error) return denied(410, loaded.error);
    const { invitation, tokenHash } = loaded;
    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });

    if (action === "INSPECT") {
      return NextResponse.json({
        invitation: {
          organisationName: invitation.organisation.name,
          email: invitation.email,
          role: invitation.role,
          roleLabel: subscriberTeamRoleDetails[invitation.role]?.label || invitation.role,
          expiresAt: invitation.expiresAt,
          existingAccount: Boolean(existingUser)
        }
      });
    }
    if (action !== "ACCEPT") return denied(400, "Choose a supported invitation action.");

    const rateLimit = await consumeRateLimit({
      key: createRateLimitKey("organisation-invitation", request, invitation.email),
      limit: 8,
      windowMs: 60 * 60 * 1_000
    });
    if (!rateLimit.allowed) return denied(429, "Too many attempts. Ask your organisation owner to reissue the invitation.");

    const name = String(body.name || "").trim().replace(/\s+/g, " ");
    const password = String(body.password || "");
    if (password.length < 8) return denied(400, "Your password must contain at least 8 characters.");
    if (!existingUser && (name.length < 2 || name.length > 100)) return denied(400, "Enter your full name.");

    let userId = existingUser?.id || null;
    if (existingUser) {
      const user = await prisma.user.findUnique({ where: { id: existingUser.id }, select: { passwordHash: true } });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        securityLog("warn", "ORGANISATION_INVITATION_PASSWORD_REJECTED", request, { invitationId: invitation.id });
        return denied(401, "The password does not match the existing account for this email address.");
      }
    }

    const passwordHash = existingUser ? null : await bcrypt.hash(password, 12);
    const accepted = await prisma.$transaction(async (tx) => {
      const claimed = await tx.organisationInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { tokenHash: null, acceptedAt: new Date() }
      });
      if (claimed.count !== 1) throw new Error("This invitation was changed while it was being accepted.");

      if (!userId) {
        const created = await tx.user.create({
          data: { name, email: invitation.email, passwordHash, role: invitation.role },
          select: { id: true }
        });
        userId = created.id;
      }
      const member = await tx.organisationMember.upsert({
        where: { userId_organisationId: { userId, organisationId: invitation.organisationId } },
        create: { userId, organisationId: invitation.organisationId, role: invitation.role },
        update: { role: invitation.role }
      });
      await tx.organisationInvitation.update({
        where: { id: invitation.id },
        data: { acceptedByUserId: userId }
      });
      await tx.auditLog.create({ data: {
        organisationId: invitation.organisationId,
        actorUserId: userId,
        action: "ORGANISATION_INVITATION_ACCEPTED",
        entityType: "OrganisationMember",
        entityId: member.id,
        details: { invitationId: invitation.id, email: invitation.email, role: invitation.role, requestId: getRequestId(request) }
      } });
      return member;
    });

    await createSession(userId, invitation.organisationId);
    securityLog("info", "ORGANISATION_INVITATION_ACCEPTED", request, {
      organisationId: invitation.organisationId,
      userId,
      membershipId: accepted.id
    });
    return NextResponse.json({ ok: true, destination: "/dashboard/team" });
  } catch (error) {
    console.error("Accept organisation invitation error:", error);
    if (error?.code === "P2002") return denied(409, "An account or team membership already exists for this email address.");
    return denied(409, error instanceof Error ? error.message : "Unable to accept this invitation.");
  }
}
