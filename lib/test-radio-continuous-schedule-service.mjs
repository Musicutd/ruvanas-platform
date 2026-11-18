import { randomUUID } from "node:crypto";
import { catalogueTestOwnerSessionValid } from "./catalogue-test-service.mjs";
import { TEST_RADIO_CONTINUOUS as P, signContinuousCommand, verifyContinuousCommand } from "./test-radio-continuous-policy.mjs";
import { loadAuthorizedContinuousRadio } from "./test-radio-continuous-service.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";
import { CONTINUOUS_SCHEDULE as S, scheduleHash, scheduleError, scheduleFormItems, parseContinuousSchedule,
  canonicalScheduleItems, simpleScheduleSource, compileContinuousSchedule, buildContinuousScheduleSnapshot, continuousScheduleLeadTime } from "./test-radio-continuous-schedule-policy.mjs";

const versionInclude = { items: { orderBy: { position: "asc" }, take: 201 } };
const scheduleInclude = { versions: { orderBy: { version: "desc" }, take: 1, include: versionInclude } };
const sourceInclude = { smartPlaylist: true };
function requireOwner(actorSession, now) {
  if (!catalogueTestOwnerSessionValid(actorSession, actorSession?.userId, now)) throw scheduleError("SCHEDULE_OWNER_REQUIRED");
}
async function control(db) { return (await db.auditLog.findUnique({ where: { id: S.controlId } }))?.details || null; }
function approval(envelope, { organisationId, env, now }) {
  const c = envelope?.command;
  if (!verifyContinuousCommand(envelope, env) || c.kind !== S.kind || c.action !== "APPROVE" || c.stationId !== P.stationId ||
    c.organisationId !== organisationId || c.snapshot?.stationId !== P.stationId || c.snapshot?.organisationId !== organisationId ||
    c.reviewHash !== scheduleHash(c.snapshot) || !Number.isFinite(Date.parse(c.issuedAt)) || Date.parse(c.issuedAt) > now.getTime() ||
    !Number.isFinite(Date.parse(c.effectiveAt)) || Date.parse(c.effectiveAt) - Date.parse(c.issuedAt) < S.minimumLeadMs) return null;
  return c;
}
async function stationScope(db) {
  const station = await db.station.findUnique({ where: { id: P.stationId }, select: { id: true, organisationId: true, productFamily: true,
    publicPlayerEnabled: true, stationWebsiteEnabled: true } });
  if (!station || station.id !== P.stationId || station.productFamily !== "ONLINE" || station.publicPlayerEnabled !== false || station.stationWebsiteEnabled !== false)
    throw scheduleError("SCHEDULE_SCOPE_INVALID");
  return station;
}
async function context(db, channelId) {
  const station = await stationScope(db);
  const channels = await db.channel.findMany({ where: { stationId: P.stationId, organisationId: station.organisationId,
    musicRightsUse: "ONLINE_RADIO", status: { in: ["DRAFT", "ACTIVE"] } }, select: { id: true, name: true, status: true }, orderBy: { id: "asc" }, take: 21 });
  if (channels.length > 20) throw scheduleError("SCHEDULE_SCOPE_INVALID");
  if (channelId && !channels.some(channel => channel.id === channelId)) throw scheduleError("SCHEDULE_CHANNEL_INVALID");
  const selected = channelId || (channels.length === 1 ? channels[0].id : null);
  const modes = await db.musicMode.findMany({ where: { organisationId: station.organisationId, source: "SMART_PLAYLIST",
    status: { in: ["DRAFT", "ACTIVE"] }, smartPlaylist: { organisationId: station.organisationId,
      status: { in: ["DRAFT", "ACTIVE"] }, rightsUse: "ONLINE_RADIO", simpleBuildMode: { not: null } } }, include: sourceInclude,
    orderBy: { id: "asc" }, take: S.maximumSources + 1 });
  if (modes.length > S.maximumSources) throw scheduleError("SCHEDULE_SOURCE_LIMIT");
  const sources = modes.filter(mode => mode.organisationId === station.organisationId).map(simpleScheduleSource).filter(Boolean);
  const schedule = selected ? await db.programmeSchedule.findFirst({ where: { organisationId: station.organisationId, channelId: selected }, include: scheduleInclude }) : null;
  if (schedule && (schedule.organisationId !== station.organisationId || schedule.channelId !== selected)) throw scheduleError("SCHEDULE_SCOPE_INVALID");
  return { station, channels, channelId: selected, sources, schedule };
}
async function reviewed(db, ctx, now, env) {
  const version = ctx.schedule?.versions?.[0];
  if (!version) return null;
  const authorized = await loadAuthorizedContinuousRadio(db, { now, env });
  if (authorized.station.organisationId !== ctx.station.organisationId) throw scheduleError("SCHEDULE_SCOPE_INVALID");
  const snapshot = buildContinuousScheduleSnapshot({ stationId: P.stationId, organisationId: ctx.station.organisationId,
    channelId: ctx.channelId, schedule: ctx.schedule, version, sources: ctx.sources, authorizedTracks: authorized.tracks });
  return { snapshot, authorized, reviewHash: scheduleHash(snapshot) };
}
async function writeControl(tx, command, actorSession, now, env) {
  let signature;
  try { signature = signContinuousCommand(command, env); }
  catch (error) { if (command.action !== "DISABLE") throw error; signature = null; }
  const data = { organisationId: command.organisationId, actorUserId: actorSession.userId, action: "TEST_RADIO_WEEKLY_CONTROL",
    entityType: "TestRadioWeeklySchedule", entityId: P.stationId, details: { command, signature } };
  await tx.auditLog.upsert({ where: { id: S.controlId }, create: { id: S.controlId, ...data }, update: data });
  await tx.auditLog.create({ data: { ...data, action: `TEST_RADIO_WEEKLY_${command.action}`, createdAt: now } });
}
export async function continuousScheduleDashboard(db, { actorSession, channelId, now = new Date(), env = process.env } = {}) {
  requireOwner(actorSession, now);
  const ctx = await context(db, channelId), warnings = [];
  const c = approval(await control(db), { organisationId: ctx.station.organisationId, env, now });
  let draft = null, authorizedForReview = null;
  if (ctx.schedule?.versions?.[0]) {
    const version = ctx.schedule.versions[0];
    let preview = null, reviewHash = null, readyToApprove = false;
    try {
      const normalized = parseContinuousSchedule({ channelId: ctx.channelId, name: ctx.schedule.name, timezone: ctx.schedule.timezone, items: scheduleFormItems(version.items) });
      preview = compileContinuousSchedule({ items: normalized.items.map((item, i) => ({ ...item, id: version.items[i].id })) },
        { timezone: ctx.schedule.timezone, startsAt: now, days: 7 });
      const review = await reviewed(db, ctx, now, env);
      authorizedForReview = review.authorized;
      const month = compileContinuousSchedule(review.snapshot, { timezone: ctx.schedule.timezone, startsAt: now, days: S.previewDays });
      if (month.conflicts.some(conflict => conflict.severity === "BLOCKING")) throw scheduleError("SCHEDULE_OVERLAP");
      reviewHash = review.reviewHash; readyToApprove = true;
      warnings.push(...month.warnings);
    } catch (error) { warnings.push(scheduleMessage(error.code)); }
    draft = { id: version.id, version: version.version, items: scheduleFormItems(version.items), reviewHash, readyToApprove,
      preview: preview ? { timezone: preview.timezone, startsAt: preview.startsAt.toISOString(), endsAt: preview.endsAt.toISOString(), days: preview.days,
        occurrences: preview.occurrences.map(item => ({ label: item.label, startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), sourceId: item.sourceId, priority: item.priority })),
        warnings: preview.warnings } : null };
  }
  if (!ctx.channels.length) warnings.push("Test Radio needs its existing Online Radio channel prepared first. This screen does not create or activate channels.");
  if (ctx.channels.length > 1 && !ctx.channelId) warnings.push("Choose the exact Test Radio channel to edit. No channel is selected automatically.");
  let runtime = null;
  if (c) {
    try {
      const authorized = authorizedForReview || await loadAuthorizedContinuousRadio(db, { now, env });
      runtime = await loadAuthorizedContinuousSchedule(db, { authorized, now, env });
      if (!runtime.enabled) warnings.push(scheduleMessage(runtime.reasonCode));
      warnings.push(...runtime.warnings);
    } catch (error) { runtime = disabled(error.code || "SCHEDULE_INVALID"); warnings.push(scheduleMessage(runtime.reasonCode)); }
  }
  return { stationId: P.stationId, channels: ctx.channels, sources: ctx.sources,
    schedule: ctx.schedule ? { id: ctx.schedule.id, name: ctx.schedule.name, timezone: ctx.schedule.timezone, channelId: ctx.schedule.channelId } : null,
    draft, approved: c ? { enabled: runtime?.enabled === true, reasonCode: runtime?.reasonCode || null, versionId: c.snapshot.versionId, version: c.snapshot.version, reviewHash: c.reviewHash,
      issuedAt: c.issuedAt, effectiveAt: c.effectiveAt, timezone: c.snapshot.timezone, channelId: c.snapshot.channelId } : null,
    canEdit: Boolean(ctx.channelId), warnings: [...new Set(warnings)] };
}
export async function saveContinuousScheduleDraft(db, { actorSession, input, now = new Date(), env = process.env } = {}) {
  requireOwner(actorSession, now);
  const parsed = parseContinuousSchedule(input);
  await runSerializableTransaction(db, async tx => {
    const ctx = await context(tx, parsed.channelId);
    if (parsed.items.some(item => !ctx.sources.some(source => source.id === item.musicModeId))) throw scheduleError("SCHEDULE_SOURCE_UNAVAILABLE");
    const highest = ctx.schedule?.versions?.[0]?.version || 0;
    if (highest >= S.maximumVersions) throw scheduleError("SCHEDULE_VERSION_LIMIT");
    if (ctx.schedule && ctx.schedule.timezone !== parsed.timezone) throw scheduleError("SCHEDULE_TIMEZONE_IMMUTABLE");
    let schedule = ctx.schedule;
    if (!schedule) schedule = await tx.programmeSchedule.create({ data: { organisationId: ctx.station.organisationId, channelId: parsed.channelId,
      name: parsed.name, timezone: parsed.timezone, createdByUserId: actorSession.userId } });
    else await tx.programmeSchedule.update({ where: { id: schedule.id }, data: { name: parsed.name } });
    const version = await tx.programmeScheduleVersion.create({ data: { organisationId: ctx.station.organisationId, scheduleId: schedule.id,
      version: highest + 1, status: "DRAFT", isActive: false, createdByUserId: actorSession.userId,
      // The parent version supplies both composite relation keys. Prisma's
      // unchecked nested item input deliberately excludes organisationId.
      items: { create: parsed.items } } });
    await tx.auditLog.create({ data: { organisationId: ctx.station.organisationId, actorUserId: actorSession.userId,
      action: "TEST_RADIO_WEEKLY_DRAFT", entityType: "ProgrammeScheduleVersion", entityId: version.id,
      details: { stationId: P.stationId, scheduleId: schedule.id, channelId: parsed.channelId, version: highest + 1 }, createdAt: now } });
  });
  return continuousScheduleDashboard(db, { actorSession, channelId: parsed.channelId, now, env });
}
export async function approveContinuousSchedule(db, { actorSession, channelId, versionId, reviewHash, overridesAcknowledged, now = new Date(), env = process.env } = {}) {
  requireOwner(actorSession, now);
  if (overridesAcknowledged !== true || !/^[a-f0-9]{64}$/.test(reviewHash || "")) throw scheduleError("SCHEDULE_REVIEW_REQUIRED");
  await runSerializableTransaction(db, async tx => {
    const ctx = await context(tx, channelId);
    if (!ctx.channelId || ctx.schedule?.versions?.[0]?.id !== versionId) throw scheduleError("SCHEDULE_REVIEW_CHANGED");
    const review = await reviewed(tx, ctx, now, env);
    if (review.reviewHash !== reviewHash) throw scheduleError("SCHEDULE_REVIEW_CHANGED");
    const preview = compileContinuousSchedule(review.snapshot, { timezone: review.snapshot.timezone, startsAt: now, days: S.previewDays });
    if (preview.conflicts.some(conflict => conflict.severity === "BLOCKING")) throw scheduleError("SCHEDULE_OVERLAP");
    const effectiveAt = continuousScheduleLeadTime(review.snapshot, now);
    const previous = await control(tx);
    const previousApproval = approval(previous, { organisationId: ctx.station.organisationId, env, now });
    // A replacement must not cancel an old programme before its stated
    // effective time. Wait for both old and new plans to have a quiet minute.
    if (previousApproval) continuousScheduleLeadTime(previousApproval.snapshot, now);
    const command = { kind: S.kind, action: "APPROVE", id: randomUUID(), stationId: P.stationId, organisationId: ctx.station.organisationId,
      actorUserId: actorSession.userId, grantId: review.authorized.grant.id, issuedAt: now.toISOString(), effectiveAt: effectiveAt.toISOString(),
      sequence: (Number.isSafeInteger(previous?.command?.sequence) ? previous.command.sequence : 0) + 1,
      reviewHash, snapshot: review.snapshot };
    await writeControl(tx, command, actorSession, now, env);
  });
  return continuousScheduleDashboard(db, { actorSession, channelId, now, env });
}
export async function disableContinuousSchedule(db, { actorSession, now = new Date(), env = process.env } = {}) {
  requireOwner(actorSession, now);
  await runSerializableTransaction(db, async tx => {
    // Emergency disable needs neither catalogue eligibility nor an active channel.
    const station = await tx.station.findUnique({ where: { id: P.stationId }, select: { id: true, organisationId: true } });
    if (!station || station.id !== P.stationId) throw scheduleError("SCHEDULE_SCOPE_INVALID");
    const previous = await control(tx);
    await writeControl(tx, { kind: S.kind, action: "DISABLE", id: randomUUID(), stationId: P.stationId, organisationId: station.organisationId,
      actorUserId: actorSession.userId, issuedAt: now.toISOString(), sequence: (Number.isSafeInteger(previous?.command?.sequence) ? previous.command.sequence : 0) + 1 }, actorSession, now, env);
  });
  return { stationId: P.stationId, disabled: true };
}
const disabled = reasonCode => ({ enabled: false, reasonCode, occurrences: [], warnings: [] });
export async function loadAuthorizedContinuousSchedule(db, { authorized, now = new Date(), env = process.env } = {}) {
  if (authorized?.station?.id !== P.stationId || authorized.grant?.stationId !== P.stationId ||
    authorized.grant.organisationId !== authorized.station.organisationId || !Array.isArray(authorized.tracks)) return disabled("SCHEDULE_SCOPE_INVALID");
  try {
    const c = approval(await control(db), { organisationId: authorized.station.organisationId, env, now });
    if (!c) return disabled("SCHEDULE_DISABLED");
    if (c.grantId !== authorized.grant.id) return disabled("SCHEDULE_GRANT_CHANGED");
    const snapshot = c.snapshot;
    if (!Array.isArray(snapshot.sources) || snapshot.sources.length > S.maximumSources || !Array.isArray(snapshot.items) || !snapshot.items.length || snapshot.items.length > 200)
      return disabled("SCHEDULE_SCOPE_INVALID");
    parseContinuousSchedule({ channelId: snapshot.channelId, name: snapshot.name, timezone: snapshot.timezone, items: scheduleFormItems(snapshot.items) });
    const actor = await db.user.findUnique({ where: { id: c.actorUserId }, select: { id: true, role: true } });
    if (actor?.role !== "SUPER_ADMIN") return disabled("SCHEDULE_OWNER_REVOKED");
    const channel = await db.channel.findFirst({ where: { id: snapshot.channelId, stationId: P.stationId, organisationId: snapshot.organisationId,
      musicRightsUse: "ONLINE_RADIO", status: { in: ["DRAFT", "ACTIVE"] } }, select: { id: true } });
    if (!channel) return disabled("SCHEDULE_CHANNEL_INVALID");
    const version = await db.programmeScheduleVersion.findFirst({ where: { id: snapshot.versionId, organisationId: snapshot.organisationId,
      scheduleId: snapshot.scheduleId, status: { in: ["DRAFT", "PUBLISHED"] }, schedule: { channelId: snapshot.channelId, organisationId: snapshot.organisationId } }, include: versionInclude });
    if (!version || version.version !== snapshot.version || scheduleHash(canonicalScheduleItems(version.items)) !== scheduleHash(snapshot.items)) return disabled("SCHEDULE_VERSION_CHANGED");
    const modes = await db.musicMode.findMany({ where: { id: { in: snapshot.sources.map(source => source.id) }, organisationId: snapshot.organisationId,
      source: "SMART_PLAYLIST", status: { in: ["DRAFT", "ACTIVE"] } }, include: sourceInclude, take: S.maximumSources + 1 });
    const current = new Map(authorized.tracks.map(entry => [entry.track.id, entry]));
    const usable = new Map(), warnings = [];
    for (const source of snapshot.sources) {
      if (!Array.isArray(source.tracks) || !source.tracks.length || source.tracks.length > S.maximumSourceTracks) return disabled("SCHEDULE_SCOPE_INVALID");
      const mode = modes.find(row => row.id === source.id && row.organisationId === snapshot.organisationId);
      // Edits to the recipe do not mutate an already reviewed version; archive
      // or deletion revokes it, and current catalogue rights always win.
      if (!simpleScheduleSource(mode)) { warnings.push(`Saved playlist ${source.name} is unavailable; its programmes use random AutoDJ.`); continue; }
      const tracks = source.tracks.filter(track => {
        const entry = current.get(track.trackId);
        return entry && entry.fingerprint === track.fingerprint && entry.track.mediaAssetId === track.mediaAssetId && entry.durationSeconds === track.durationSeconds;
      });
      if (tracks.length) usable.set(source.id, { source, tracks });
      else warnings.push(`No currently approved recordings remain in ${source.name}; random AutoDJ continues.`);
    }
    if (!usable.size) return { ...disabled("SCHEDULE_SOURCE_UNAVAILABLE"), warnings };
    const preview = compileContinuousSchedule(snapshot, { timezone: snapshot.timezone, startsAt: now, days: S.runtimeDays });
    if (preview.conflicts.some(conflict => conflict.severity === "BLOCKING")) return disabled("SCHEDULE_OVERLAP");
    const occurrences = preview.occurrences.filter(item => item.endsAt > now && item.startsAt.getTime() >= Date.parse(c.effectiveAt) && usable.has(item.sourceId)).map(item => {
      const { source, tracks } = usable.get(item.sourceId);
      return { id: scheduleHash([snapshot.versionId, item.itemId, item.startsAt.toISOString()]), itemId: item.itemId, label: item.label,
        sourceId: item.sourceId, startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), priority: item.priority,
        sourceFingerprint: scheduleHash(source), tracks, config: { buildMode: source.buildMode, genreCodes: source.genreCodes } };
    });
    return { enabled: true, stationId: P.stationId, channelId: snapshot.channelId, versionId: snapshot.versionId, revisionFingerprint: c.reviewHash,
      timezone: snapshot.timezone, effectiveAt: c.effectiveAt, validUntil: new Date(now.getTime() + 15_000).toISOString(), occurrences,
      warnings: [...new Set([...warnings, ...preview.warnings])] };
  } catch { return disabled("SCHEDULE_INVALID"); }
}
export function scheduleMessage(code) {
  const messages = {
    SCHEDULE_INPUT_INVALID: "Use a valid weekly or one-off programme with a saved music playlist.",
    SCHEDULE_CHANNEL_INVALID: "Choose an existing Online Radio channel belonging only to Test Radio.",
    SCHEDULE_SCOPE_INVALID: "Test Radio's isolated schedule needs review. No other channel is allowed.",
    SCHEDULE_SOURCE_LIMIT: "At most 20 saved playlist recipes can be reviewed in this isolated planner.",
    SCHEDULE_SOURCE_UNAVAILABLE: "A selected playlist is missing, archived or unsupported. Choose an existing genre playlist.",
    SCHEDULE_NO_APPROVED_MUSIC: "A selected playlist has no recordings passing the current music-rights checks.",
    SCHEDULE_PLAYLIST_TOO_LARGE: "A selected playlist matches more than 64 recordings. Choose a narrower genre playlist before approving this week; random AutoDJ is unchanged.",
    SCHEDULE_VERSION_LIMIT: "This planner reached its safe draft-history limit; ask for a history review.",
    SCHEDULE_TIMEZONE_IMMUTABLE: "This saved week's timezone cannot be changed. Its existing programmes keep their original local times.",
    SCHEDULE_REVIEW_REQUIRED: "Review the saved week and acknowledge its exact-time handovers before approval.",
    SCHEDULE_REVIEW_CHANGED: "The draft or approved music changed. Review the saved week again before approval.",
    SCHEDULE_OVERLAP: "Resolve overlapping programmes with the same priority before approval.",
    SCHEDULE_LEAD_TIME_REQUIRED: "Approve outside a programme already in progress, and leave at least one minute before its next start.",
    SCHEDULE_GRANT_CHANGED: "AutoDJ's owner approval changed. Review and approve the saved week again before its programmes can take over.",
    SCHEDULE_OWNER_REVOKED: "The owner who approved this week no longer has permission. The week needs a new owner review.",
    SCHEDULE_VERSION_CHANGED: "The approved saved version changed or was archived. Review and approve a current draft again.",
    CONTINUOUS_NOT_ENABLED: "Continuous AutoDJ must have its explicit owner approval before this week can be approved.",
  };
  return messages[code] || "The saved week cannot be approved yet. Check Test Radio's current playback permission and music access.";
}
