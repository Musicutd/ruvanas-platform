import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, setActiveOrganisation } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { requireSchoolNetworkAccess } from "@/lib/school-network-access";
import {
  canChangeSchoolNetworkOwners,
  redactedNetworkMember,
  schoolNetworkSummary,
  validateSchoolAccessGrant
} from "@/lib/school-network.mjs";
import slugify from "@/lib/slugify";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_NETWORK"), name: z.string().trim().min(2).max(160), slug: z.string().trim().max(180).optional().nullable() }),
  z.object({ action: z.literal("ADD_SCHOOL"), schoolNetworkId: z.string().cuid(), organisationId: z.string().cuid() }),
  z.object({ action: z.literal("SET_SCHOOL_STATUS"), schoolNetworkId: z.string().cuid(), networkSchoolId: z.string().cuid(), active: z.boolean() }),
  z.object({ action: z.literal("ADD_MEMBER"), schoolNetworkId: z.string().cuid(), email: z.string().trim().email().max(320), role: z.enum(["OWNER", "ADMIN", "VIEWER"]) }),
  z.object({ action: z.literal("SET_MEMBER_ROLE"), schoolNetworkId: z.string().cuid(), networkMemberId: z.string().cuid(), role: z.enum(["OWNER", "ADMIN", "VIEWER"]) }),
  z.object({ action: z.literal("GRANT_SCHOOL_ACCESS"), schoolNetworkId: z.string().cuid(), networkMemberId: z.string().cuid(), organisationId: z.string().cuid(), organisationRole: z.enum(["MANAGER", "CONTENT_EDITOR", "VIEWER"]) }),
  z.object({ action: z.literal("SWITCH_SCHOOL"), schoolNetworkId: z.string().cuid(), organisationId: z.string().cuid() })
]);

const networkInclude = {
  members: { orderBy: [{ role: "asc" }, { createdAt: "asc" }], include: { user: { select: { id: true, name: true, email: true } } } },
  schools: {
    orderBy: { joinedAt: "asc" },
    include: {
      organisation: {
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { locations: true, studentGroups: true, schoolProgrammes: true, schoolEpisodes: true, assignments: true } }
        }
      }
    }
  }
};

function jsonError(access) {
  return NextResponse.json({ error: access.error }, { status: access.status });
}

async function audit(tx, { userId, schoolNetworkId, organisationId = null, action, entityType, entityId, details = {} }) {
  await tx.auditLog.create({ data: { schoolNetworkId, organisationId, actorUserId: userId, action, entityType, entityId, details: { ...details, crossSchoolContentExposed: false } } });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });

  const [networks, organisationMemberships, allOrganisations] = await Promise.all([
    prisma.schoolNetwork.findMany({
      where: user.role === "SUPER_ADMIN" ? {} : { members: { some: { userId: user.id } } },
      orderBy: { name: "asc" },
      include: networkInclude
    }),
    prisma.organisationMember.findMany({ where: { userId: user.id }, select: { organisationId: true, role: true } }),
    user.role === "SUPER_ADMIN"
      ? prisma.organisation.findMany({
          where: { schoolNetworkSchool: null },
          orderBy: { name: "asc" },
          include: { subscription: { include: { plan: true } } }
        })
      : Promise.resolve([])
  ]);
  const accessibleOrganisationIds = new Set(organisationMemberships.map((item) => item.organisationId));

  return NextResponse.json({
    platformRole: user.role,
    networks: networks.map((network) => {
      const ownMembership = network.members.find((item) => item.userId === user.id);
      const canManage = user.role === "SUPER_ADMIN" || new Set(["OWNER", "ADMIN"]).has(ownMembership?.role);
      return {
        id: network.id,
        name: network.name,
        slug: network.slug,
        role: user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : ownMembership?.role,
        canManage,
        schools: network.schools.map((school) => schoolNetworkSummary(school, { canOpen: accessibleOrganisationIds.has(school.organisationId) })),
        memberCount: network.members.length,
        members: canManage ? network.members.map((member) => redactedNetworkMember(member, { includeIdentity: true })) : []
      };
    }),
    candidateSchools: allOrganisations
      .filter((organisation) => resolveEntitlements(organisation.subscription).schoolRadioEnabled)
      .map((organisation) => ({ id: organisation.id, name: organisation.name, slug: organisation.slug })),
    safety: {
      aggregateOnly: true,
      studentIdentityVisibleAcrossSchools: false,
      directStudentAccessEnabled: false,
      schoolAccessRequiresOrganisationMembership: true
    }
  });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the academy details and try again." }, { status: 400 });
  const data = parsed.data;

  try {
    if (data.action === "CREATE_NETWORK") {
      if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can create an academy network." }, { status: 403 });
      const slug = slugify(data.slug || data.name);
      if (!slug) return NextResponse.json({ error: "The academy name must contain letters or numbers." }, { status: 400 });
      const network = await prisma.$transaction(async (tx) => {
        const created = await tx.schoolNetwork.create({ data: { name: data.name, slug, createdByUserId: user.id, members: { create: { userId: user.id, role: "OWNER" } } } });
        await audit(tx, { userId: user.id, schoolNetworkId: created.id, action: "SCHOOL_NETWORK_CREATED", entityType: "SchoolNetwork", entityId: created.id, details: { slug } });
        return created;
      });
      return NextResponse.json({ result: network }, { status: 201 });
    }

    const access = await requireSchoolNetworkAccess(data.schoolNetworkId, { manage: data.action !== "SWITCH_SCHOOL" });
    if (!access.ok) return jsonError(access);

    if (data.action === "ADD_SCHOOL") {
      if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Only a Ruvanas Super Admin can attach a school organisation to an academy network." }, { status: 403 });
      const organisation = await prisma.organisation.findFirst({ where: { id: data.organisationId }, include: { subscription: { include: { plan: true } } } });
      if (!organisation || !resolveEntitlements(organisation.subscription).schoolRadioEnabled) return NextResponse.json({ error: "Choose a School Radio organisation." }, { status: 404 });
      const school = await prisma.$transaction(async (tx) => {
        const created = await tx.schoolNetworkSchool.create({ data: { schoolNetworkId: data.schoolNetworkId, organisationId: organisation.id } });
        await audit(tx, { userId: user.id, schoolNetworkId: data.schoolNetworkId, organisationId: organisation.id, action: "SCHOOL_NETWORK_SCHOOL_ADDED", entityType: "SchoolNetworkSchool", entityId: created.id });
        return created;
      });
      return NextResponse.json({ result: school }, { status: 201 });
    }

    if (data.action === "SET_SCHOOL_STATUS") {
      const school = await prisma.schoolNetworkSchool.findFirst({ where: { id: data.networkSchoolId, schoolNetworkId: data.schoolNetworkId } });
      if (!school) return NextResponse.json({ error: "The academy school was not found." }, { status: 404 });
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.schoolNetworkSchool.update({ where: { id: school.id }, data: { active: data.active } });
        await audit(tx, { userId: user.id, schoolNetworkId: data.schoolNetworkId, organisationId: school.organisationId, action: data.active ? "SCHOOL_NETWORK_SCHOOL_ACTIVATED" : "SCHOOL_NETWORK_SCHOOL_PAUSED", entityType: "SchoolNetworkSchool", entityId: school.id });
        return result;
      });
      return NextResponse.json({ result: updated });
    }

    if (data.action === "ADD_MEMBER") {
      if (data.role === "OWNER" && !canChangeSchoolNetworkOwners({ platformRole: user.role, networkRole: access.membership?.role })) return NextResponse.json({ error: "Only a network owner can add another owner." }, { status: 403 });
      const target = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() }, select: { id: true, name: true, email: true } });
      if (!target) return NextResponse.json({ error: "That user must have an existing Ruvanas account before being added." }, { status: 404 });
      const member = await prisma.$transaction(async (tx) => {
        const created = await tx.schoolNetworkMember.upsert({ where: { schoolNetworkId_userId: { schoolNetworkId: data.schoolNetworkId, userId: target.id } }, create: { schoolNetworkId: data.schoolNetworkId, userId: target.id, role: data.role }, update: { role: data.role } });
        await audit(tx, { userId: user.id, schoolNetworkId: data.schoolNetworkId, action: "SCHOOL_NETWORK_MEMBER_ASSIGNED", entityType: "SchoolNetworkMember", entityId: created.id, details: { targetUserId: target.id, role: data.role } });
        return created;
      });
      return NextResponse.json({ result: member }, { status: 201 });
    }

    if (data.action === "SET_MEMBER_ROLE") {
      if (!canChangeSchoolNetworkOwners({ platformRole: user.role, networkRole: access.membership?.role })) return NextResponse.json({ error: "Only a network owner can change member roles." }, { status: 403 });
      const current = await prisma.schoolNetworkMember.findFirst({ where: { id: data.networkMemberId, schoolNetworkId: data.schoolNetworkId } });
      if (!current) return NextResponse.json({ error: "The academy member was not found." }, { status: 404 });
      const owners = await prisma.schoolNetworkMember.count({ where: { schoolNetworkId: data.schoolNetworkId, role: "OWNER" } });
      if (current.role === "OWNER" && data.role !== "OWNER" && owners <= 1) return NextResponse.json({ error: "Every academy network must keep at least one owner." }, { status: 409 });
      const member = await prisma.$transaction(async (tx) => {
        const updated = await tx.schoolNetworkMember.update({ where: { id: current.id }, data: { role: data.role } });
        await audit(tx, { userId: user.id, schoolNetworkId: data.schoolNetworkId, action: "SCHOOL_NETWORK_MEMBER_ROLE_CHANGED", entityType: "SchoolNetworkMember", entityId: current.id, details: { previousRole: current.role, role: data.role } });
        return updated;
      });
      return NextResponse.json({ result: member });
    }

    if (data.action === "GRANT_SCHOOL_ACCESS") {
      const organisationRole = validateSchoolAccessGrant(data);
      const [member, school] = await Promise.all([
        prisma.schoolNetworkMember.findFirst({ where: { id: data.networkMemberId, schoolNetworkId: data.schoolNetworkId }, select: { id: true, userId: true } }),
        prisma.schoolNetworkSchool.findFirst({ where: { schoolNetworkId: data.schoolNetworkId, organisationId: data.organisationId, active: true }, select: { id: true, organisationId: true } })
      ]);
      if (!member || !school) return NextResponse.json({ error: "Choose an active school and academy member from this network." }, { status: 404 });
      const membership = await prisma.$transaction(async (tx) => {
        const saved = await tx.organisationMember.upsert({ where: { userId_organisationId: { userId: member.userId, organisationId: school.organisationId } }, create: { userId: member.userId, organisationId: school.organisationId, role: organisationRole }, update: { role: organisationRole } });
        await audit(tx, { userId: user.id, schoolNetworkId: data.schoolNetworkId, organisationId: school.organisationId, action: "SCHOOL_NETWORK_SCHOOL_ACCESS_GRANTED", entityType: "OrganisationMember", entityId: saved.id, details: { targetUserId: member.userId, role: organisationRole } });
        return saved;
      });
      return NextResponse.json({ result: membership });
    }

    const school = await prisma.schoolNetworkSchool.findFirst({ where: { schoolNetworkId: data.schoolNetworkId, organisationId: data.organisationId, active: true }, select: { organisationId: true } });
    if (!school) return NextResponse.json({ error: "That school is not active in this academy network." }, { status: 404 });
    const switched = await setActiveOrganisation(school.organisationId);
    if (!switched.ok) return NextResponse.json({ error: "You need explicit school access before opening this workspace." }, { status: switched.status });
    return NextResponse.json({ ok: true, organisationId: school.organisationId });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That academy network, school, or membership already exists." }, { status: 409 });
    console.error("School network action failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "The academy action could not be completed." }, { status: 500 });
  }
}

