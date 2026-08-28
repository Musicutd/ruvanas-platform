import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES, ORGANISATION_MANAGER_ROLES, isOrganisationRoleAllowed } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { defaultMultitrackState } from "@/lib/multitrack-studio.mjs";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(2).max(160),
  programmeId: z.string().cuid().optional().nullable(),
  episodeId: z.string().cuid().optional().nullable(),
  studentGroupId: z.string().cuid().optional().nullable()
});

const mediaSelect = { id: true, name: true, originalName: true, mimeType: true, durationSeconds: true, mediaType: true };

async function validateLinks(organisationId, values) {
  const [programme, episode, group] = await Promise.all([
    values.programmeId ? prisma.schoolProgramme.findFirst({ where: { id: values.programmeId, organisationId, status: { not: "ARCHIVED" } }, select: { id: true } }) : null,
    values.episodeId ? prisma.schoolEpisode.findFirst({ where: { id: values.episodeId, organisationId, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } }, select: { id: true, programmeId: true } }) : null,
    values.studentGroupId ? prisma.studentGroup.findFirst({ where: { id: values.studentGroupId, organisationId }, select: { id: true } }) : null
  ]);
  if (values.programmeId && !programme) throw new Error("Choose an active programme from this school.");
  if (values.episodeId && !episode) throw new Error("Choose a draft or returned episode from this school.");
  if (values.studentGroupId && !group) throw new Error("Choose a student group from this school.");
  if (episode && values.programmeId && episode.programmeId !== values.programmeId) throw new Error("The episode does not belong to the selected programme.");
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const rightsDate = new Date();
  const [projects, programmes, episodes, groups, takes, catalogue, organisationAudio] = await Promise.all([
    prisma.audioProject.findMany({ where: { organisationId, type: "MULTITRACK", status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, status: true, currentVersion: true, programmeId: true, episodeId: true, studentGroupId: true, updatedAt: true } }),
    prisma.schoolProgramme.findMany({ where: { organisationId, status: "ACTIVE" }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.schoolEpisode.findMany({ where: { organisationId, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, programmeId: true } }),
    prisma.studentGroup.findMany({ where: { organisationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.audioTake.findMany({ where: { organisationId, status: "READY", mediaAsset: { status: "READY" } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, durationMs: true, mediaAsset: { select: mediaSelect } } }),
    prisma.track.findMany({ where: { status: "READY", OR: [{ licenceExpiresAt: null }, { licenceExpiresAt: { gte: rightsDate } }], mediaAsset: { organisationId: null, libraryType: "RUVANAS_CATALOGUE", status: "READY" } }, orderBy: [{ artist: "asc" }, { title: "asc" }], take: 250, select: { id: true, title: true, artist: true, mediaAsset: { select: mediaSelect } } }),
    prisma.mediaAsset.findMany({ where: { organisationId, status: "READY", mimeType: { startsWith: "audio/" } }, orderBy: { createdAt: "desc" }, take: 150, select: mediaSelect })
  ]);
  const sources = new Map();
  for (const item of takes) sources.set(item.mediaAsset.id, { ...item.mediaAsset, label: item.mediaAsset.name, sourceType: "TAKE", durationMs: item.durationMs || (item.mediaAsset.durationSeconds || 0) * 1000 });
  for (const item of catalogue) sources.set(item.mediaAsset.id, { ...item.mediaAsset, label: `${item.artist} — ${item.title}`, sourceType: "CATALOGUE", durationMs: (item.mediaAsset.durationSeconds || 0) * 1000 });
  for (const item of organisationAudio) if (!sources.has(item.id)) sources.set(item.id, { ...item, label: item.name, sourceType: "ORGANISATION", durationMs: (item.durationSeconds || 0) * 1000 });
  return NextResponse.json({
    projects, programmes, episodes, groups, sources: [...sources.values()],
    canApprove: isOrganisationRoleAllowed(access.membership.role, ORGANISATION_MANAGER_ROLES)
  });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a multitrack project title and check its optional programme details." }, { status: 400 });
  try {
    await validateLinks(access.organisation.id, parsed.data);
    const multitrack = defaultMultitrackState();
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.audioProject.create({ data: { organisationId: access.organisation.id, programmeId: parsed.data.programmeId || null, episodeId: parsed.data.episodeId || null, studentGroupId: parsed.data.studentGroupId || null, title: parsed.data.title, type: "MULTITRACK", editDecision: { multitrack: { mode: multitrack.mode, ducking: multitrack.ducking, master: multitrack.master } }, createdByUserId: access.user.id } });
      await Promise.all(multitrack.tracks.map((track) => tx.audioTrack.create({ data: { projectId: created.id, kind: track.kind, name: track.name, order: track.order, gainDb: track.gainDb, pan: track.pan, muted: track.muted, solo: track.solo, armed: track.armed, locked: track.locked, effectChainJson: { preset: track.preset, automation: track.automation } } })));
      await tx.audioProjectVersion.create({ data: { projectId: created.id, version: 1, state: { title: created.title, multitrack }, reason: "Multitrack project created", createdByUserId: access.user.id } });
      await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "MULTITRACK_PROJECT_CREATED", entityType: "AudioProject", entityId: created.id, details: { type: "MULTITRACK" } } });
      return created;
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The multitrack project could not be created." }, { status: 409 });
  }
}
