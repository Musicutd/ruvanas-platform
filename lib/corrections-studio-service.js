import { prisma } from "@/lib/prisma";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { createDefaultEditDecision } from "@/lib/audio-lab.mjs";
import { defaultMultitrackState } from "@/lib/multitrack-studio.mjs";
import { runSerializableTransaction } from "@/lib/transaction-retry.mjs";
import {
  CORRECTIONS_STUDIO_CAPABILITIES, CORRECTIONS_STUDIO_MAX_MINUTES, correctionsStudioSessionAvailable,
  correctionsStudioSupervisorAllowed, createCorrectionsStudioToken, hashCorrectionsStudioToken
} from "@/lib/corrections-studio-policy.mjs";

const sessionInclude = {
  contributor: { select: { id: true, organisationId: true, facilityId: true, displayName: true, status: true } },
  programme: { select: { id: true, organisationId: true, facilityId: true, title: true, status: true } },
  project: { select: { id: true, organisationId: true, title: true, type: true, currentVersion: true } },
  facility: { select: { id: true, name: true, organisationId: true, status: true } },
  supervisor: { select: { id: true, name: true } },
  submission: { select: { id: true, revision: true, status: true } }
};

function bad(message, status = 409) { return Object.assign(new Error(message), { status }); }

export function safeCorrectionsStudioSession(session) {
  return {
    id: session.id, status: session.status === "ACTIVE" && session.expiresAt && new Date(session.expiresAt) <= new Date() ? "EXPIRED" : session.status, facilityId: session.facilityId,
    facilityName: session.facility?.name, contributorId: session.contributorId,
    contributorName: session.contributor?.displayName, programmeId: session.programmeId,
    programmeTitle: session.programme?.title, projectId: session.projectId,
    projectTitle: session.project?.title, projectType: session.project?.type, supervisorName: session.supervisor?.name || "Assigned staff",
    capabilities: session.capabilityScope, activatedAt: session.activatedAt,
    expiresAt: session.expiresAt, revokedAt: session.revokedAt,
    submission: session.submission || null
  };
}

async function assertCurrentSupervisor(tx, access, facilityId) {
  const member = await tx.organisationMember.findUnique({ where: { id: access.context.membership.id } });
  if (!member || member.userId !== access.context.user.id || member.organisationId !== access.organisationId) throw bad("Your organisation access changed.", 403);
  const grant = member.role === "OWNER" ? null : await tx.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: member.id, facilityId } } });
  if (!correctionsStudioSupervisorAllowed({ role: member.role, grant, organisationId: access.organisationId, memberId: member.id, facilityId })) throw bad("You cannot supervise Studio for this facility.", 403);
  const [subscription, facility] = await Promise.all([
    tx.subscription.findUnique({ where: { organisationId: access.organisationId }, include: { plan: true, billingContract: true } }),
    tx.correctionsFacility.findFirst({ where: { locationId: facilityId, location: { organisationId: access.organisationId, status: { not: "CLOSED" } } }, include: { location: { select: { name: true, countryCode: true } } } })
  ]);
  const entitlements = resolveEntitlements(subscription);
  if (!entitlements.correctionsRadioEnabled || entitlements.planTierNumber < 2) throw bad("Supervised Studio is included with Ruvanas Inside Tier 2 or above.", 403);
  if (!facility) throw bad("Choose an active facility in your organisation.", 404);
  return { entitlements, facility };
}

export async function listCorrectionsStudio(access) {
  const organisationId = access.organisationId;
  const subscription = await prisma.subscription.findUnique({ where: { organisationId }, include: { plan: true, billingContract: true } });
  const entitlements = resolveEntitlements(subscription);
  if (!entitlements.correctionsRadioEnabled || entitlements.planTierNumber < 2) throw bad("Supervised Studio is included with Ruvanas Inside Tier 2 or above.", 403);
  // Location has no grants relation; use the C2 assignment registry explicitly.
  const grants = access.context.membership.role === "OWNER" ? null : await prisma.correctionsFacilityGrant.findMany({ where: { organisationId, organisationMemberId: access.context.membership.id, permission: "MANAGER" }, select: { facilityId: true } });
  const facilityIds = grants?.map((grant) => grant.facilityId);
  const scope = { organisationId, ...(facilityIds ? { facilityId: { in: facilityIds } } : {}) };
  const [facilities, contributors, programmes, sessions, approvedSources] = await Promise.all([
    prisma.correctionsFacility.findMany({ where: { location: { organisationId, status: { not: "CLOSED" }, ...(facilityIds ? { id: { in: facilityIds } } : {}) } }, include: { location: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.correctionsContributor.findMany({ where: { ...scope, status: "ACTIVE" }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, facilityId: true } }),
    prisma.correctionsProgramme.findMany({ where: { ...scope, status: { in: ["DRAFT", "CHANGES_REQUESTED", "REJECTED"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, facilityId: true, status: true } }),
    prisma.correctionsStudioSession.findMany({ where: scope, include: sessionInclude, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.promoVersion.findMany({ where: { status: "APPROVED", qcStatus: "PASSED",
      promoAsset: { organisationId, status: "ACTIVE", mediaType: { in: ["JINGLE", "ANNOUNCEMENT", "VOICEOVER"] } },
      mediaAsset: { organisationId, libraryType: "ORGANISATION_PROMO", status: "READY" } },
      orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, mediaAssetId: true, promoAsset: { select: { name: true, currentApprovedVersionId: true } },
        mediaAsset: { select: { name: true, mediaType: true } } } })
  ]);
  return { facilities: facilities.map((item) => ({ id: item.locationId, name: item.location.name })), contributors, programmes,
    studioProEnabled: entitlements.planTierNumber >= 3 && entitlements.studioProEnabled,
    approvedSources: approvedSources.filter((item) => item.promoAsset.currentApprovedVersionId === item.id)
      .map((item) => ({ id: item.id, label: item.promoAsset.name || item.mediaAsset.name, mediaType: item.mediaAsset.mediaType })),
    sessions: sessions.map(safeCorrectionsStudioSession) };
}

export async function attachCorrectionsApprovedSource(access, sessionId, promoVersionId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const session = await tx.correctionsStudioSession.findFirst({ where: { id: sessionId, organisationId: access.organisationId } });
    if (!session) throw bad("Session not found.", 404);
    await assertCurrentSupervisor(tx, access, session.facilityId);
    if (!["DRAFT", "ACTIVE"].includes(session.status) || (session.status === "ACTIVE" && session.expiresAt <= new Date())) throw bad("This session cannot receive more audio.");
    const version = await tx.promoVersion.findFirst({ where: { id: promoVersionId, status: "APPROVED", qcStatus: "PASSED",
      promoAsset: { organisationId: access.organisationId, status: "ACTIVE", currentApprovedVersionId: promoVersionId,
        mediaType: { in: ["JINGLE", "ANNOUNCEMENT", "VOICEOVER"] } },
      mediaAsset: { organisationId: access.organisationId, libraryType: "ORGANISATION_PROMO", status: "READY" } },
      include: { mediaAsset: true } });
    if (!version) throw bad("Choose a currently approved organisation sound.", 404);
    const existing = await tx.audioTake.findFirst({ where: { projectId: session.projectId, promoVersionId, trashedAt: null }, select: { id: true } });
    if (existing) return { id: existing.id, repeated: true };
    const take = await tx.audioTake.create({ data: { organisationId: access.organisationId, projectId: session.projectId,
      mediaAssetId: version.mediaAssetId, promoVersionId, recordedByUserId: access.context.user.id,
      durationMs: Math.max(1000, (version.durationSeconds || version.mediaAsset.durationSeconds || 1) * 1000),
      status: "READY", sourceEditDecision: createDefaultEditDecision() } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id,
      action: "CORRECTIONS_STUDIO_APPROVED_SOURCE_ATTACHED", entityType: "AudioTake", entityId: take.id,
      details: { facilityId: session.facilityId, sessionId, projectId: session.projectId, promoVersionId } } });
    return { id: take.id, repeated: false };
  });
}

export async function createCorrectionsContributor(access, { facilityId, displayName, localReference }) {
  return runSerializableTransaction(prisma, async (tx) => {
    await assertCurrentSupervisor(tx, access, facilityId);
    const contributor = await tx.correctionsContributor.create({ data: { organisationId: access.organisationId, facilityId, displayName, localReference: localReference || null, createdByUserId: access.context.user.id } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_CONTRIBUTOR_CREATED", entityType: "CorrectionsContributor", entityId: contributor.id, details: { facilityId } } });
    return { id: contributor.id, displayName: contributor.displayName, facilityId };
  });
}

export async function archiveCorrectionsContributor(access, contributorId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const contributor = await tx.correctionsContributor.findFirst({ where: { id: contributorId, organisationId: access.organisationId } });
    if (!contributor) throw bad("Contributor not found.", 404);
    await assertCurrentSupervisor(tx, access, contributor.facilityId);
    const now = new Date();
    await tx.correctionsContributor.update({ where: { id: contributorId }, data: { status: "ARCHIVED", archivedAt: now } });
    await tx.correctionsStudioSession.updateMany({ where: { contributorId, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now, accessTokenHash: null } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_CONTRIBUTOR_ARCHIVED", entityType: "CorrectionsContributor", entityId: contributorId, details: { facilityId: contributor.facilityId } } });
    return { id: contributorId, status: "ARCHIVED" };
  });
}

export async function createCorrectionsStudioSession(access, { facilityId, contributorId, programmeId, priorProjectId, title, projectType = "QUICK_RECORD" }) {
  return runSerializableTransaction(prisma, async (tx) => {
    const { entitlements } = await assertCurrentSupervisor(tx, access, facilityId);
    if (projectType === "MULTITRACK" && (entitlements.planTierNumber < 3 || !entitlements.studioProEnabled)) throw bad("Multitrack Studio is included with Ruvanas Inside Tier 3 or above.", 403);
    const [contributor, programme] = await Promise.all([
      tx.correctionsContributor.findFirst({ where: { id: contributorId, organisationId: access.organisationId, facilityId, status: "ACTIVE" } }),
      tx.correctionsProgramme.findFirst({ where: { id: programmeId, organisationId: access.organisationId, facilityId, status: { in: ["DRAFT", "CHANGES_REQUESTED", "REJECTED"] } } })
    ]);
    if (!contributor || !programme) throw bad("Choose an active contributor and editable programme in this facility.", 404);
    let project;
    if (priorProjectId) {
      const prior = await tx.correctionsStudioSession.findFirst({ where: { projectId: priorProjectId, organisationId: access.organisationId, facilityId, contributorId, programmeId }, include: { project: true } });
      if (!prior || prior.project.type !== projectType) throw bad("Only this contributor's earlier supervised project of the same type can be continued.", 403);
      project = prior.project;
    } else {
      const multitrack = projectType === "MULTITRACK" ? defaultMultitrackState() : null;
      const editDecision = multitrack ? { multitrack: { mode: multitrack.mode, ducking: multitrack.ducking, master: multitrack.master } } : createDefaultEditDecision();
      project = await tx.audioProject.create({ data: { organisationId: access.organisationId, title: title || programme.title, type: projectType, editDecision, createdByUserId: access.context.user.id } });
      if (multitrack) for (const track of multitrack.tracks) await tx.audioTrack.create({ data: { projectId: project.id, kind: track.kind, name: track.name, order: track.order, gainDb: track.gainDb, pan: track.pan, muted: track.muted, solo: track.solo, armed: track.armed, locked: track.locked, effectChainJson: { preset: track.preset, automation: track.automation } } });
      await tx.audioProjectVersion.create({ data: { projectId: project.id, version: 1, state: { title: project.title, ...(multitrack ? { multitrack } : { editDecision }) }, reason: "Corrections supervised project created", createdByUserId: access.context.user.id } });
    }
    const conflicting = await tx.correctionsStudioSession.findFirst({ where: { projectId: project.id, status: "ACTIVE", expiresAt: { gt: new Date() } } });
    if (conflicting) throw bad("This project is in another active supervised session.");
    const session = await tx.correctionsStudioSession.create({ data: { organisationId: access.organisationId, facilityId, contributorId, programmeId, projectId: project.id, supervisorUserId: access.context.user.id, createdByUserId: access.context.user.id, capabilityScope: CORRECTIONS_STUDIO_CAPABILITIES } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_STUDIO_SESSION_CREATED", entityType: "CorrectionsStudioSession", entityId: session.id, details: { facilityId, contributorId, programmeId, projectId: project.id } } });
    return { id: session.id, projectId: project.id, status: session.status };
  });
}

export async function activateCorrectionsStudioSession(access, sessionId, minutes) {
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > CORRECTIONS_STUDIO_MAX_MINUTES) throw bad("Choose a session of 15 to 240 minutes.", 400);
  return runSerializableTransaction(prisma, async (tx) => {
    const session = await tx.correctionsStudioSession.findFirst({ where: { id: sessionId, organisationId: access.organisationId }, include: sessionInclude });
    if (!session) throw bad("Session not found.", 404);
    await assertCurrentSupervisor(tx, access, session.facilityId);
    if (session.status !== "DRAFT" || session.contributor.status !== "ACTIVE" || !["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(session.programme.status)) throw bad("Only a draft session for an editable programme can be activated.");
    const now = new Date();
    await tx.correctionsStudioSession.updateMany({ where: { organisationId: access.organisationId, status: "ACTIVE",
      expiresAt: { lte: now }, OR: [{ projectId: session.projectId }, { contributorId: session.contributorId }] },
      data: { status: "COMPLETED", completedAt: now, accessTokenHash: null } });
    const otherActive = await tx.correctionsStudioSession.findFirst({ where: { organisationId: access.organisationId,
      status: "ACTIVE", OR: [{ projectId: session.projectId }, { contributorId: session.contributorId }] }, select: { id: true } });
    if (otherActive) throw bad("Close the contributor's existing supervised session before activating another.");
    const token = createCorrectionsStudioToken();
    const updated = await tx.correctionsStudioSession.update({ where: { id: session.id }, data: { status: "ACTIVE", accessTokenHash: hashCorrectionsStudioToken(token), activatedAt: now, expiresAt: new Date(now.getTime() + minutes * 60_000) } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_STUDIO_SESSION_ACTIVATED", entityType: "CorrectionsStudioSession", entityId: session.id, details: { facilityId: session.facilityId, expiresAt: updated.expiresAt.toISOString() } } });
    return { session: safeCorrectionsStudioSession({ ...session, ...updated }), accessCode: token };
  });
}

export async function revokeCorrectionsStudioSession(access, sessionId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const session = await tx.correctionsStudioSession.findFirst({ where: { id: sessionId, organisationId: access.organisationId } });
    if (!session) throw bad("Session not found.", 404);
    await assertCurrentSupervisor(tx, access, session.facilityId);
    if (session.status !== "ACTIVE") throw bad("Only an active session can be revoked.");
    await tx.correctionsStudioSession.update({ where: { id: session.id }, data: { status: "REVOKED", revokedAt: new Date(), accessTokenHash: null } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_STUDIO_SESSION_REVOKED", entityType: "CorrectionsStudioSession", entityId: session.id, details: { facilityId: session.facilityId, projectId: session.projectId } } });
    return { id: session.id, status: "REVOKED" };
  });
}

export async function closeCorrectionsStudioSession(access, sessionId) {
  return runSerializableTransaction(prisma, async (tx) => {
    const session = await tx.correctionsStudioSession.findFirst({ where: { id: sessionId, organisationId: access.organisationId } });
    if (!session) throw bad("Session not found.", 404);
    await assertCurrentSupervisor(tx, access, session.facilityId);
    if (session.status !== "ACTIVE") throw bad("Only an active session can be closed.");
    await tx.correctionsStudioSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date(), accessTokenHash: null } });
    await tx.auditLog.create({ data: { organisationId: access.organisationId, actorUserId: access.context.user.id, action: "CORRECTIONS_STUDIO_SESSION_CLOSED", entityType: "CorrectionsStudioSession", entityId: session.id, details: { facilityId: session.facilityId, projectId: session.projectId } } });
    return { id: session.id, status: "COMPLETED" };
  });
}

export async function findCorrectionsContributorSession(token, { allowSubmitted = false } = {}) {
  const hash = hashCorrectionsStudioToken(token);
  if (!hash) return null;
  const session = await prisma.correctionsStudioSession.findUnique({ where: { accessTokenHash: hash }, include: sessionInclude });
  if (!session) return null;
  const submittedReplay = allowSubmitted && session.status === "SUBMITTED" && session.expiresAt &&
    new Date(session.expiresAt) > new Date() && session.contributor?.status === "ACTIVE" &&
    session.contributor.organisationId === session.organisationId && session.contributor.facilityId === session.facilityId &&
    session.facility.organisationId === session.organisationId;
  if (!correctionsStudioSessionAvailable(session) && !submittedReplay) return null;
  const [subscription, membership] = await Promise.all([
    prisma.subscription.findUnique({ where: { organisationId: session.organisationId }, include: { plan: true, billingContract: true } }),
    prisma.organisationMember.findFirst({ where: { userId: session.supervisorUserId, organisationId: session.organisationId } })
  ]);
  const entitlements = resolveEntitlements(subscription);
  if (!entitlements.correctionsRadioEnabled || entitlements.planTierNumber < 2 || (session.project.type === "MULTITRACK" && (entitlements.planTierNumber < 3 || !entitlements.studioProEnabled)) || !membership || session.facility.status === "CLOSED" || session.facility.organisationId !== session.organisationId) return null;
  const grant = membership.role === "OWNER" ? null : await prisma.correctionsFacilityGrant.findUnique({ where: { organisationMemberId_facilityId: { organisationMemberId: membership.id, facilityId: session.facilityId } } });
  if (!correctionsStudioSupervisorAllowed({ role: membership.role, grant, organisationId: session.organisationId, memberId: membership.id, facilityId: session.facilityId })) return null;
  return { session, entitlements };
}
