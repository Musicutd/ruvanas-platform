import { z } from "zod";
import { localMinuteToUtc } from "../advanced-scheduler.mjs";
import { readReportsPolicy, reportLocationsSchema, reportQuerySchema, reportExportSchema,
  REPORT_PAGE_SIZE, REPORT_MAX_ROWS, REPORT_MAX_RANGE_DAYS, REPORT_MAX_AGE_MS } from "./reports-contracts.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { offerTermsSchema } from "./offer-contracts.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { REVERSAL_REASONS } from "./reversal-contracts.mjs";
import { campaignLinkSnapshotSchema } from "./campaign-link-dtos.mjs";
import { rewardsDenied } from "./errors.mjs";

const DAY = 86_400_000;
const TX_OPTIONS = Object.freeze({ isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 });
const locationSelect = Object.freeze({ id: true, organisationId: true, name: true, status: true });
const claimSelect = Object.freeze({ id: true, organisationId: true, locationId: true, offerId: true, revision: true, publicShopName: true, createdAt: true,
  publishedSnapshot: { select: { organisationId: true, offerId: true, revision: true, terms: true,
    campaignLink: { select: { organisationId: true, offerId: true, revision: true, campaignPublicationRevision: true, snapshot: true, pinnedAt: true } } } }
});
const receiptSelect = Object.freeze({ id: true, organisationId: true, locationId: true, offerId: true, claimId: true, occurredAt: true,
  claim: { select: claimSelect },
  reversal: { select: { organisationId: true, redemptionId: true, occurredAt: true, reason: true } }
});
const textSchema = z.string().min(1).max(140);
const finiteDate = value => value instanceof Date && Number.isFinite(value.getTime());
class ReportAbort extends Error { constructor(result) { super(result.code); this.result = result; } }
const abort = code => { throw new ReportAbort(rewardsDenied(code)); };
const allow = result => { if (!result?.ok) abort(result?.code); return result; };
const iso = date => { if (!finiteDate(date)) abort("UNAVAILABLE"); return date.toISOString(); };

function localDate(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(date, days) {
  const value = new Date(`${date}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function midnight(date, timezone) {
  try { return localMinuteToUtc(date, 0, timezone); } catch { abort("INVALID_REQUEST"); }
}
function boundsAt(now, timezone, retentionDays) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 1_000_000_000) abort("NOT_ENTITLED");
  // Very large granted retentions must not overflow Date's representable range.
  const floor = new Date(Math.max(Date.UTC(1969, 11, 30), now.getTime() - retentionDays * DAY));
  let earliestDate = localDate(floor, timezone);
  if (earliestDate < "1970-01-01") earliestDate = "1970-01-01";
  else if (midnight(earliestDate, timezone) < floor) earliestDate = addDays(earliestDate, 1);
  const latestDate = localDate(now, timezone);
  if (latestDate < "1970-01-01" || earliestDate > latestDate) abort("NOT_ENTITLED");
  return { earliestDate, latestDate, maxRangeDays: REPORT_MAX_RANGE_DAYS };
}
function defaultsFor(bounds) {
  return { fromDate: [addDays(bounds.latestDate, -6), bounds.earliestDate].sort().at(-1), toDate: bounds.latestDate };
}
function windowAt(values, access, timezone, now, asOf) {
  const bounds = boundsAt(now, timezone, access.limits.analyticsRetentionDays);
  if (values.fromDate > values.toDate || values.toDate > bounds.latestDate ||
    (Date.parse(`${values.toDate}T00:00:00Z`) - Date.parse(`${values.fromDate}T00:00:00Z`)) / DAY + 1 > REPORT_MAX_RANGE_DAYS) abort("INVALID_REQUEST");
  if (values.fromDate < bounds.earliestDate) abort("REPORT_EXPIRED");
  if (!finiteDate(asOf) || asOf > now) abort("INVALID_REQUEST");
  if (now - asOf > REPORT_MAX_AGE_MS) abort("REPORT_EXPIRED");
  const from = midnight(values.fromDate, timezone), to = midnight(addDays(values.toDate, 1), timezone);
  if (asOf < from) abort("INVALID_REQUEST");
  return { from, to };
}
function scopeHas(access, id) { return access.locationScope.kind === "ALL_LOCATIONS" || access.locationScope.locationIds.includes(id); }
function sameAuthority(a, b) {
  return a.organisationId === b.organisationId && a.userId === b.userId && a.organisationMemberId === b.organisationMemberId &&
    a.authority.sessionId === b.authority.sessionId && a.authority.subscriptionId === b.authority.subscriptionId && a.authority.role === b.authority.role &&
    JSON.stringify(a.locationScope) === JSON.stringify(b.locationScope) && JSON.stringify(a.limits) === JSON.stringify(b.limits);
}
function locationView(row, access) {
  if (!row || row.organisationId !== access.organisationId || row.status !== "ACTIVE" || !rewardIdSchema.safeParse(row.id).success ||
    typeof row.name !== "string" || row.name.length < 1 || row.name.length > 500 || !scopeHas(access, row.id)) abort("LOCATION_UNAVAILABLE");
  return { id: row.id, name: row.name };
}
function claimView(claim, access, latest) {
  const snapshot = claim?.publishedSnapshot;
  if (!claim || !rewardIdSchema.safeParse(claim.id).success || !rewardIdSchema.safeParse(claim.offerId).success ||
    claim.organisationId !== access.organisationId || claim.locationId !== access.locationId ||
    !finiteDate(claim.createdAt) || claim.createdAt > latest || !Number.isInteger(claim.revision) || claim.revision < 1 || claim.revision > 2147483647 ||
    !textSchema.safeParse(claim.publicShopName).success || !snapshot || snapshot.organisationId !== access.organisationId ||
    snapshot.offerId !== claim.offerId || snapshot.revision !== claim.revision) abort("UNAVAILABLE");
  const terms = offerTermsSchema.safeParse(snapshot.terms);
  if (!terms.success || !terms.data.locationIds.includes(access.locationId)) abort("UNAVAILABLE");
  const pin = snapshot.campaignLink;
  let campaignAssociation = null;
  // This immutable relation is bound by tenant, coupon and issued revision.
  // Never look at the current campaign, draft choice or current coupon version.
  if (pin !== null) {
    const parsed = campaignLinkSnapshotSchema.safeParse(pin?.snapshot);
    if (!pin || pin.organisationId !== access.organisationId || pin.offerId !== claim.offerId || pin.revision !== claim.revision ||
      !Number.isInteger(pin.campaignPublicationRevision) || pin.campaignPublicationRevision < 1 || pin.campaignPublicationRevision > 2147483647 ||
      !finiteDate(pin.pinnedAt) || pin.pinnedAt > claim.createdAt || !parsed.success || new Date(parsed.data.publishedAt) > pin.pinnedAt ||
      JSON.stringify([...parsed.data.locationIds].sort()) !== JSON.stringify([...terms.data.locationIds].sort())) abort("UNAVAILABLE");
    campaignAssociation = { campaignName: parsed.data.campaignName, promoName: parsed.data.promoName, campaignRevision: pin.campaignPublicationRevision };
  }
  return { id: claim.id, issuedAt: iso(claim.createdAt), offerTitle: terms.data.title, revision: claim.revision,
    shopName: claim.publicShopName, campaignAssociation };
}
function receiptView(row, access, window, asOf) {
  if (!row || !rewardIdSchema.safeParse(row.id).success || row.organisationId !== access.organisationId || row.locationId !== access.locationId ||
    !finiteDate(row.occurredAt) || row.occurredAt < window.from || row.occurredAt >= window.to || row.occurredAt > asOf ||
    row.claim?.id !== row.claimId || row.claim?.offerId !== row.offerId) abort("UNAVAILABLE");
  const claim = claimView(row.claim, access, row.occurredAt);
  const correction = row.reversal;
  if (correction && (correction.organisationId !== access.organisationId || correction.redemptionId !== row.id ||
    !finiteDate(correction.occurredAt) || correction.occurredAt < row.occurredAt || !REVERSAL_REASONS.includes(correction.reason))) abort("UNAVAILABLE");
  const visible = correction && correction.occurredAt <= asOf;
  return { id: row.id, redeemedAt: iso(row.occurredAt), offerTitle: claim.offerTitle, revision: claim.revision, shopName: claim.shopName,
    campaignAssociation: claim.campaignAssociation,
    status: visible ? "CORRECTED" : "REDEEMED", correction: visible ? { reversedAt: iso(correction.occurredAt), reason: correction.reason } : null };
}

/** Each response reads one repeatable database snapshot. asOf is a time cutoff,
 * not a retained cross-request snapshot: a later commit can carry an earlier
 * event timestamp. Every page/export rechecks current authority and retention.
 * No shopper/staff identity, money totals, tokens, or mutation is exposed. */
export function createRewardReportingService({ db, env = {}, loadContext, clock = () => new Date() } = {}) {
  const enabled = () => readReportsPolicy(env).enabled;
  function nowAt(earliest) {
    if (!enabled()) abort("FEATURE_DISABLED");
    const now = clock();
    if (!finiteDate(now) || earliest && now < earliest) abort("UNAVAILABLE");
    return new Date(now.getTime());
  }
  async function safely(operation) {
    if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
    try { return await operation(); }
    catch (error) { return error instanceof ReportAbort ? error.result : rewardsDenied("UNAVAILABLE"); }
  }
  async function guard(client, action, locationId, previous) {
    if (!enabled()) abort("FEATURE_DISABLED");
    if (typeof loadContext !== "function") abort("UNAUTHENTICATED");
    let context, rewardState, staffRows = [];
    const guardStartedAt = nowAt(), adapter = createRewardsDatabaseAdapter(client);
    const access = allow(await requireRetailRewardsAccess({ action, ...(locationId ? { locationId } : {}) }, {
      env, clock, loadContext: async () => { context = await loadContext(client); return context; }, ...adapter,
      loadRewardsState: async input => { rewardState = await adapter.loadRewardsState(input); return rewardState; },
      loadStaffGrants: async input => { staffRows = await adapter.loadStaffGrants(input); return staffRows; }
    }));
    const checkedAt = nowAt(), expiries = [context.session.expiresAt, rewardState?.grant?.expiresAt,
      ...staffRows.filter(row => row.revokedAt === null && row.startsAt <= checkedAt && row.expiresAt > guardStartedAt &&
        row.capabilities.includes(action)).map(row => row.expiresAt)];
    const accessValidUntil = Math.min(...expiries.filter(value => value instanceof Date).map(value => value.getTime()));
    const current = { ...access, accessValidUntil,
      authority: { sessionId: context.session.id, subscriptionId: context.membership.organisation.subscription.id, role: context.membership.role } };
    if (previous && !sameAuthority(previous, current)) abort("FORBIDDEN");
    return current;
  }
  function stillValid(at, ...accesses) {
    // Independent VIEW/EXPORT checks can cross an earlier action's expiry.
    // Keep their conservative deadlines private and reject before disclosure.
    if (accesses.filter(Boolean).some(access => !Number.isFinite(access.accessValidUntil) || access.accessValidUntil <= at.getTime())) abort("FORBIDDEN");
  }
  async function exportAccess(client, locationId, viewAccess, required = false, previous) {
    try {
      const result = await guard(client, "EXPORT", locationId, previous);
      // The two action scopes are intentionally independent; selected rows must
      // belong to both. Identity can never switch between those checks.
      if (result.organisationId !== viewAccess.organisationId || result.userId !== viewAccess.userId || result.organisationMemberId !== viewAccess.organisationMemberId ||
        result.authority.sessionId !== viewAccess.authority.sessionId || result.authority.subscriptionId !== viewAccess.authority.subscriptionId || result.authority.role !== viewAccess.authority.role) abort("FORBIDDEN");
      return result;
    } catch (error) {
      if (!required && error instanceof ReportAbort && ["FORBIDDEN", "NOT_ENTITLED", "LOCATION_UNAVAILABLE"].includes(error.result.code)) return null;
      throw error;
    }
  }
  async function program(client, access, previous) {
    const value = await client.rewardProgram.findFirst({ where: { organisationId: access.organisationId }, select: { id: true, organisationId: true, timezone: true } });
    if (!value || !rewardIdSchema.safeParse(value.id).success || value.organisationId !== access.organisationId || typeof value.timezone !== "string" ||
      value.timezone.length < 1 || value.timezone.length > 100) abort("NOT_ENTITLED");
    try { localDate(nowAt(), value.timezone); } catch (error) { if (error instanceof ReportAbort) throw error; abort("UNAVAILABLE"); }
    if (previous && (value.id !== previous.id || value.timezone !== previous.timezone)) abort("REPORT_EXPIRED");
    return value;
  }
  async function runReport(input, isExport) {
    const parsed = (isExport ? reportExportSchema : reportQuerySchema).safeParse(input);
    if (!parsed.success) abort("INVALID_REQUEST");
    const values = parsed.data, started = nowAt(), initial = await guard(db, "VIEW_INSIGHTS", values.locationId);
    const initialExport = await exportAccess(db, values.locationId, initial, isExport);
    const saved = await db.$transaction(async tx => {
      const access = await guard(tx, "VIEW_INSIGHTS", values.locationId, initial), source = await program(tx, access), snapshotTime = nowAt(started);
      const exportGrant = await exportAccess(tx, values.locationId, access, isExport || !!initialExport, initialExport || undefined);
      const asOf = values.asOf ? new Date(values.asOf) : snapshotTime;
      const window = windowAt(values, access, source.timezone, snapshotTime, asOf);
      const location = locationView(await tx.location.findFirst({ where: { id: values.locationId, organisationId: access.organisationId, status: "ACTIVE" }, select: locationSelect }), access);
      const [claims, receipts] = await Promise.all([
        tx.rewardClaim.findMany({ where: { organisationId: access.organisationId, locationId: values.locationId, createdAt: { gte: window.from, lt: window.to, lte: asOf } },
          select: claimSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: REPORT_MAX_ROWS + 1 }),
        tx.rewardRedemption.findMany({ where: { organisationId: access.organisationId, locationId: values.locationId, occurredAt: { gte: window.from, lt: window.to, lte: asOf } },
          select: receiptSelect, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: REPORT_MAX_ROWS + 1 })
      ]);
      if (!Array.isArray(claims) || !Array.isArray(receipts)) abort("UNAVAILABLE");
      if (claims.length > REPORT_MAX_ROWS || receipts.length > REPORT_MAX_ROWS) abort("REPORT_TOO_LARGE");
      if (claims.some(row => !rewardIdSchema.safeParse(row.id).success || row.organisationId !== access.organisationId || row.locationId !== values.locationId ||
        !finiteDate(row.createdAt) || row.createdAt < window.from || row.createdAt >= window.to || row.createdAt > asOf) ||
        new Set(claims.map(row => row.id)).size !== claims.length || new Set(receipts.map(row => row.id)).size !== receipts.length) abort("UNAVAILABLE");
      const claimRows = claims.map(row => claimView(row, access, asOf));
      const receiptRows = receipts.map(row => receiptView(row, access, window, asOf));
      const corrected = receiptRows.filter(row => row.status === "CORRECTED").length;
      return { access, exportGrant, source, asOf, window, location,
        rows: values.view === "CLAIMS" ? claimRows : receiptRows,
        summary: { issued: claimRows.length, successfulUses: receiptRows.length, correctedUses: corrected, netUses: receiptRows.length - corrected } };
    }, TX_OPTIONS);
    // Outside the snapshot, reload authority so revocation/retention reduction
    // committed while the report was running cannot disclose its result.
    const current = await guard(db, "VIEW_INSIGHTS", values.locationId, initial);
    await program(db, current, saved.source);
    const finalExport = await exportAccess(db, values.locationId, current, isExport || !!saved.exportGrant, saved.exportGrant || undefined);
    const checkedAt = nowAt(started);
    windowAt(values, current, saved.source.timezone, checkedAt, saved.asOf);
    stillValid(checkedAt, current, finalExport);
    const page = isExport ? 1 : values.page || 1, start = isExport ? 0 : (page - 1) * REPORT_PAGE_SIZE;
    const selectedRows = isExport ? saved.rows : saved.rows.slice(start, start + REPORT_PAGE_SIZE);
    return { ok: true, location: saved.location, filters: { fromDate: values.fromDate, toDate: values.toDate, timezone: saved.source.timezone },
      window: { fromInclusive: iso(saved.window.from), toExclusive: iso(saved.window.to) }, asOf: iso(saved.asOf), checkedAt: iso(checkedAt),
      summary: saved.summary, view: values.view, claims: values.view === "CLAIMS" ? selectedRows : [],
      receipts: values.view === "REDEMPTIONS" ? selectedRows : [], page,
      hasMore: !isExport && start + REPORT_PAGE_SIZE < saved.rows.length, totalRows: saved.rows.length, exportAllowed: !!finalExport };
  }
  return Object.freeze({
    locations(input = {}) { return safely(async () => {
      const parsed = reportLocationsSchema.safeParse(input); if (!parsed.success) abort("INVALID_REQUEST");
      const started = nowAt(), initial = await guard(db, "VIEW_INSIGHTS"), page = parsed.data.page || 1;
      const initialExport = await exportAccess(db, undefined, initial);
      const saved = await db.$transaction(async tx => {
        const access = await guard(tx, "VIEW_INSIGHTS", undefined, initial), source = await program(tx, access);
        const exportGrant = await exportAccess(tx, undefined, access, !!initialExport, initialExport || undefined);
        const rows = await tx.location.findMany({ where: { organisationId: access.organisationId, status: "ACTIVE",
          ...(access.locationScope.kind === "LOCATIONS" ? { id: { in: access.locationScope.locationIds } } : {}) },
          select: locationSelect, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * REPORT_PAGE_SIZE, take: REPORT_PAGE_SIZE + 1 });
        if (!Array.isArray(rows) || rows.length > REPORT_PAGE_SIZE + 1) abort("UNAVAILABLE");
        const locations = rows.slice(0, REPORT_PAGE_SIZE).map(row => ({ ...locationView(row, access), canExport: !!exportGrant && scopeHas(exportGrant, row.id) }));
        return { source, locations, hasMore: rows.length > REPORT_PAGE_SIZE, exportGrant };
      }, TX_OPTIONS);
      const current = await guard(db, "VIEW_INSIGHTS", undefined, initial);
      await program(db, current, saved.source);
      const finalExport = await exportAccess(db, undefined, current, !!saved.exportGrant, saved.exportGrant || undefined);
      // Recheck each disclosed shop's active state outside the snapshot too.
      for (const row of saved.locations) locationView(await db.location.findFirst({ where: { id: row.id, organisationId: current.organisationId, status: "ACTIVE" }, select: locationSelect }), current);
      const checkedAt = nowAt(started), bounds = boundsAt(checkedAt, saved.source.timezone, current.limits.analyticsRetentionDays);
      stillValid(checkedAt, current, finalExport);
      return { ok: true, locations: saved.locations.map(row => ({ ...row, canExport: !!finalExport && scopeHas(finalExport, row.id) })),
        page, hasMore: saved.hasMore, defaults: defaultsFor(bounds), bounds, timezone: saved.source.timezone, checkedAt: iso(checkedAt) };
    }); },
    report(input) { return safely(() => runReport(input, false)); },
    exportReport(input) { return safely(() => runReport(input, true)); }
  });
}
