import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import {
  ORGANISATION_ANNOUNCEMENT_SURFACES,
  ORGANISATION_TEMPLATES,
  canTransitionOrganisationEvent,
  organisationNetworkControlsEnabled,
  organisationTemplate,
  validateAnnouncementSurfaces,
  validateOrganisationEventWindow
} from "@/lib/organisations-core.mjs";

export const dynamic = "force-dynamic";

const id = z.string().cuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("UPDATE_PROFILE"), template: z.enum(Object.keys(ORGANISATION_TEMPLATES)), locale: z.string().trim().min(2).max(20), timezone: z.string().trim().min(1).max(80), disclosureText: z.string().trim().max(2000).optional().nullable() }),
  z.object({ action: z.literal("CREATE_ANNOUNCEMENT"), title: z.string().trim().min(2).max(180), body: z.string().trim().min(2).max(8000), surfaces: z.array(z.enum(ORGANISATION_ANNOUNCEMENT_SURFACES)).min(1).max(5), targetLocationIds: z.array(id).max(200).default([]), targetStationIds: z.array(id).max(200).default([]), startsAt: z.coerce.date().optional().nullable(), endsAt: z.coerce.date().optional().nullable() }),
  z.object({ action: z.enum(["APPROVE_ANNOUNCEMENT", "PUBLISH_ANNOUNCEMENT", "ARCHIVE_ANNOUNCEMENT"]), announcementId: id }),
  z.object({ action: z.literal("CREATE_EVENT"), title: z.string().trim().min(2).max(180), description: z.string().trim().max(4000).optional().nullable(), startsAt: z.coerce.date(), endsAt: z.coerce.date(), timezone: z.string().trim().min(1).max(80), stationId: id.optional().nullable(), channelId: id.optional().nullable(), fallbackAutoDjPolicyId: id.optional().nullable() }),
  z.object({ action: z.literal("TRANSITION_EVENT"), eventId: id, status: z.enum(["READY", "LIVE", "ENDED", "CANCELLED"]) }),
  z.object({ action: z.literal("CREATE_SPONSOR"), name: z.string().trim().min(2).max(180), legalName: z.string().trim().max(180).optional().nullable(), disclosureText: z.string().trim().max(1000).optional().nullable() }),
  z.object({ action: z.literal("ASSIGN_BRANCH"), organisationMemberId: id, locationId: id, permission: z.enum(["MANAGER", "CONTENT", "DISPLAY", "VIEWER"]) })
]);

async function access() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } } });
  if (!context?.membership) return { error: "Sign in and choose your organisation.", status: 401 };
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  if (!entitlements.serviceEnabled || !entitlements.organisationsEnabled) return { error: "Ruvanas Organisations is not included in this organisation's active plan.", status: 403 };
  return { context, organisation, entitlements };
}

function responseError(error, fallback = "The Organisations action could not be completed.") {
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 409 });
}

export async function GET() {
  const result = await access();
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  const organisationId = result.organisation.id;
  const [profile, announcements, events, sponsors, locations, stations, members, branchAssignments, autoDjPolicies] = await Promise.all([
    prisma.organisationMediaProfile.findUnique({ where: { organisationId } }),
    prisma.organisationAnnouncement.findMany({ where: { organisationId }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.organisationEvent.findMany({ where: { organisationId }, orderBy: { startsAt: "desc" }, take: 100 }),
    prisma.organisationSponsorProfile.findMany({ where: { organisationId }, orderBy: { name: "asc" }, take: 100 }),
    prisma.location.findMany({ where: { organisationId }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" }, take: 200 }),
    prisma.station.findMany({ where: { organisationId, productFamily: "ORGANISATIONS" }, select: { id: true, name: true, status: true, channels: { select: { id: true, name: true, status: true } } }, orderBy: { name: "asc" }, take: 100 }),
    prisma.organisationMember.findMany({ where: { organisationId }, select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } }, take: 200 }),
    prisma.organisationBranchAssignment.findMany({ where: { organisationId }, include: { location: { select: { id: true, name: true } }, organisationMember: { select: { id: true, user: { select: { name: true, email: true } } } } }, take: 500 }),
    prisma.autoDjPolicy.findMany({ where: { organisationId, targetType: "ORGANISATIONS_CHANNEL" }, select: { id: true, name: true, state: true, enabled: true }, orderBy: { name: "asc" }, take: 100 })
  ]);
  return NextResponse.json({ profile, announcements, events, sponsors, locations, stations, members, branchAssignments, autoDjPolicies, permissions: { role: result.context.membership.role, canManage: isOrganisationRoleAllowed(result.context.membership.role, ORGANISATION_MANAGER_ROLES), networkControls: organisationNetworkControlsEnabled(result.entitlements) }, entitlements: { planCode: result.entitlements.planCode, planTierNumber: result.entitlements.planTierNumber, stationLimit: result.entitlements.stationLimit, digitalSignageEnabled: result.entitlements.digitalSignageEnabled } });
}

export async function POST(request) {
  const result = await access();
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  if (!isOrganisationRoleAllowed(result.context.membership.role, ORGANISATION_CONTENT_ROLES)) return NextResponse.json({ error: "You do not have permission to manage organisation media." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the Organisations details and try again." }, { status: 400 });
  const data = parsed.data;
  const organisationId = result.organisation.id;
  const userId = result.context.user.id;
  const manager = isOrganisationRoleAllowed(result.context.membership.role, ORGANISATION_MANAGER_ROLES);
  try {
    let entity;
    if (data.action === "UPDATE_PROFILE") {
      if (!manager) return NextResponse.json({ error: "Only an owner or manager can change the organisation template." }, { status: 403 });
      try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }); } catch { return NextResponse.json({ error: "Choose a valid IANA timezone." }, { status: 400 }); }
      entity = await prisma.organisationMediaProfile.upsert({ where: { organisationId }, create: { organisationId, template: organisationTemplate(data.template), locale: data.locale, timezone: data.timezone, disclosureText: data.disclosureText || null }, update: { template: organisationTemplate(data.template), locale: data.locale, timezone: data.timezone, disclosureText: data.disclosureText || null } });
    } else if (data.action === "CREATE_ANNOUNCEMENT") {
      const surfaces = validateAnnouncementSurfaces(data.surfaces);
      if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) throw new Error("Announcement end must be after its start.");
      const [locations, stations] = await Promise.all([
        prisma.location.count({ where: { organisationId, id: { in: data.targetLocationIds } } }),
        prisma.station.count({ where: { organisationId, productFamily: "ORGANISATIONS", id: { in: data.targetStationIds } } })
      ]);
      if (locations !== data.targetLocationIds.length || stations !== data.targetStationIds.length) throw new Error("Choose targets owned by the active organisation.");
      entity = await prisma.organisationAnnouncement.create({ data: { organisationId, title: data.title, body: data.body, surfaces, targetLocationIds: data.targetLocationIds, targetStationIds: data.targetStationIds, startsAt: data.startsAt || null, endsAt: data.endsAt || null, createdByUserId: userId } });
    } else if (["APPROVE_ANNOUNCEMENT", "PUBLISH_ANNOUNCEMENT", "ARCHIVE_ANNOUNCEMENT"].includes(data.action)) {
      if (!manager) return NextResponse.json({ error: "Only an owner or manager can approve or publish announcements." }, { status: 403 });
      const announcement = await prisma.organisationAnnouncement.findFirst({ where: { id: data.announcementId, organisationId } });
      if (!announcement) return NextResponse.json({ error: "The announcement was not found." }, { status: 404 });
      const next = data.action === "APPROVE_ANNOUNCEMENT" ? "APPROVED" : data.action === "PUBLISH_ANNOUNCEMENT" ? "PUBLISHED" : "ARCHIVED";
      if (next === "APPROVED" && announcement.status !== "DRAFT") throw new Error("Only a draft announcement can be approved.");
      if (next === "PUBLISHED" && announcement.status !== "APPROVED") throw new Error("Approve the announcement before publishing it.");
      entity = await prisma.organisationAnnouncement.update({ where: { id: announcement.id }, data: { status: next, approvedByUserId: next === "APPROVED" ? userId : announcement.approvedByUserId, approvedAt: next === "APPROVED" ? new Date() : announcement.approvedAt, publishedByUserId: next === "PUBLISHED" ? userId : announcement.publishedByUserId, publishedAt: next === "PUBLISHED" ? new Date() : announcement.publishedAt } });
    } else if (data.action === "CREATE_EVENT") {
      const window = validateOrganisationEventWindow(data);
      const station = data.stationId ? await prisma.station.findFirst({ where: { id: data.stationId, organisationId, productFamily: "ORGANISATIONS" }, select: { id: true } }) : null;
      const channel = data.channelId ? await prisma.channel.findFirst({ where: { id: data.channelId, organisationId, station: { productFamily: "ORGANISATIONS" }, ...(data.stationId ? { stationId: data.stationId } : {}) }, select: { id: true, stationId: true } }) : null;
      const fallback = data.fallbackAutoDjPolicyId ? await prisma.autoDjPolicy.findFirst({ where: { id: data.fallbackAutoDjPolicyId, organisationId, targetType: "ORGANISATIONS_CHANNEL" }, select: { id: true } }) : null;
      if ((data.stationId && !station) || (data.channelId && !channel) || (data.fallbackAutoDjPolicyId && !fallback)) throw new Error("Choose event resources owned by this organisation.");
      entity = await prisma.organisationEvent.create({ data: { organisationId, title: data.title, description: data.description || null, ...window, timezone: data.timezone, stationId: station?.id || channel?.stationId || null, channelId: channel?.id || null, fallbackAutoDjPolicyId: fallback?.id || null, createdByUserId: userId } });
    } else if (data.action === "TRANSITION_EVENT") {
      if (!manager) return NextResponse.json({ error: "Only an owner or manager can change Event Mode state." }, { status: 403 });
      const event = await prisma.organisationEvent.findFirst({ where: { id: data.eventId, organisationId } });
      if (!event) return NextResponse.json({ error: "The event was not found." }, { status: 404 });
      if (!canTransitionOrganisationEvent(event.status, data.status)) throw new Error(`Event Mode cannot move from ${event.status} to ${data.status}.`);
      if (data.status === "READY" && (!event.channelId || !event.fallbackAutoDjPolicyId)) throw new Error("Choose a channel and an AutoDJ fallback before marking Event Mode ready.");
      entity = await prisma.organisationEvent.update({ where: { id: event.id }, data: { status: data.status, lastTransitionByUserId: userId } });
    } else if (data.action === "CREATE_SPONSOR") {
      entity = await prisma.organisationSponsorProfile.create({ data: { organisationId, name: data.name, legalName: data.legalName || null, disclosureText: data.disclosureText || null, createdByUserId: userId } });
    } else {
      if (!manager || !organisationNetworkControlsEnabled(result.entitlements)) return NextResponse.json({ error: "Branch delegation requires Organisations Network or Enterprise and an owner or manager." }, { status: 403 });
      const [member, location] = await Promise.all([prisma.organisationMember.findFirst({ where: { id: data.organisationMemberId, organisationId }, select: { id: true } }), prisma.location.findFirst({ where: { id: data.locationId, organisationId }, select: { id: true } })]);
      if (!member || !location) throw new Error("Choose a member and branch owned by this organisation.");
      entity = await prisma.organisationBranchAssignment.upsert({ where: { organisationMemberId_locationId: { organisationMemberId: member.id, locationId: location.id } }, create: { organisationId, organisationMemberId: member.id, locationId: location.id, permission: data.permission, createdByUserId: userId }, update: { permission: data.permission, createdByUserId: userId } });
    }
    const entityType = data.action.includes("ANNOUNCEMENT") ? "OrganisationAnnouncement" : data.action.includes("EVENT") ? "OrganisationEvent" : data.action.includes("SPONSOR") ? "OrganisationSponsorProfile" : data.action === "ASSIGN_BRANCH" ? "OrganisationBranchAssignment" : "OrganisationMediaProfile";
    await prisma.auditLog.create({ data: { organisationId, actorUserId: userId, action: `ORGANISATIONS_${data.action}`, entityType, entityId: entity.id, details: { status: entity.status || null, surfaces: entity.surfaces || null } } });
    return NextResponse.json({ success: true, result: entity }, { status: data.action.startsWith("CREATE_") ? 201 : 200 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That Organisations record already exists." }, { status: 409 });
    return responseError(error);
  }
}
