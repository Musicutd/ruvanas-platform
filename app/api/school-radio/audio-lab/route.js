import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ORGANISATION_CONTENT_ROLES } from "@/lib/permissions.mjs";
import { requireActiveSchoolRadio } from "@/lib/school-radio-access";
import { createDefaultEditDecision, normalizeEditDecision } from "@/lib/audio-lab.mjs";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(2).max(160),
  programmeId: z.string().cuid().optional().nullable(),
  episodeId: z.string().cuid().optional().nullable(),
  studentGroupId: z.string().cuid().optional().nullable()
});

const autosaveSchema = z.object({
  projectId: z.string().cuid(),
  title: z.string().trim().min(2).max(160),
  programmeId: z.string().cuid().optional().nullable(),
  episodeId: z.string().cuid().optional().nullable(),
  studentGroupId: z.string().cuid().optional().nullable(),
  editDecision: z.record(z.unknown()).default({}),
  reason: z.string().trim().max(120).optional().nullable()
});

function projectInclude() {
  return {
    programme: { select: { id: true, title: true } },
    episode: { select: { id: true, title: true, status: true } },
    studentGroup: { select: { id: true, name: true } },
    takes: {
      where: { status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        durationMs: true,
        deviceLabel: true,
        createdAt: true,
        mediaAsset: { select: { id: true, name: true, originalName: true, mimeType: true } },
        promoVersion: { select: { id: true, version: true, status: true, promoAsset: { select: { name: true } } } }
      }
    }
  };
}

async function validateLinks(organisationId, values) {
  const [programme, episode, group] = await Promise.all([
    values.programmeId
      ? prisma.schoolProgramme.findFirst({ where: { id: values.programmeId, organisationId, status: { not: "ARCHIVED" } }, select: { id: true } })
      : null,
    values.episodeId
      ? prisma.schoolEpisode.findFirst({ where: { id: values.episodeId, organisationId, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } }, select: { id: true, programmeId: true } })
      : null,
    values.studentGroupId
      ? prisma.studentGroup.findFirst({ where: { id: values.studentGroupId, organisationId }, select: { id: true } })
      : null
  ]);
  if (values.programmeId && !programme) throw new Error("Choose an active programme from this school.");
  if (values.episodeId && !episode) throw new Error("Choose a draft or returned episode from this school.");
  if (values.studentGroupId && !group) throw new Error("Choose a student group from this school.");
  if (episode && values.programmeId && episode.programmeId !== values.programmeId) {
    throw new Error("The episode does not belong to the selected programme.");
  }
}

export async function GET() {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const organisationId = access.organisation.id;
  const [projects, programmes, episodes, groups] = await Promise.all([
    prisma.audioProject.findMany({
      where: { organisationId, status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: projectInclude()
    }),
    prisma.schoolProgramme.findMany({ where: { organisationId, status: "ACTIVE" }, orderBy: { title: "asc" }, select: { id: true, title: true, studentGroupId: true } }),
    prisma.schoolEpisode.findMany({ where: { organisationId, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, programmeId: true, status: true } }),
    prisma.studentGroup.findMany({ where: { organisationId }, orderBy: { name: "asc" }, select: { id: true, name: true } })
  ]);
  return NextResponse.json({ projects, programmes, episodes, groups, limits: { maxRecordingMb: 250, uploadPartMb: 5 } });
}

export async function POST(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a project title and check its optional programme details." }, { status: 400 });
  try {
    await validateLinks(access.organisation.id, parsed.data);
    const editDecision = createDefaultEditDecision();
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.audioProject.create({
        data: {
          organisationId: access.organisation.id,
          programmeId: parsed.data.programmeId || null,
          episodeId: parsed.data.episodeId || null,
          studentGroupId: parsed.data.studentGroupId || null,
          title: parsed.data.title,
          editDecision,
          createdByUserId: access.user.id
        }
      });
      await tx.audioProjectVersion.create({ data: { projectId: created.id, version: 1, state: { title: created.title, editDecision }, reason: "Project created", createdByUserId: access.user.id } });
      await tx.auditLog.create({ data: { organisationId: access.organisation.id, actorUserId: access.user.id, action: "AUDIO_LAB_PROJECT_CREATED", entityType: "AudioProject", entityId: created.id, details: { type: "QUICK_RECORD" } } });
      return created;
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The AudioLab project could not be created." }, { status: 409 });
  }
}

export async function PATCH(request) {
  const access = await requireActiveSchoolRadio(ORGANISATION_CONTENT_ROLES);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = autosaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The AudioLab autosave details are invalid." }, { status: 400 });
  try {
    await validateLinks(access.organisation.id, parsed.data);
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.audioProject.findFirst({ where: { id: parsed.data.projectId, organisationId: access.organisation.id, status: { not: "ARCHIVED" } } });
      if (!current) throw Object.assign(new Error("The AudioLab project was not found."), { status: 404 });
      const editDecision = normalizeEditDecision(parsed.data.editDecision);
      const nextVersion = current.currentVersion + 1;
      const project = await tx.audioProject.update({ where: { id: current.id }, data: { title: parsed.data.title, programmeId: parsed.data.programmeId || null, episodeId: parsed.data.episodeId || null, studentGroupId: parsed.data.studentGroupId || null, editDecision, currentVersion: nextVersion } });
      await tx.audioProjectVersion.create({ data: { projectId: current.id, version: nextVersion, state: { title: project.title, programmeId: project.programmeId, episodeId: project.episodeId, studentGroupId: project.studentGroupId, editDecision }, reason: parsed.data.reason || "Autosave", createdByUserId: access.user.id } });
      return project;
    });
    return NextResponse.json({ project: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The AudioLab project could not be saved." }, { status: error?.status || 409 });
  }
}

