import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ORGANISATION_MANAGER_ROLES,
  requireOrganisationAccess
} from "@/lib/access-control";
import { accessDenied } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    const { campaignId } = await params;
    const record = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, organisationId: true, status: true, mandatory: true }
    });
    if (!record) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    const access = await requireOrganisationAccess(record.organisationId, ORGANISATION_MANAGER_ROLES);
    if (!access.ok) return accessDenied(access);
    if (record.mandatory && access.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Ruvanas Super Admin can pause or archive a mandatory campaign." }, { status: 403 });
    }
    const status = String((await request.json())?.status || "").toUpperCase();
    const allowed = status === "PAUSED"
      ? ["PUBLISHED"]
      : status === "ARCHIVED" ? ["DRAFT", "PAUSED", "ENDED"] : [];
    if (!allowed.length || !allowed.includes(record.status)) {
      return NextResponse.json({ error: "This campaign cannot move to the requested status." }, { status: 409 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.update({ where: { id: record.id }, data: { status } });
      await tx.auditLog.create({ data: {
        organisationId: record.organisationId,
        actorUserId: access.user.id,
        action: status === "PAUSED" ? "CAMPAIGN_PAUSED" : "CAMPAIGN_ARCHIVED",
        entityType: "Campaign",
        entityId: record.id,
        details: { previousStatus: record.status, status }
      } });
      return campaign;
    });
    return NextResponse.json({ ok: true, campaign: updated });
  } catch (error) {
    console.error("Update campaign status error:", error);
    return NextResponse.json({ error: "Unable to update the campaign status." }, { status: 500 });
  }
}
