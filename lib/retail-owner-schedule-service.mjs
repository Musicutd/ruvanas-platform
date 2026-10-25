import { RETAIL_SUBSCRIBER_ORGANISATION_ID as ORG, RETAIL_SUBSCRIBER_STATION_ID as STATION } from "./retail-subscriber-access.mjs";
import { loadOwnerAuthorizedRetailPlayout } from "./retail-stream-playout-service.mjs";
import { loadRetailStreamSchedule } from "./retail-stream-schedule.mjs";
import { RETAIL_PLAYOUT } from "./retail-stream-playout-policy.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { normaliseGenreCode } from "./autodj-genre-entitlements.mjs";
import { CONTINUOUS_SCHEDULE as S, scheduleHash, scheduleFormItems, parseContinuousSchedule,
  compileContinuousSchedule, buildContinuousScheduleSnapshot, continuousScheduleLeadTime } from "./test-radio-continuous-schedule-policy.mjs";
import { retailDiagnosticAuditId, retailDiagnosticDraft, retailNormalPlanningVersion } from "./retail-schedule-draft-policy.mjs";

const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const text = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160) : "";
const stamp = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code: `RETAIL_SCHEDULE_${code}`, status }); };
const includeVersions = { orderBy: { version: "desc" }, take: S.maximumVersions + 1,
  include: { publishedBy: { select: { id: true, role: true } }, items: { orderBy: { position: "asc" }, take: 201 } } };
const requestAuditId = (action, actor, requestId) => `retail-schedule-${action}-${scheduleHash([ORG, STATION, actor, requestId.toLowerCase()]).slice(0, 40)}`;
const diagnosticLabel = "Test Retail · short handover check";

function source(mode) {
  const p = mode.smartPlaylist;
  if (mode.organisationId !== ORG || mode.source !== "SMART_PLAYLIST" || !["DRAFT", "ACTIVE"].includes(mode.status) ||
    !p || p.organisationId !== ORG || p.musicModeId !== mode.id || p.status !== mode.status || p.rightsUse !== "RETAIL_RADIO" ||
    p.territory !== "MT" || !["RANDOM_GENRE_POOL", "GENRE_SEQUENCE"].includes(p.simpleBuildMode) || !Array.isArray(p.genreCodes) ||
    !p.genreCodes.length || p.genreCodes.length > 48 || p.genreCodes.some(code => typeof code !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(code))) return null;
  return { id: mode.id, name: text(mode.name), buildMode: p.simpleBuildMode, genreCodes: p.genreCodes.map(normaliseGenreCode) };
}
async function owner(db, { actorUserId, organisationId, now }) {
  if (organisationId !== ORG) fail("SCOPE_INVALID", 404);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("INPUT_INVALID", 400);
  if (!id(actorUserId) || (await db.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true } }))?.role !== "SUPER_ADMIN") fail("OWNER_REQUIRED", 403);
}
function validateVersions(schedule) {
  if (!schedule) return;
  if (schedule.organisationId !== ORG || !Array.isArray(schedule.versions) || schedule.versions.length > S.maximumVersions) fail("SCOPE_INVALID");
  for (const v of schedule.versions) {
    if (v.organisationId !== ORG || v.scheduleId !== schedule.id || !Number.isInteger(v.version) || v.version < 1 ||
      !Array.isArray(v.items) || v.items.length > 200 || v.items.some(item => item.organisationId !== ORG || item.versionId !== v.id)) fail("SCOPE_INVALID");
  }
}
function validatePublished(version) {
  if (version && (version.status !== "PUBLISHED" || !version.isActive || !stamp(version.publishedAt) ||
    version.publishedBy?.id !== version.publishedByUserId || version.publishedBy?.role !== "SUPER_ADMIN")) fail("APPROVED_SCOPE_INVALID");
}
function previewDto(preview) {
  return { timezone: preview.timezone, startsAt: preview.startsAt.toISOString(), endsAt: preview.endsAt.toISOString(), days: preview.days,
    occurrences: preview.occurrences.map(row => ({ label: text(row.label), sourceId: row.sourceId, priority: row.priority,
      startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })), warnings: preview.warnings };
}
async function observation(db, authorized, runtime, now) {
  const row = await db.auditLog.findUnique({ where: { id: `retail-playout:observation:${STATION}` } }), value = row?.details;
  const source = authorized.source, time = Date.parse(value?.observedAt || "");
  const fresh = Boolean(row?.organisationId === ORG && row.entityId === STATION && row.entityType === "RetailSharedPlayout" &&
    row.action === "RETAIL_PLAYOUT_OBSERVATION" && value.grantId === authorized.grant.id &&
    id(authorized.assignment?.workerId) && typeof value.leaseOwner === "string" && value.leaseOwner.startsWith(`retail-playout:${STATION}:${authorized.assignment.workerId}:`) &&
    value.leaseOwner === source?.encoderLeaseOwner && source?.encoderLeaseUntil instanceof Date && source.encoderLeaseUntil > now &&
    Number.isFinite(time) && time <= now.getTime() && now.getTime() - time < RETAIL_PLAYOUT.observationFreshnessMs);
  const entry = fresh && value.state === "STREAMING" && authorized.tracks.find(item => item.track.id === value.trackId), track = entry?.track;
  const presentation = Date.parse(value?.presentationAt || "");
  // PCM can be prepared ahead, but the encoder waits until the presentation
  // target before sending MP3 bytes. A future plan is never current source proof.
  const validPresentation = Boolean(track && Number.isFinite(presentation) && presentation <= now.getTime() && presentation <= time + 1000 &&
    Number.isFinite(entry.durationSeconds) && entry.durationSeconds > 0 && now.getTime() - presentation <= entry.durationSeconds * 1000 + 10000);
  let phase = track && value.phase === "RANDOM" ? "RANDOM" : "UNKNOWN", programme = null;
  if (validPresentation && value.phase === "SCHEDULED" && runtime.enabled && value.programme?.scheduleRevision === runtime.revisionFingerprint) {
    const p = runtime.occurrences.find(item => item.id === value.programme.occurrenceId && item.tracks.some(t => t.trackId === track.id));
    const start = Date.parse(p?.startsAt || ""), end = Date.parse(p?.endsAt || "");
    if (p && presentation >= start && presentation < end && time >= start && time < end && now.getTime() >= start && now.getTime() < end) {
      phase = "SCHEDULED"; programme = { label: text(p.label), occurrenceId: p.id, scheduleRevision: runtime.revisionFingerprint, startsAt: p.startsAt, endsAt: p.endsAt };
    }
  }
  return { fresh, state: fresh ? value.state : "UNKNOWN", observedAt: Number.isFinite(time) ? new Date(time).toISOString() : null,
    checkedAt: now.toISOString(), phase, programme, track: track ? { id: track.id, title: text(track.title), artist: text(track.artist) } : null,
    presentationAt: validPresentation ? new Date(presentation).toISOString() : null,
    sourceLatenessMs: validPresentation && Number.isFinite(value?.sourceLatenessMs) && value.sourceLatenessMs >= 0 && value.sourceLatenessMs <= 3600000 ? value.sourceLatenessMs : null, senderEvidenceOnly: true };
}

export function createRetailOwnerScheduleService({ loadAuthorized = loadOwnerAuthorizedRetailPlayout } = {}) {
  async function context(db, options) {
    await owner(db, options);
    const authorized = await loadAuthorized(db, { actorUserId: options.actorUserId, organisationId: ORG, stationId: STATION, now: options.now, env: options.env });
    const station = authorized?.station;
    if (station?.id !== STATION || station.organisationId !== ORG || station.productFamily !== "RETAIL" || station.status !== "DRAFT" ||
      station.publicPlayerEnabled !== false || station.stationWebsiteEnabled !== false || station.listenerRequestsEnabled !== false || station.audiencePolicy !== "INTERNAL" ||
      authorized.grant?.stationId !== STATION || authorized.grant?.organisationId !== ORG || !authorized.pilotAccess?.approved) fail("SCOPE_INVALID");
    const channels = await db.channel.findMany({ where: { stationId: STATION }, select: { id: true, name: true, status: true, stationId: true,
      organisationId: true, musicRightsUse: true }, orderBy: { id: "asc" }, take: 2 });
    if (channels.length !== 1 || channels[0].organisationId !== ORG || channels[0].stationId !== STATION || channels[0].musicRightsUse !== "RETAIL_RADIO" ||
      !["DRAFT", "ACTIVE"].includes(channels[0].status)) fail("CHANNEL_REQUIRED");
    const channel = channels[0], schedule = await db.programmeSchedule.findFirst({ where: { organisationId: ORG, channelId: channel.id }, include: { versions: includeVersions } });
    if (schedule && schedule.channelId !== channel.id) fail("SCOPE_INVALID");
    validateVersions(schedule);
    const modes = await db.musicMode.findMany({ where: { organisationId: ORG, source: "SMART_PLAYLIST", status: { in: ["DRAFT", "ACTIVE"] },
      smartPlaylist: { organisationId: ORG, rightsUse: "RETAIL_RADIO", status: { in: ["DRAFT", "ACTIVE"] } } }, include: { smartPlaylist: true }, orderBy: { id: "asc" }, take: S.maximumSources + 1 });
    if (modes.length > S.maximumSources) fail("SOURCE_LIMIT");
    const sources = modes.map(source).filter(Boolean), versions = schedule?.versions || [];
    const published = versions.filter(v => v.isActive);
    if (published.length > 1) fail("APPROVED_SCOPE_INVALID");
    validatePublished(published[0]);
    const normalDraft = await retailNormalPlanningVersion(db, versions);
    const draft = versions.find(v => v.status === "DRAFT" && !v.isActive && v.version >= (normalDraft?.version || 0)) || null;
    return { authorized, channel, schedule, modes, sources, versions, highest: versions[0]?.version || 0,
      published: published[0] || null, draft, normalDraft };
  }
  function snapshot(ctx, version) {
    for (const item of version.items) if (!stamp(item.updatedAt)) fail("REVIEW_CHANGED");
    return buildContinuousScheduleSnapshot({ stationId: STATION, organisationId: ORG, channelId: ctx.channel.id,
      schedule: ctx.schedule, version, sources: ctx.sources, authorizedTracks: ctx.authorized.tracks });
  }
  async function review(db, ctx, version, now) {
    if (!version || version.status !== "DRAFT" || version.isActive) fail("DRAFT_REQUIRED");
    const snap = snapshot(ctx, version), modeIds = snap.sources.map(row => row.id);
    const modes = ctx.modes.filter(mode => modeIds.includes(mode.id));
    if (modes.some(mode => !stamp(mode.updatedAt) || !stamp(mode.smartPlaylist.updatedAt)) ||
      [...version.items, ...modes, ...modes.map(m => m.smartPlaylist)].some(row => row.updatedAt > now)) fail("REVIEW_CHANGED");
    const month = compileContinuousSchedule(snap, { timezone: snap.timezone, startsAt: now, days: S.previewDays });
    if (month.conflicts.some(c => c.severity === "BLOCKING")) fail("OVERLAP");
    const effectiveAt = continuousScheduleLeadTime(snap, now);
    if (ctx.published) continuousScheduleLeadTime(snapshot(ctx, ctx.published), now);
    const otherActive = await db.channel.count({ where: { organisationId: ORG, status: "ACTIVE", id: { not: ctx.channel.id } } });
    if (!Number.isInteger(ctx.authorized.entitlements.streamLimit) || ctx.authorized.entitlements.streamLimit < 1 ||
      otherActive >= ctx.authorized.entitlements.streamLimit) fail("CHANNEL_LIMIT");
    const diagnostic = await retailDiagnosticDraft(db, version);
    if (diagnostic && (diagnostic.copiedApprovedVersionId !== (ctx.published?.id || null) ||
      !Number.isFinite(Date.parse(diagnostic.startsAt)) || Date.parse(diagnostic.startsAt) < now.getTime() + S.minimumLeadMs)) fail("LEAD_TIME_REQUIRED");
    const reviewHash = scheduleHash({ snapshot: snap, channelStatus: ctx.channel.status,
      previousPublished: ctx.published ? snapshot(ctx, ctx.published) : null,
      versionUpdatedAt: stamp(version.updatedAt), itemUpdatedAt: version.items.map(row => [row.id, stamp(row.updatedAt)]),
      grantId: ctx.authorized.grant.id, pilotAccess: ctx.authorized.pilotAccess.fingerprint,
      modes: modes.map(mode => ({ id: mode.id, status: mode.status, updatedAt: stamp(mode.updatedAt), playlist: {
        id: mode.smartPlaylist.id, status: mode.smartPlaylist.status, updatedAt: stamp(mode.smartPlaylist.updatedAt),
        version: mode.smartPlaylist.version, territory: mode.smartPlaylist.territory } })), diagnostic });
    return { snap, reviewHash, modes, effectiveAt, diagnostic, preview: month };
  }
  async function dashboard(db, { now = new Date(), env = process.env, ...options } = {}) {
    const ctx = await context(db, { ...options, now, env }), warnings = [];
    let draft = null;
    if (ctx.draft) {
      let prepared = null, preview = null;
      try { prepared = await review(db, ctx, ctx.draft, now); preview = previewDto(compileContinuousSchedule(prepared.snap, { timezone: ctx.schedule.timezone, startsAt: now, days: 7 })); }
      catch (error) { warnings.push(retailOwnerScheduleError(error).error); }
      const diagnostic = await retailDiagnosticDraft(db, ctx.draft);
      draft = { id: ctx.draft.id, version: ctx.draft.version, items: scheduleFormItems(ctx.draft.items), reviewHash: prepared?.reviewHash || null,
        readyToApprove: Boolean(prepared), diagnostic: Boolean(diagnostic), preservedDraftVersionId: diagnostic?.preservedDraftVersionId || null, preview };
    }
    const runtime = await loadRetailStreamSchedule(db, { authorized: ctx.authorized, now });
    if (ctx.published && !runtime.enabled) warnings.push("The approved schedule is not currently eligible for the worker; random AutoDJ remains the fallback.");
    return { organisationId: ORG, stationId: STATION, channelId: ctx.channel.id, channels: [{ id: ctx.channel.id, name: text(ctx.channel.name), status: ctx.channel.status }],
      sources: ctx.sources.map(s => ({ ...s, eligibleTrackCount: ctx.authorized.tracks.filter(entry => entry.track.mediaAsset.genres.some(g => s.genreCodes.includes(normaliseGenreCode(g.mediaGenre?.slug)))).length })),
      schedule: ctx.schedule ? { id: ctx.schedule.id, name: text(ctx.schedule.name), timezone: ctx.schedule.timezone, channelId: ctx.channel.id } : null,
      highestVersionId: ctx.versions[0]?.id || null, draft, preservedDraftVersionId: ctx.normalDraft?.status === "DRAFT" ? ctx.normalDraft.id : null,
      approved: ctx.published ? { enabled: runtime.enabled === true, versionId: ctx.published.id, version: ctx.published.version,
        publishedAt: stamp(ctx.published.publishedAt), effectiveAt: runtime.effectiveAt || null, channelId: ctx.channel.id,
        diagnostic: Boolean(await retailDiagnosticDraft(db, ctx.published)), reasonCode: runtime.reasonCode || null } : null,
      observation: await observation(db, ctx.authorized, runtime, now), warnings: [...new Set(warnings)], canApprove: Boolean(draft?.readyToApprove), canPrepareTest: ctx.sources.length > 0 };
  }
  async function approve(db, { actorUserId, organisationId, versionId, reviewHash, requestId, overridesAcknowledged, now = new Date(), env = process.env } = {}) {
    if (!id(versionId) || !/^[a-f0-9]{64}$/.test(reviewHash || "") || !uuid(requestId) || overridesAcknowledged !== true) fail("REVIEW_REQUIRED", 400);
    await runSerializableTransaction(db, async tx => {
      await owner(tx, { actorUserId, organisationId, now });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-subscriber-planning:${ORG}`}))`;
      const ctx = await context(tx, { actorUserId, organisationId, now, env }), auditId = requestAuditId("approval", actorUserId, requestId),
        requestHash = scheduleHash([versionId, reviewHash, true]), prior = await tx.auditLog.findUnique({ where: { id: auditId } });
      if (prior) {
        if (prior.action !== "RETAIL_SCHEDULE_APPROVED" || prior.organisationId !== ORG || prior.actorUserId !== actorUserId ||
          prior.entityId !== versionId || prior.details?.requestHash !== requestHash || ctx.published?.id !== versionId) fail("REVIEW_CHANGED");
        return;
      }
      if (ctx.draft?.id !== versionId) fail("REVIEW_CHANGED");
      const checked = await review(tx, ctx, ctx.draft, now);
      if (checked.reviewHash !== reviewHash) fail("REVIEW_CHANGED");
      // Promotion is atomic with publication. Explicit equal timestamps avoid
      // Prisma @updatedAt accidentally appearing later than publishedAt.
      for (const mode of checked.modes) if (mode.status === "DRAFT") {
        const a = await tx.musicMode.updateMany({ where: { id: mode.id, organisationId: ORG, status: "DRAFT", updatedAt: mode.updatedAt }, data: { status: "ACTIVE", updatedAt: now } });
        const b = await tx.smartPlaylist.updateMany({ where: { id: mode.smartPlaylist.id, organisationId: ORG, musicModeId: mode.id,
          status: "DRAFT", updatedAt: mode.smartPlaylist.updatedAt }, data: { status: "ACTIVE", publishedByUserId: actorUserId, publishedAt: now, updatedAt: now } });
        if (a.count !== 1 || b.count !== 1) fail("REVIEW_CHANGED");
      }
      if (ctx.channel.status === "DRAFT" && (await tx.channel.updateMany({ where: { id: ctx.channel.id, organisationId: ORG,
        stationId: STATION, musicRightsUse: "RETAIL_RADIO", status: "DRAFT" }, data: { status: "ACTIVE", updatedAt: now } })).count !== 1) fail("REVIEW_CHANGED");
      if (ctx.published && (await tx.programmeScheduleVersion.updateMany({ where: { id: ctx.published.id, organisationId: ORG,
        scheduleId: ctx.schedule.id, status: "PUBLISHED", isActive: true }, data: { status: "ARCHIVED", isActive: false, updatedAt: now } })).count !== 1) fail("REVIEW_CHANGED");
      const changed = await tx.programmeScheduleVersion.updateMany({ where: { id: versionId, organisationId: ORG, scheduleId: ctx.schedule.id,
        status: "DRAFT", isActive: false }, data: { status: "PUBLISHED", isActive: true, publishedAt: now, publishedByUserId: actorUserId, updatedAt: now } });
      if (changed.count !== 1) fail("REVIEW_CHANGED");
      const runtime = await loadRetailStreamSchedule(tx, { authorized: ctx.authorized, now });
      if (!runtime.enabled || runtime.versionId !== versionId) fail("WORKER_REVIEW_FAILED");
      await tx.auditLog.create({ data: { id: auditId, organisationId: ORG, actorUserId, action: "RETAIL_SCHEDULE_APPROVED",
        entityType: "ProgrammeScheduleVersion", entityId: versionId, createdAt: now, details: { stationId: STATION, channelId: ctx.channel.id,
          requestHash, reviewHash, diagnostic: Boolean(checked.diagnostic), preservedDraftVersionId: checked.diagnostic?.preservedDraftVersionId || null,
          priorVersionId: ctx.published?.id || null, effectiveAt: checked.effectiveAt.toISOString(), workerRestarted: false } } });
    });
    return { ...await dashboard(db, { actorUserId, organisationId, now, env }), approvedVersionId: versionId };
  }
  async function prepareTest(db, { actorUserId, organisationId, sourceId, startsAt, durationMinutes, requestId, baseVersionId, now = new Date(), env = process.env } = {}) {
    if (!id(sourceId) || !uuid(requestId) || baseVersionId !== null && !id(baseVersionId) || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 5 ||
      typeof startsAt !== "string" || !Number.isFinite(Date.parse(startsAt)) || new Date(startsAt).toISOString() !== startsAt) fail("TEST_INPUT_INVALID", 400);
    const savedVersionId = await runSerializableTransaction(db, async tx => {
      await owner(tx, { actorUserId, organisationId, now });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-subscriber-planning:${ORG}`}))`;
      const ctx = await context(tx, { actorUserId, organisationId, now, env }), auditId = requestAuditId("test", actorUserId, requestId),
        requestHash = scheduleHash([sourceId, startsAt, durationMinutes, baseVersionId]), prior = await tx.auditLog.findUnique({ where: { id: auditId } });
      if (prior) {
        if (prior.action !== "RETAIL_SCHEDULE_TEST_PREPARED" || prior.organisationId !== ORG || prior.actorUserId !== actorUserId ||
          prior.details?.requestHash !== requestHash || ctx.draft?.id !== prior.entityId) fail("REVIEW_CHANGED");
        return prior.entityId;
      }
      if ((ctx.versions[0]?.id || null) !== baseVersionId || ctx.highest >= S.maximumVersions) fail("REVIEW_CHANGED");
      if (Date.parse(startsAt) < now.getTime() + 120000 || Date.parse(startsAt) > now.getTime() + 60 * 60 * 1000) fail("TEST_LEAD_REQUIRED");
      if (!ctx.sources.some(s => s.id === sourceId)) fail("SOURCE_UNAVAILABLE");
      let schedule = ctx.schedule;
      if (!schedule) schedule = await tx.programmeSchedule.create({ data: { organisationId: ORG, channelId: ctx.channel.id,
        name: "Test Retail weekly plan", timezone: "Europe/Malta", createdByUserId: actorUserId } });
      const parsed = parseContinuousSchedule({ channelId: ctx.channel.id, name: schedule.name, timezone: schedule.timezone,
        items: [...scheduleFormItems(ctx.published?.items || []), { label: diagnosticLabel, recurrence: "ONE_OFF", sourceType: "MUSIC_MODE", sourceId,
          startsAt, weekday: null, startTime: null, durationMinutes, priority: 50 }] });
      const version = await tx.programmeScheduleVersion.create({ data: { organisationId: ORG, scheduleId: schedule.id, version: ctx.highest + 1,
        status: "DRAFT", isActive: false, createdByUserId: actorUserId, items: { create: parsed.items } }, include: { items: { orderBy: { position: "asc" } } } });
      const snap = snapshot({ ...ctx, schedule }, version), compiled = compileContinuousSchedule(snap, { timezone: schedule.timezone, startsAt: now, days: 31 });
      // A diagnostic may not override a real approved programme, at any priority.
      if (compiled.conflicts.length) fail("OVERLAP");
      continuousScheduleLeadTime(snap, now);
      const preservedDraftVersionId = ctx.normalDraft?.status === "DRAFT" ? ctx.normalDraft.id : null;
      await tx.auditLog.create({ data: { id: retailDiagnosticAuditId(version.id), organisationId: ORG, actorUserId,
        action: "RETAIL_SCHEDULE_DIAGNOSTIC_DRAFT", entityType: "ProgrammeScheduleVersion", entityId: version.id, createdAt: now,
        details: { stationId: STATION, versionId: version.id, preservedDraftVersionId, copiedApprovedVersionId: ctx.published?.id || null, sourceId, startsAt, durationMinutes } } });
      await tx.auditLog.create({ data: { id: auditId, organisationId: ORG, actorUserId, action: "RETAIL_SCHEDULE_TEST_PREPARED",
        entityType: "ProgrammeScheduleVersion", entityId: version.id, createdAt: now, details: { stationId: STATION, requestHash, preservedDraftVersionId } } });
      return version.id;
    });
    return { ...await dashboard(db, { actorUserId, organisationId, now, env }), savedVersionId };
  }
  return { dashboard, approve, prepareTest };
}
const service = createRetailOwnerScheduleService();
export const retailOwnerScheduleDashboard = service.dashboard;
export const approveRetailOwnerSchedule = service.approve;
export const prepareRetailOwnerScheduleTest = service.prepareTest;

const MESSAGES = {
  OWNER_REQUIRED: "Sign in with the current Super Admin owner account.", SCOPE_INVALID: "This review is available only for the existing Test Retail workspace.",
  INPUT_INVALID: "Use the current Retail review controls.", CHANNEL_REQUIRED: "Test Retail needs one unambiguous private planning channel before review.",
  SOURCE_LIMIT: "The playlist inventory needs review.", SOURCE_UNAVAILABLE: "Choose an eligible saved Retail playlist.",
  APPROVED_SCOPE_INVALID: "The existing approved schedule needs administrator review before replacement.", DRAFT_REQUIRED: "No pending Retail draft is available.",
  REVIEW_CHANGED: "The draft, music permissions or approved schedule changed. Refresh and review again.",
  REVIEW_REQUIRED: "Review the exact version and acknowledge its on-air changes before approving.", OVERLAP: "Resolve overlapping programmes before approval or a short test.",
  CHANNEL_LIMIT: "The existing active-channel allowance leaves no room for this planning channel. No limit was changed.",
  WORKER_REVIEW_FAILED: "The proposed schedule did not pass the existing worker's checks. Nothing was published.",
  TEST_INPUT_INVALID: "Choose a saved playlist, a future UTC start and a test length from one to five minutes.",
  TEST_LEAD_REQUIRED: "Prepare the short test between two and sixty minutes before its start, then review and approve it separately.",
  LEAD_TIME_REQUIRED: "Leave at least one minute before a programme starts, and approve outside any current programme.",
  UNAVAILABLE: "Retail schedule review could not be confirmed. Refresh the saved status before trying again."
};
export function retailOwnerScheduleError(error) {
  const incoming = error?.code === "SCHEDULE_LEAD_TIME_REQUIRED" ? "LEAD_TIME_REQUIRED" : String(error?.code || "").replace(/^RETAIL_SCHEDULE_/, "");
  const code = Object.hasOwn(MESSAGES, incoming) ? incoming : "UNAVAILABLE";
  return { code: `RETAIL_SCHEDULE_${code}`, error: MESSAGES[code], status: code === "UNAVAILABLE" ? 503 : [400, 403, 404, 409].includes(error?.status) ? error.status : 409 };
}
