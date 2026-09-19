import { compileProgrammeScheduleHorizon } from "./advanced-scheduler.mjs";
import { PLAYOUT_SOURCE_PRIORITIES } from "./playout-resolver.mjs";

function incomplete(organisationId, channelId, capturedAt, reason) {
  return { complete: false, reason, organisationId, channelId, capturedAt, coversUntil: null, candidates: [], requiredInsertions: [] };
}

function validPublishedItem(item) {
  if (!item?.id || !["MUSIC_MODE", "RADIO_CLOCK", "SHOW_RUNDOWN"].includes(item.sourceType) ||
      !Number.isInteger(item.durationMinutes) || item.durationMinutes < 1 || item.durationMinutes > 1440 ||
      !Number.isInteger(item.priority) || item.priority < 0 || item.priority > 100) return false;
  if (item.recurrence === "ONE_OFF") return item.startsAt != null && !Number.isNaN(new Date(item.startsAt).valueOf());
  return item.recurrence === "WEEKLY" && Number.isInteger(item.weekday) && item.weekday >= 0 && item.weekday <= 6 &&
    Number.isInteger(item.startMinute) && item.startMinute >= 0 && item.startMinute < 1440;
}

// This is intentionally conservative. A source family without a station-output
// compiler blocks a Manual handoff instead of being silently omitted. It does
// not switch the encoder, expose media URLs, or certify listener playback.
export async function readStudioOnlineAuthority(tx, {
  organisationId, stationId, channelId, durationMs, instant = new Date()
}) {
  const now = instant instanceof Date ? instant : new Date(instant);
  if (!organisationId || !stationId || !channelId || Number.isNaN(now.valueOf()) ||
      !Number.isInteger(durationMs) || durationMs < 1 || durationMs > 12 * 60 * 60 * 1000) {
    return incomplete(organisationId, channelId, now, "INVALID_AUTHORITY_SCOPE");
  }
  const end = new Date(now.getTime() + durationMs);
  try {
    const snapshot = await (async () => {
      const channel = await tx.channel.findFirst({
        where: { id: channelId, organisationId, stationId, status: "ACTIVE" },
        select: { id: true }
      });
      if (!channel) return { blocker: "ONLINE_CHANNEL_NOT_ACTIVE" };
      const schedule = await tx.programmeSchedule.findFirst({
        where: { organisationId, channelId },
        select: { id: true, timezone: true, versions: {
          where: { status: "PUBLISHED", isActive: true }, orderBy: { version: "desc" }, take: 2,
          select: { id: true, version: true, items: { select: {
            id: true, position: true, label: true, recurrence: true, sourceType: true,
            weekday: true, startMinute: true, startsAt: true, durationMinutes: true, priority: true,
            musicModeId: true, radioClockId: true, schoolRundownId: true
          } } }
        } }
      });
      if (schedule?.versions?.length > 1) return { blocker: "MULTIPLE_ACTIVE_PROGRAMME_VERSIONS" };
      // Only station/channel-targeted campaigns belong to Online Radio.
      // Physical-location campaigns remain isolated from this output path.
      if (await tx.campaign.findFirst({ where: {
        organisationId, status: "PUBLISHED", targets: { some: { OR: [
          { targetType: "STATION", stationId }, { targetType: "CHANNEL", channelId }
        ] } }
      }, select: { id: true } })) return { blocker: "CAMPAIGN_OUTPUT_NOT_COMPILED" };
      if (await tx.radioAdvertisingPolicy.findFirst({ where: { organisationId, channelId, status: "ACTIVE" }, select: { id: true } })) return { blocker: "RADIO_ADVERTISING_OUTPUT_NOT_COMPILED" };
      if (await tx.playoutIntent.findFirst({ where: { organisationId, channelId, plannedStart: { lt: end }, expiresAt: { gt: now } }, select: { id: true } })) return { blocker: "PLAYER_INSERTION_OUTPUT_NOT_COMPILED" };
      if (await tx.channelAssignment.findFirst({ where: { channelId, activeFrom: { lt: end }, OR: [{ activeTo: null }, { activeTo: { gt: now } }] }, select: { id: true } })) return { blocker: "PHYSICAL_PLAYER_CHANNEL_ASSIGNED" };
      if (await tx.radioSyndicationAgreement.findFirst({ where: {
        targetOrganisationId: organisationId, targetStationId: stationId, status: "APPROVED", importedAt: { not: null },
        requestedFrom: { lt: end },
        AND: [{ OR: [{ targetChannelId: null }, { targetChannelId: channelId }] },
          { OR: [{ requestedUntil: null }, { requestedUntil: { gt: now } }] }]
      }, select: { id: true } })) return { blocker: "SYNDICATED_OUTPUT_NOT_COMPILED" };
      const failover = await tx.liveFailoverPolicy.findUnique({ where: { organisationId_channelId: { organisationId, channelId } }, select: { enabled: true } });
      if (failover?.enabled) {
        return { blocker: "LIVE_FAILOVER_OUTPUT_NOT_COMPILED" };
      }
      if (await tx.externalLiveSource.findFirst({ where: {
        organisationId, channelId, status: "ACTIVE",
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lt: end } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }
        ]
      }, select: { id: true } })) return { blocker: "EXTERNAL_LIVE_OUTPUT_NOT_COMPILED" };
      if (await tx.liveStudioSession.findFirst({ where: {
        organisationId, channelId, status: { in: ["CREATED", "SOUNDCHECK", "READY", "ON_AIR", "FALLBACK"] },
        scheduledStart: { lt: end }, scheduledEnd: { gt: now }
      }, select: { id: true } })) return { blocker: "BROWSER_LIVE_OUTPUT_NOT_COMPILED" };
      return { schedule };
    })();
    if (snapshot.blocker) return incomplete(organisationId, channelId, now, snapshot.blocker);
    const { schedule } = snapshot;
    const version = schedule?.versions?.[0];
    if (version && (!Array.isArray(version.items) || version.items.length === 0 || version.items.length > 200 || version.items.some((item) => !validPublishedItem(item)))) {
      return incomplete(organisationId, channelId, now, "PUBLISHED_PROGRAMME_INVALID");
    }
    // Include yesterday's overnight programmes as well as the entire item
    // horizon, including daylight-saving transitions.
    const occurrences = version ? compileProgrammeScheduleHorizon(version, { timezone: schedule.timezone, startsAt: new Date(now.getTime() - 36 * 60 * 60 * 1000), days: 4 }).occurrences : [];
    const candidates = occurrences
      .filter((occurrence) => occurrence.startsAt < end && occurrence.endsAt > now)
      .map((occurrence) => ({
        organisationId, channelId,
        sourceType: occurrence.sourceType === "SHOW_RUNDOWN" ? "SCHOOL_PROGRAMMING" : "PROGRAMME_SCHEDULE",
        sourceId: occurrence.itemId || `${version.id}:${occurrence.position}`,
        sourceRevision: `${schedule.id}:${version.version}:${occurrence.itemId || occurrence.position}`,
        label: occurrence.label || "Scheduled programme",
        priority: (occurrence.sourceType === "SHOW_RUNDOWN" ? PLAYOUT_SOURCE_PRIORITIES.SCHOOL_PROGRAMMING : PLAYOUT_SOURCE_PRIORITIES.PROGRAMME_SCHEDULE) + occurrence.priority,
        available: true,
        validFrom: occurrence.startsAt,
        validUntil: occurrence.endsAt,
        proofClassification: occurrence.sourceType === "SHOW_RUNDOWN" ? "SCHOOL" : "SCHEDULED"
      }));
    return { complete: true, reason: "AUTHORITATIVE_ONLINE_SNAPSHOT", organisationId, channelId, capturedAt: now, coversUntil: end, candidates, requiredInsertions: [] };
  } catch {
    return incomplete(organisationId, channelId, now, "AUTHORITY_SNAPSHOT_FAILED");
  }
}

export async function loadStudioOnlineAuthority(database, scope) {
  const now = scope?.instant instanceof Date ? scope.instant : new Date(scope?.instant ?? Date.now());
  if (!scope?.organisationId || !scope?.stationId || !scope?.channelId || Number.isNaN(now.valueOf()) ||
      !Number.isInteger(scope?.durationMs) || scope.durationMs < 1 || scope.durationMs > 12 * 60 * 60 * 1000) {
    return incomplete(scope?.organisationId, scope?.channelId, now, "INVALID_AUTHORITY_SCOPE");
  }
  try {
    return await database.$transaction((tx) => readStudioOnlineAuthority(tx, scope), { isolationLevel: "RepeatableRead" });
  } catch {
    return incomplete(scope.organisationId, scope.channelId, now, "AUTHORITY_SNAPSHOT_FAILED");
  }
}
