import { prisma } from "@/lib/prisma";
import { musicModeIsPlayable } from "@/lib/music-mode-playback.mjs";
import {
  assertProgrammeSchedulePublishable,
  compileProgrammeScheduleHorizon,
  formatProgrammeScheduleTime,
  programmeScheduleSourceId
} from "@/lib/advanced-scheduler.mjs";

const playbackModeInclude = { tracks: { include: { track: { include: { mediaAsset: true } } } } };

export const programmeScheduleInclude = {
  channel: { select: { id: true, name: true, status: true, station: { select: { name: true } } } },
  createdBy: { select: { id: true, name: true } },
  versions: {
    orderBy: { version: "desc" },
    take: 20,
    include: {
      createdBy: { select: { id: true, name: true } },
      publishedBy: { select: { id: true, name: true } },
      items: {
        orderBy: { position: "asc" },
        include: {
          musicMode: { select: { id: true, name: true, status: true } },
          radioClock: { select: { id: true, name: true, status: true, version: true, publishedVersion: true } },
          schoolRundown: { select: { id: true, status: true, revision: true, approvedRevision: true, episode: { select: { title: true } } } }
        }
      }
    }
  }
};

function safeSource(item) {
  if (item.musicMode) return { id: item.musicMode.id, name: item.musicMode.name, status: item.musicMode.status };
  if (item.radioClock) return { id: item.radioClock.id, name: item.radioClock.name, status: item.radioClock.status, version: item.radioClock.publishedVersion };
  if (item.schoolRundown) return { id: item.schoolRundown.id, name: item.schoolRundown.episode.title, status: item.schoolRundown.status, version: item.schoolRundown.approvedRevision };
  return null;
}

function safeVersion(version) {
  return {
    id: version.id,
    version: version.version,
    status: version.status,
    isActive: version.isActive,
    publishedAt: version.publishedAt?.toISOString() || null,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    createdBy: version.createdBy,
    publishedBy: version.publishedBy,
    items: version.items.map((item) => ({
      id: item.id,
      position: item.position,
      label: item.label,
      recurrence: item.recurrence,
      sourceType: item.sourceType,
      sourceId: programmeScheduleSourceId(item),
      source: safeSource(item),
      weekday: item.weekday,
      startMinute: item.startMinute,
      startTime: item.startMinute === null ? null : formatProgrammeScheduleTime(item.startMinute),
      startsAt: item.startsAt?.toISOString() || null,
      durationMinutes: item.durationMinutes,
      priority: item.priority
    }))
  };
}

export function safeProgrammeSchedule(schedule) {
  return {
    id: schedule.id,
    name: schedule.name,
    timezone: schedule.timezone,
    channel: schedule.channel,
    createdBy: schedule.createdBy,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
    versions: schedule.versions.map(safeVersion),
    activeVersion: schedule.versions.find((version) => version.isActive) ? safeVersion(schedule.versions.find((version) => version.isActive)) : null,
    latestVersion: schedule.versions.length ? Math.max(...schedule.versions.map((version) => version.version)) : 0
  };
}

export async function listProgrammeSchedules(organisationId) {
  const schedules = await prisma.programmeSchedule.findMany({
    where: { organisationId },
    include: programmeScheduleInclude,
    orderBy: { updatedAt: "desc" },
    take: 100
  });
  return schedules.map(safeProgrammeSchedule);
}

export async function programmeSchedulerSources(organisationId, instant = new Date()) {
  const [channels, musicModes, radioClocks, rundowns] = await Promise.all([
    prisma.channel.findMany({ where: { organisationId, status: "ACTIVE" }, select: { id: true, name: true, station: { select: { name: true } }, programmeSchedule: { select: { id: true } } }, orderBy: { name: "asc" }, take: 100 }),
    prisma.musicMode.findMany({ where: { organisationId, status: "ACTIVE" }, include: playbackModeInclude, orderBy: { name: "asc" }, take: 200 }),
    prisma.radioClock.findMany({ where: { organisationId, status: "PUBLISHED" }, select: { id: true, name: true, version: true, publishedVersion: true, durationSeconds: true }, orderBy: { name: "asc" }, take: 200 }),
    prisma.schoolRundown.findMany({ where: { organisationId, status: "APPROVED", approvedRevision: { not: null } }, select: { id: true, revision: true, approvedRevision: true, episode: { select: { title: true } }, _count: { select: { items: true } } }, orderBy: { updatedAt: "desc" }, take: 100 })
  ]);
  return {
    channels: channels.map((channel) => ({ id: channel.id, name: channel.station ? `${channel.station.name} / ${channel.name}` : channel.name, configured: Boolean(channel.programmeSchedule) })),
    musicModes: musicModes.filter((mode) => musicModeIsPlayable(mode, instant, { organisationId, requiredUse: "ONLINE_RADIO" })).map((mode) => ({ id: mode.id, name: mode.name })),
    radioClocks: radioClocks.filter((clock) => clock.version === clock.publishedVersion && clock.durationSeconds === 3600).map((clock) => ({ id: clock.id, name: `${clock.name} · v${clock.publishedVersion}`, durationMinutes: 60 })),
    rundowns: rundowns.filter((rundown) => rundown.revision === rundown.approvedRevision && rundown._count.items > 0).map((rundown) => ({ id: rundown.id, name: `${rundown.episode.title} · approved revision ${rundown.approvedRevision}` }))
  };
}

export async function validateProgrammeScheduleSources(client, organisationId, items, { requireReady = false, instant = new Date() } = {}) {
  const ids = (type) => [...new Set(items.filter((item) => item.sourceType === type).map(programmeScheduleSourceId).filter(Boolean))];
  const [musicModes, radioClocks, rundowns] = await Promise.all([
    client.musicMode.findMany({ where: { id: { in: ids("MUSIC_MODE") }, organisationId }, include: playbackModeInclude }),
    client.radioClock.findMany({ where: { id: { in: ids("RADIO_CLOCK") }, organisationId }, include: { items: true } }),
    client.schoolRundown.findMany({ where: { id: { in: ids("SHOW_RUNDOWN") }, organisationId }, include: { _count: { select: { items: true } } } })
  ]);
  const found = {
    MUSIC_MODE: new Map(musicModes.map((source) => [source.id, source])),
    RADIO_CLOCK: new Map(radioClocks.map((source) => [source.id, source])),
    SHOW_RUNDOWN: new Map(rundowns.map((source) => [source.id, source]))
  };
  for (const item of items) {
    const source = found[item.sourceType]?.get(programmeScheduleSourceId(item));
    if (!source) throw new Error(`${item.label} uses a source outside this organisation.`);
    if (!requireReady) continue;
    if (item.sourceType === "MUSIC_MODE" && !musicModeIsPlayable(source, instant, { organisationId, requiredUse: "ONLINE_RADIO" })) throw new Error(`${item.label} needs an active Music Mode with playable Online Radio tracks.`);
    if (item.sourceType === "RADIO_CLOCK" && (source.status !== "PUBLISHED" || source.version !== source.publishedVersion || source.durationSeconds !== 3600)) throw new Error(`${item.label} needs the current published 60-minute Radio Clock.`);
    if (item.sourceType === "SHOW_RUNDOWN" && (source.status !== "APPROVED" || source.revision !== source.approvedRevision || source._count.items < 1)) throw new Error(`${item.label} needs the current approved Show Builder rundown.`);
  }
}

export async function programmeScheduleCompatibilityWarnings(client, { organisationId, channelId, startsAt, endsAt }) {
  const assignments = await client.channelAssignment.findMany({
    where: { channelId, OR: [{ activeTo: null }, { activeTo: { gt: startsAt } }], activeFrom: { lt: endsAt } },
    select: { zoneId: true, zone: { select: { locationId: true } } },
    take: 200
  });
  const zoneIds = [...new Set(assignments.map((assignment) => assignment.zoneId))];
  const locationIds = [...new Set(assignments.map((assignment) => assignment.zone.locationId))];
  if (!zoneIds.length && !locationIds.length) return [];
  const [legacySchedules, schoolSlots] = await Promise.all([
    client.musicSchedule.count({ where: { organisationId, status: "PUBLISHED", OR: [{ zoneId: { in: zoneIds } }, { locationId: { in: locationIds } }] } }),
    client.schoolBroadcastSlot.count({ where: { organisationId, status: "APPROVED", startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, OR: [{ zoneId: { in: zoneIds } }, { locationId: { in: locationIds } }] } })
  ]);
  const warnings = [];
  if (legacySchedules) warnings.push(`${legacySchedules} existing retail schedule${legacySchedules === 1 ? "" : "s"} also target areas assigned to this channel and remain authoritative until Unified Playout.`);
  if (schoolSlots) warnings.push(`${schoolSlots} approved School Radio slot${schoolSlots === 1 ? "" : "s"} fall inside this preview and retain their existing protected priority.`);
  return warnings;
}

export async function previewProgrammeSchedule({ organisationId, scheduleId, versionId, days = 7, instant = new Date(), client = prisma }) {
  const version = await client.programmeScheduleVersion.findFirst({
    where: { id: versionId, scheduleId, organisationId },
    include: { schedule: { include: { channel: { select: { id: true, name: true } } } }, items: { orderBy: { position: "asc" }, include: { musicMode: { select: { id: true, name: true, status: true } }, radioClock: { select: { id: true, name: true, status: true, publishedVersion: true } }, schoolRundown: { select: { id: true, status: true, approvedRevision: true, episode: { select: { title: true } } } } } } }
  });
  if (!version) return null;
  const preview = compileProgrammeScheduleHorizon(version, { timezone: version.schedule.timezone, startsAt: instant, days });
  const warnings = await programmeScheduleCompatibilityWarnings(client, { organisationId, channelId: version.schedule.channelId, startsAt: preview.startsAt, endsAt: preview.endsAt });
  return {
    schedule: { id: version.schedule.id, name: version.schedule.name, timezone: version.schedule.timezone, channel: version.schedule.channel },
    version: safeVersion(version),
    ...preview,
    startsAt: preview.startsAt.toISOString(),
    endsAt: preview.endsAt.toISOString(),
    occurrences: preview.occurrences.map((occurrence) => ({ ...occurrence, startsAt: occurrence.startsAt.toISOString(), endsAt: occurrence.endsAt.toISOString() })),
    conflicts: preview.conflicts.map((conflict) => ({ ...conflict, startsAt: conflict.startsAt.toISOString(), endsAt: conflict.endsAt.toISOString() })),
    compatibilityWarnings: warnings,
    readyToPublish: !preview.conflicts.some((conflict) => conflict.severity === "BLOCKING")
  };
}

export async function publishProgrammeScheduleVersion({ organisationId, scheduleId, versionId, actorUserId, conflictsAcknowledged = false, instant = new Date() }) {
  return prisma.$transaction(async (tx) => {
    const version = await tx.programmeScheduleVersion.findFirst({
      where: { id: versionId, scheduleId, organisationId, status: "DRAFT", isActive: false },
      include: { schedule: { include: { channel: true } }, items: { orderBy: { position: "asc" } } }
    });
    if (!version) return null;
    if (version.schedule.channel.status !== "ACTIVE") throw new Error("Only an active channel can receive a published schedule.");
    const preview = assertProgrammeSchedulePublishable(version, { timezone: version.schedule.timezone, startsAt: instant, days: 31 });
    if (preview.conflicts.some((conflict) => conflict.severity === "CONTROLLED_OVERRIDE") && !conflictsAcknowledged) throw new Error("Acknowledge the priority overrides shown in the preview before publishing.");
    await validateProgrammeScheduleSources(tx, organisationId, version.items, { requireReady: true, instant });
    await tx.programmeScheduleVersion.updateMany({ where: { scheduleId, organisationId, isActive: true }, data: { isActive: false, status: "ARCHIVED" } });
    const updated = await tx.programmeScheduleVersion.update({
      where: { id: version.id },
      data: { status: "PUBLISHED", isActive: true, publishedAt: instant, publishedByUserId: actorUserId },
      include: { createdBy: { select: { id: true, name: true } }, publishedBy: { select: { id: true, name: true } }, items: { orderBy: { position: "asc" }, include: { musicMode: { select: { id: true, name: true, status: true } }, radioClock: { select: { id: true, name: true, status: true, publishedVersion: true } }, schoolRundown: { select: { id: true, status: true, approvedRevision: true, episode: { select: { title: true } } } } } } }
    });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "PROGRAMME_SCHEDULE_VERSION_PUBLISHED", entityType: "ProgrammeScheduleVersion", entityId: version.id, details: { scheduleId, channelId: version.schedule.channelId, version: version.version, itemCount: version.items.length, horizonDaysValidated: 31, conflictsAcknowledged } } });
    return safeVersion(updated);
  });
}

export async function archiveProgrammeSchedule({ organisationId, scheduleId, actorUserId }) {
  return prisma.$transaction(async (tx) => {
    const schedule = await tx.programmeSchedule.findFirst({ where: { id: scheduleId, organisationId }, select: { id: true, channelId: true } });
    if (!schedule) return null;
    const changed = await tx.programmeScheduleVersion.updateMany({ where: { scheduleId, organisationId, isActive: true }, data: { isActive: false, status: "ARCHIVED" } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "PROGRAMME_SCHEDULE_ARCHIVED", entityType: "ProgrammeSchedule", entityId: schedule.id, details: { channelId: schedule.channelId, activeVersionsArchived: changed.count } } });
    return { id: schedule.id, activeVersionsArchived: changed.count };
  });
}
