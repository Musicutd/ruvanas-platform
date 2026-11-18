import { readCampaignReviewPolicy, campaignOffersQuerySchema, campaignReviewQuerySchema } from "./campaign-review-contracts.mjs";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";
import { offerTermsSchema } from "./offer-contracts.mjs";
import { rewardIdSchema } from "./contracts.mjs";
import { rewardsDenied } from "./errors.mjs";
import { reviewCampaignHash, campaignDatesOverlap } from "./campaign-review-adapter.mjs";

const OPTIONS = { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 };
// MediaType describes the recording's purpose, not its file format.
const PROMO_TYPES = ["COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"];
const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/x-m4a"];
const finite = d => d instanceof Date && Number.isFinite(d.getTime());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = values => [...new Set(values)].sort();
const equalIds = (a, b) => same(ids(a), ids(b));
class ReviewAbort extends Error { constructor(code) { super(code); this.result = rewardsDenied(code); } }
const abort = code => { throw new ReviewAbort(code); };
const has = (a, id) => a.locationScope.kind === "ALL_LOCATIONS" || a.locationScope.locationIds.includes(id);
const validId = value => rewardIdSchema.safeParse(value).success;
const offerSelect = { id: true, organisationId: true, state: true, draft: true, lastRevision: true, publishedRevision: true,
  publishedStartsAt: true, publishedEndsAt: true,
  locations: { take: 1001, select: { organisationId: true, offerId: true, locationId: true, scope: true } },
  revisions: { orderBy: { revision: "desc" }, take: 1, select: { organisationId: true, offerId: true, revision: true, terms: true } } };
const campaignSelect = { id: true, organisationId: true, name: true, status: true, promoVersionId: true, priority: true, schedulingMode: true,
  mandatory: true, respectOpeningHours: true, effectiveFrom: true, effectiveTo: true, maxPromoMinutesPerHour: true,
  minSamePromoGapMinutes: true, minAnyPromoGapMinutes: true, publicationRevision: true, publishedConfigurationHash: true, publishedAt: true,
  targets: { take: 101, select: { campaignId: true, targetType: true, brandId: true, locationGroupId: true, locationId: true, zoneId: true, stationId: true, channelId: true } },
  schedules: { take: 201, select: { weekday: true, windowMode: true, startMinute: true, endMinute: true, exactMinute: true, playsPerHour: true, intervalMinutes: true } },
  rule: { select: { exactTimeHardStart: true, playsPerHour: true, intervalMinutes: true } }, retailMediaOrder: { select: { id: true } },
  promoVersion: { select: { id: true, status: true, promoAssetId: true, mediaAssetId: true,
    promoAsset: { select: { id: true, organisationId: true, name: true, status: true, mediaType: true } },
    mediaAsset: { select: { id: true, organisationId: true, status: true, mediaType: true, mimeType: true } } } } };

/** Read-only compatibility review. No claim attribution, linkage or audio writes. */
export function createRewardCampaignReviewService({ db, env = {}, loadContext, clock = () => new Date() } = {}) {
  const enabled = () => readCampaignReviewPolicy(env).enabled;
  function nowAt(earliest) { if (!enabled()) abort("FEATURE_DISABLED"); const now = clock();
    if (!finite(now) || earliest && now < earliest) abort("UNAVAILABLE"); return new Date(now); }
  async function guard(client, previous) {
    if (!enabled()) abort("FEATURE_DISABLED");
    if (typeof loadContext !== "function") abort("UNAUTHENTICATED");
    const result = [];
    for (const action of ["READ", "MANAGE_OFFERS"]) {
      let context;
      const access = await requireRetailRewardsAccess({ action }, { env, clock, ...createRewardsDatabaseAdapter(client),
        loadContext: async () => { context = await loadContext(client); return context; } });
      if (!access?.ok) abort(access?.code || "UNAVAILABLE");
      result.push({ ...access, authority: { sessionId: context.session.id, subscriptionId: context.membership.organisation.subscription.id, role: context.membership.role } });
    }
    const [a, b] = result;
    if (a.organisationId !== b.organisationId || a.userId !== b.userId || a.organisationMemberId !== b.organisationMemberId || !same(a.authority, b.authority) ||
      previous && !same(previous, result)) abort("FORBIDDEN");
    return result;
  }
  function scope(access) {
    const scoped = access.filter(a => a.locationScope.kind === "LOCATIONS");
    return scoped.length ? { in: scoped[0].locationScope.locationIds.filter(id => access.every(a => has(a, id))) } : undefined;
  }
  function offerWhere(access, now, id) {
    const organisationId = access[0].organisationId, allowed = scope(access);
    return { organisationId, ...(id ? { id } : {}), state: "PUBLISHED", publishedEndsAt: { gt: now },
      locations: { some: { scope: "PUBLISHED" }, every: { organisationId, ...(allowed ? { locationId: allowed } : {}) } } };
  }
  function inspectOffer(row, access, now, revision) {
    const org = access[0].organisationId;
    if (!row || !validId(row.id) || row.organisationId !== org || row.state !== "PUBLISHED") abort("OFFER_UNAVAILABLE");
    if (revision !== undefined && row.publishedRevision !== revision) abort("CONFLICT");
    if (!finite(row.publishedEndsAt) || row.publishedEndsAt <= now || !finite(row.publishedStartsAt)) abort("OFFER_UNAVAILABLE");
    const links = row.locations, snapshot = row.revisions?.[0], draft = offerTermsSchema.safeParse(row.draft), published = offerTermsSchema.safeParse(snapshot?.terms);
    if (!Array.isArray(links) || links.length < 2 || links.length > 1000 || links.some(l => l.organisationId !== org || l.offerId !== row.id ||
      !["DRAFT", "PUBLISHED"].includes(l.scope) || !validId(l.locationId) || access.some(a => !has(a, l.locationId))) ||
      new Set(links.map(l => `${l.scope}:${l.locationId}`)).size !== links.length ||
      !draft.success || !published.success || snapshot.organisationId !== org || snapshot.offerId !== row.id || snapshot.revision !== row.publishedRevision ||
      row.lastRevision !== row.publishedRevision || !Number.isInteger(row.publishedRevision) || row.publishedRevision < 1 ||
      !equalIds(draft.data.locationIds, links.filter(l => l.scope === "DRAFT").map(l => l.locationId)) ||
      !equalIds(published.data.locationIds, links.filter(l => l.scope === "PUBLISHED").map(l => l.locationId)) ||
      new Date(published.data.startsAt).toISOString() !== row.publishedStartsAt.toISOString() || new Date(published.data.endsAt).toISOString() !== row.publishedEndsAt.toISOString()) abort("UNAVAILABLE");
    return { terms: published.data, allIds: ids(links.map(l => l.locationId)),
      view: { id: row.id, title: published.data.title, revision: row.publishedRevision,
        startsAt: row.publishedStartsAt.toISOString(), endsAt: row.publishedEndsAt.toISOString(), shopCount: published.data.locationIds.length } };
  }
  async function shops(client, access, wanted, topology = false) {
    const organisationId = access[0].organisationId;
    const rows = await client.location.findMany({ where: { organisationId, status: "ACTIVE", id: { in: wanted } }, orderBy: { name: "asc" }, take: 501,
      select: { id: true, organisationId: true, status: true, name: true, timezone: true,
        ...(topology ? { zones: { where: { status: { not: "OFFLINE" } }, orderBy: { name: "asc" }, take: 1001, select: { id: true, name: true, locationId: true } } } : {}) } });
    if (!Array.isArray(rows) || rows.length !== wanted.length || !equalIds(rows.map(l => l.id), wanted) || rows.some(l => l.organisationId !== organisationId ||
      l.status !== "ACTIVE" || access.some(a => !has(a, l.id)) || !validId(l.id))) abort("LOCATION_UNAVAILABLE");
    for (const l of rows) {
      try { new Intl.DateTimeFormat("en", { timeZone: l.timezone }).format(nowAt()); } catch { abort("UNAVAILABLE"); }
      if (topology && (!Array.isArray(l.zones) || l.zones.length > 1000 || l.zones.some(z => z.locationId !== l.id || !validId(z.id)))) abort("REVIEW_TOO_LARGE");
    }
    if (topology && rows.flatMap(l => l.zones).length > 1000) abort("REVIEW_TOO_LARGE");
    return rows;
  }
  function eligible(row, offer, locations, org, now) {
    const pv = row.promoVersion, pa = pv?.promoAsset, media = pv?.mediaAsset;
    if (!validId(row.id) || row.organisationId !== org || row.status !== "PUBLISHED" || row.mandatory !== false || row.retailMediaOrder ||
      !Number.isInteger(row.publicationRevision) || row.publicationRevision < 1 || !finite(row.publishedAt) || row.publishedAt > now ||
      !finite(row.effectiveFrom) || !finite(row.effectiveTo) || !Array.isArray(row.targets) || row.targets.length < 1 || row.targets.length > 100 ||
      row.targets.some(t => t.campaignId !== row.id || t.targetType !== "LOCATION" || !validId(t.locationId) ||
        [t.brandId, t.locationGroupId, t.zoneId, t.stationId, t.channelId].some(x => x !== null)) ||
      new Set(row.targets.map(t => t.locationId)).size !== row.targets.length || !equalIds(row.targets.map(t => t.locationId), offer.terms.locationIds) ||
      !Array.isArray(row.schedules) || row.schedules.length > 200 || !pv || pv.id !== row.promoVersionId || pv.status !== "APPROVED" ||
      !pa || pa.id !== pv.promoAssetId || pa.organisationId !== org || pa.status !== "ACTIVE" || !PROMO_TYPES.includes(pa.mediaType) ||
      !media || media.id !== pv.mediaAssetId || media.organisationId !== org || media.status !== "READY" || media.mediaType !== pa.mediaType || !AUDIO_MIMES.includes(media.mimeType)) return false;
    try { return row.publishedConfigurationHash === reviewCampaignHash(row, locations) && campaignDatesOverlap(row, offer.terms, locations); }
    catch { return false; }
  }
  async function collect(client, access, input, operation, now) {
    const org = access[0].organisationId;
    const offers = await client.rewardOffer.findMany({ where: offerWhere(access, now, input.offerId), select: offerSelect,
      orderBy: { id: "asc" }, take: 101 });
    if (!Array.isArray(offers)) abort("UNAVAILABLE"); if (offers.length > 100) abort("REVIEW_TOO_LARGE");
    if (new Set(offers.map(o => o.id)).size !== offers.length) abort("UNAVAILABLE");
    if (operation === "review" && offers.length !== 1) abort("OFFER_UNAVAILABLE");
    const inspected = [];
    for (const row of offers) { const offer = inspectOffer(row, access, now, input.revision);
      // Draft and published scopes both stay protected, including inactive shops.
      await shops(client, access, offer.allIds); inspected.push(offer); }
    if (operation === "offers") return { offers: inspected.map(o => o.view) };
    const offer = inspected[0], locations = await shops(client, access, offer.terms.locationIds, true);
    const direct = { targetType: "LOCATION", locationId: { in: offer.terms.locationIds }, brandId: null, locationGroupId: null, zoneId: null, stationId: null, channelId: null };
    const rows = await client.campaign.findMany({ where: { organisationId: org, status: "PUBLISHED", mandatory: false, retailMediaOrder: { is: null },
      targets: { some: direct, every: direct },
      promoVersion: { status: "APPROVED", promoAsset: { organisationId: org, status: "ACTIVE", mediaType: { in: PROMO_TYPES } },
        mediaAsset: { organisationId: org, status: "READY", mediaType: { in: PROMO_TYPES }, mimeType: { in: AUDIO_MIMES } } } },
      select: campaignSelect, orderBy: { id: "asc" }, take: 101 });
    if (!Array.isArray(rows)) abort("UNAVAILABLE"); if (rows.length > 100) abort("REVIEW_TOO_LARGE");
    if (new Set(rows.map(r => r.id)).size !== rows.length) abort("UNAVAILABLE");
    const matching = rows.filter(row => eligible(row, offer, locations, org, now));
    return { offer: offer.view, campaigns: matching.map(row => ({ id: row.id, name: row.name, publicationRevision: row.publicationRevision,
      publishedAt: row.publishedAt.toISOString(), startsOn: row.effectiveFrom.toISOString().slice(0, 10), endsOn: row.effectiveTo.toISOString().slice(0, 10), promoName: row.promoVersion.promoAsset.name })),
      // Internal comparison includes all bounded source rows and current zone
      // topology, not only the public projection. Never return these fields.
      fingerprint: JSON.stringify({ offers, rows, locations }) };
  }
  async function run(input, operation) {
    if (!enabled()) return rewardsDenied("FEATURE_DISABLED");
    try {
      const parsed = (operation === "offers" ? campaignOffersQuerySchema : campaignReviewQuerySchema).safeParse(input);
      if (!parsed.success) abort("INVALID_REQUEST");
      const values = parsed.data, started = nowAt(), initial = await guard(db);
      const snapshot = await db.$transaction(async tx => collect(tx, await guard(tx, initial), values, operation, nowAt(started)), OPTIONS);
      // A second, fresh snapshot detects committed revocation, edits, republish,
      // expiry and topology changes; it does not reuse the first transaction.
      const fresh = await db.$transaction(async tx => collect(tx, await guard(tx, initial), values, operation, nowAt(started)), OPTIONS);
      if (!same(snapshot, fresh)) abort("CONFLICT");
      await guard(db, initial); const checkedAt = nowAt(started);
      const page = values.page || 1, start = (page - 1) * 25;
      if (operation === "offers") {
        if (fresh.offers.some(o => o.endsAt <= checkedAt.toISOString())) abort("CONFLICT");
        return { ok: true, offers: fresh.offers.slice(start, start + 25), page, hasMore: start + 25 < fresh.offers.length, checkedAt: checkedAt.toISOString(), reviewOnly: true };
      }
      if (fresh.offer.endsAt <= checkedAt.toISOString()) abort("CONFLICT");
      return { ok: true, offer: fresh.offer, campaigns: fresh.campaigns.slice(start, start + 25), page, hasMore: start + 25 < fresh.campaigns.length, checkedAt: checkedAt.toISOString(), reviewOnly: true };
    } catch (error) { return error instanceof ReviewAbort ? error.result : rewardsDenied("UNAVAILABLE"); }
  }
  return Object.freeze({ offers: (input = {}) => run(input, "offers"), review: input => run(input, "review") });
}
