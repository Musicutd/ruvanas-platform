import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { CORRECTIONS_DEVELOPMENT_MODULES, correctionsC5Features } from "@/lib/corrections-c5-policy.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";

function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }
const codeFor = (value) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

async function developmentAuthority(tx, access, contributor, { edit = false } = {}) {
  if (!contributor || contributor.organisationId !== access.organisationId) throw bad("Contributor not found.", 404);
  const member = await tx.organisationMember.findUnique({ where: { id: access.context.membership.id }, select: { id: true, userId: true, organisationId: true, role: true } });
  if (!member || member.userId !== access.context.user.id || member.organisationId !== access.organisationId) throw bad("Your organisation access changed.", 403);
  if (member.role !== "OWNER") {
    const grant = await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId: contributor.facilityId } } });
    if (!grant || grant.organisationId !== access.organisationId || (edit && (member.role !== "MANAGER" || grant.permission !== "MANAGER"))) throw bad("You do not have access to this contributor.", 403);
  }
  const subscription = await tx.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
  const features = correctionsC5Features(resolveEntitlements(subscription));
  if (!features.development) throw bad("Contributor development requires Ruvanas Inside Tier 2 or above.", 403);
  return features;
}

export async function correctionsContributorDevelopment(access, contributorId) {
  const contributor = await prisma.correctionsContributor.findFirst({ where: { id: contributorId, organisationId: access.organisationId }, select: { id: true, facilityId: true, organisationId: true, displayName: true, status: true } });
  const features = await developmentAuthority(prisma, access, contributor);
  const [modules, milestones, sessions, submissions, programmes] = await Promise.all([
    prisma.correctionsDevelopmentModule.findMany({ where: { organisationId: access.organisationId, active: true }, orderBy: { position: "asc" }, select: { id: true, code: true, title: true, position: true } }),
    prisma.correctionsContributorMilestone.findMany({ where: { contributorId }, select: { moduleId: true, status: true, completedAt: true, note: true, supervisorUserId: true } }),
    prisma.correctionsStudioSession.findMany({ where: { contributorId, organisationId: access.organisationId, facilityId: contributor.facilityId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, activatedAt: true, completedAt: true, expiresAt: true, programmeId: true } }),
    prisma.correctionsSubmission.findMany({ where: { contributorId, organisationId: access.organisationId, facilityId: contributor.facilityId }, orderBy: { submittedAt: "desc" }, take: 100, select: { id: true, status: true, submittedAt: true, programmeId: true, revision: true } }),
    prisma.correctionsProgramme.findMany({ where: { organisationId: access.organisationId, facilityId: contributor.facilityId, studioSessions: { some: { contributorId } } }, select: { id: true, title: true, status: true } })
  ]);
  const byCode = new Map(modules.map((item) => [item.code, item]));
  const maxDefaultModules = correctionsC5Features(access.entitlements).advanced ? CORRECTIONS_DEVELOPMENT_MODULES.length : 7;
  const pathway = [...CORRECTIONS_DEVELOPMENT_MODULES.slice(0, maxDefaultModules).map((title, index) => byCode.get(codeFor(title)) || { code: codeFor(title), title, position: index + 1, id: null }), ...modules.filter((item) => !CORRECTIONS_DEVELOPMENT_MODULES.some((title) => codeFor(title) === item.code))].map((module) => ({ ...module, record: milestones.find((item) => item.moduleId === module.id) || { status: "NOT_STARTED" } }));
  const supervisedMinutes = sessions.reduce((sum, session) => {
    if (!session.activatedAt || !session.completedAt) return sum;
    const end = session.expiresAt && session.expiresAt < session.completedAt ? session.expiresAt : session.completedAt;
    return sum + Math.max(0, Math.min(24 * 60, (new Date(end) - new Date(session.activatedAt)) / 60_000));
  }, 0);
  const grant = access.context.membership.role === "OWNER" ? null : await prisma.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: access.context.membership.id, facilityId: contributor.facilityId } }, select: { permission: true } });
  return { contributor, pathway, sessions, submissions, programmes,
    canEdit: access.context.membership.role === "OWNER" || (access.context.membership.role === "MANAGER" && grant?.permission === "MANAGER"),
    canConfigureModules: features.customTaxonomy && access.context.membership.role === "OWNER",
    evidence: { supervisedSessionCount: sessions.filter((item) => item.completedAt).length, supervisedMinutes: Math.round(supervisedMinutes), submittedProductions: submissions.length, approvedProductions: submissions.filter((item) => item.status === "APPROVED").length, approvedProgrammes: programmes.filter((item) => item.status === "APPROVED").length, modulesCompleted: milestones.filter((item) => item.status === "COMPLETED").length } };
}

export async function createCorrectionsDevelopmentModule(access, input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 3 || title.length > 80) throw bad("Enter a module title of 3–80 characters.");
  const code = codeFor(title);
  if (!/^[A-Z0-9_]{3,80}$/.test(code)) throw bad("Choose a plain-language module title.");
  return runSerializableTransaction(prisma, async (tx) => {
    if (access.context.membership.role !== "OWNER") throw bad("Only the organisation owner can configure development modules.", 403);
    const member = await tx.organisationMember.findUnique({ where: { id: access.context.membership.id }, select: { userId: true, organisationId: true, role: true } });
    if (!member || member.userId !== access.context.user.id || member.organisationId !== access.organisationId || member.role !== "OWNER") throw bad("Your organisation access changed.", 403);
    const subscription = await tx.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } });
    if (!correctionsC5Features(resolveEntitlements(subscription)).customTaxonomy) throw bad("Custom development modules require Ruvanas Inside Tier 5.", 403);
    const count = await tx.correctionsDevelopmentModule.count({ where: { organisationId: access.organisationId } });
    if (count >= 50) throw bad("The module limit has been reached.", 409);
    const module = await tx.correctionsDevelopmentModule.create({ data: { organisationId: access.organisationId, code, title, position: 11 + count } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_DEVELOPMENT_MODULE_CREATED", entityType: "CorrectionsDevelopmentModule", entityId: module.id, details: { code } } });
    return { id: module.id, code: module.code, title: module.title };
  });
}

export async function saveCorrectionsMilestone(access, contributorId, input) {
  const code = String(input.moduleCode || "").toUpperCase();
  const status = String(input.status || "").toUpperCase();
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!/^[A-Z0-9_]{3,80}$/.test(code) || !["NOT_STARTED", "IN_PROGRESS", "COMPLETED"].includes(status) || note.length > 500) throw bad("Choose a module, milestone state and a short note.");
  return runSerializableTransaction(prisma, async (tx) => {
    const contributor = await tx.correctionsContributor.findFirst({ where: { id: contributorId, organisationId: access.organisationId } });
    const features = await developmentAuthority(tx, access, contributor, { edit: true });
    const defaultIndex = CORRECTIONS_DEVELOPMENT_MODULES.findIndex((title) => codeFor(title) === code);
    let module = await tx.correctionsDevelopmentModule.findUnique({ where: { organisationId_code: { organisationId: access.organisationId, code } } });
    if (!module && defaultIndex >= 0) module = await tx.correctionsDevelopmentModule.create({ data: { organisationId: access.organisationId, code, title: CORRECTIONS_DEVELOPMENT_MODULES[defaultIndex], position: defaultIndex + 1 } });
    if (!module || !module.active || (defaultIndex >= 7 && !features.advanced) || (defaultIndex < 0 && !features.customTaxonomy)) throw bad("This module is not available in the current plan.", 403);
    const record = await tx.correctionsContributorMilestone.upsert({ where: { contributorId_moduleId: { contributorId, moduleId: module.id } }, create: {
      contributorId, moduleId: module.id, status, note: note || null,
      supervisorUserId: status === "COMPLETED" ? access.context.user.id : null,
      completedAt: status === "COMPLETED" ? new Date() : null
    }, update: { status, note: note || null, supervisorUserId: status === "COMPLETED" ? access.context.user.id : null, completedAt: status === "COMPLETED" ? new Date() : null } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_DEVELOPMENT_RECORD_CHANGED", entityType: "CorrectionsContributorMilestone", entityId: record.id, details: { facilityId: contributor.facilityId, contributorId, moduleCode: code, status } } });
    return { moduleCode: code, status: record.status, completedAt: record.completedAt };
  });
}
