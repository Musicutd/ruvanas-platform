import { rewardIdSchema } from "./contracts.mjs";
import { readCampaignLinkPolicy } from "./campaign-link-contracts.mjs";
import { campaignLinkSnapshotSchema } from "./campaign-link-dtos.mjs";
import { reviewCampaignHash, campaignDatesOverlap } from "./campaign-review-adapter.mjs";

const PROMO_TYPES = ["COMMERCIAL", "JINGLE", "ANNOUNCEMENT", "VOICEOVER"];
const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/x-m4a"];
const finite = d => d instanceof Date && Number.isFinite(d.getTime());
const validId = value => rewardIdSchema.safeParse(value).success;
const ids = values => [...new Set(values)].sort();
const sameIds = (a, b) => JSON.stringify(ids(a)) === JSON.stringify(ids(b));
const can = (access, id) => access.locationScope.kind === "ALL_LOCATIONS" || access.locationScope.locationIds.includes(id);
const sameActor = (a, b) => a.organisationId === b.organisationId && a.userId === b.userId &&
  a.organisationMemberId === b.organisationMemberId && JSON.stringify(a.authority) === JSON.stringify(b.authority);
const select = { id: true, organisationId: true, name: true, status: true, promoVersionId: true, priority: true, schedulingMode: true,
  mandatory: true, respectOpeningHours: true, effectiveFrom: true, effectiveTo: true, maxPromoMinutesPerHour: true,
  minSamePromoGapMinutes: true, minAnyPromoGapMinutes: true, publicationRevision: true, publishedConfigurationHash: true, publishedAt: true,
  targets: { take: 101, select: { campaignId: true, targetType: true, brandId: true, locationGroupId: true, locationId: true, zoneId: true, stationId: true, channelId: true } },
  schedules: { take: 201, select: { weekday: true, windowMode: true, startMinute: true, endMinute: true, exactMinute: true, playsPerHour: true, intervalMinutes: true } },
  rule: { select: { exactTimeHardStart: true, playsPerHour: true, intervalMinutes: true } }, retailMediaOrder: { select: { id: true } },
  promoVersion: { select: { id: true, status: true, promoAssetId: true, mediaAssetId: true,
    promoAsset: { select: { id: true, organisationId: true, name: true, status: true, mediaType: true } },
    mediaAsset: { select: { id: true, organisationId: true, status: true, mediaType: true, mimeType: true } } } } };
const publicCampaign = row => ({ id: row.id, name: row.name, publicationRevision: row.publicationRevision,
  publishedAt: row.publishedAt.toISOString(), startsOn: row.effectiveFrom.toISOString().slice(0, 10),
  endsOn: row.effectiveTo.toISOString().slice(0, 10), promoName: row.promoVersion.promoAsset.name });

/** Offer-service transaction collaborator. Never owns or edits an audio campaign. */
export function createCampaignLinkOperations({ env, clock, guard, loadOffer, inspectOffer, abort }) {
  const enabled = () => readCampaignLinkPolicy(env).enabled;
  function nowAt() { const now = clock(); if (!enabled()) abort("FEATURE_DISABLED");
    if (!finite(now)) abort("UNAVAILABLE"); return new Date(now); }
  function accessNotExpired(access) {
    const now = nowAt().getTime();
    if (access.some(a => !Number.isFinite(a.accessValidUntil) || a.accessValidUntil <= now)) abort("FORBIDDEN");
  }
  async function accessFor(client, primary) {
    if (!enabled()) abort("FEATURE_DISABLED");
    const access = [];
    for (const action of ["READ", "MANAGE_OFFERS"]) {
      const next = await guard(client, action);
      if (!next.ok) abort(next.code);
      if (primary && !sameActor(primary, next) || access.length && !sameActor(access[0], next)) abort("FORBIDDEN");
      access.push(next);
    }
    accessNotExpired(access);
    return access;
  }
  function inspect(row, access, expectedVersion) {
    accessNotExpired(access);
    for (const a of access) inspectOffer(row, a);
    if (row.version !== expectedVersion) abort("CONFLICT");
    const { draft } = inspectOffer(row, access[0]);
    if (row.state === "CANCELLED" || new Date(draft.endsAt) <= nowAt()) abort("OFFER_UNAVAILABLE");
    if (draft.locationIds.length > 100) abort("REVIEW_TOO_LARGE");
    return draft;
  }
  async function shops(client, access, row, terms) {
    const wanted = ids(row.locations.map(l => l.locationId)), org = access[0].organisationId;
    const rows = await client.location.findMany({ where: { organisationId: org, status: "ACTIVE", id: { in: wanted } },
      orderBy: { name: "asc" }, take: 1001, select: { id: true, organisationId: true, status: true, name: true, timezone: true,
        zones: { where: { status: { not: "OFFLINE" } }, orderBy: { name: "asc" }, take: 1001,
          select: { id: true, name: true, locationId: true } } } });
    if (!Array.isArray(rows) || !sameIds(rows.map(l => l.id), wanted) || rows.length !== wanted.length || rows.some(l =>
      l.organisationId !== org || l.status !== "ACTIVE" || !validId(l.id) || access.some(a => !can(a, l.id)))) abort("LOCATION_UNAVAILABLE");
    for (const l of rows) {
      try { new Intl.DateTimeFormat("en", { timeZone: l.timezone }).format(nowAt()); } catch { abort("UNAVAILABLE"); }
      if (!Array.isArray(l.zones) || l.zones.length > 1000 || l.zones.some(z => !validId(z.id) || z.locationId !== l.id)) abort("REVIEW_TOO_LARGE");
    }
    const selected = rows.filter(l => terms.locationIds.includes(l.id));
    if (selected.flatMap(l => l.zones).length > 1000) abort("REVIEW_TOO_LARGE");
    return selected;
  }
  function eligible(row, terms, locations, org, now) {
    const pv = row?.promoVersion, pa = pv?.promoAsset, media = pv?.mediaAsset;
    if (!row || !validId(row.id) || row.organisationId !== org || row.status !== "PUBLISHED" || row.mandatory !== false || row.retailMediaOrder ||
      !Number.isInteger(row.publicationRevision) || row.publicationRevision < 1 || !finite(row.publishedAt) || row.publishedAt > now ||
      typeof row.publishedConfigurationHash !== "string" || !/^[a-f0-9]{64}$/.test(row.publishedConfigurationHash) ||
      !finite(row.effectiveFrom) || !finite(row.effectiveTo) || !Array.isArray(row.targets) || row.targets.length < 1 || row.targets.length > 100 ||
      row.targets.some(t => t.campaignId !== row.id || t.targetType !== "LOCATION" || !validId(t.locationId) ||
        [t.brandId, t.locationGroupId, t.zoneId, t.stationId, t.channelId].some(x => x !== null)) ||
      new Set(row.targets.map(t => t.locationId)).size !== row.targets.length || !sameIds(row.targets.map(t => t.locationId), terms.locationIds) ||
      !Array.isArray(row.schedules) || row.schedules.length > 200 || !pv || pv.id !== row.promoVersionId || pv.status !== "APPROVED" ||
      !pa || pa.id !== pv.promoAssetId || pa.organisationId !== org || pa.status !== "ACTIVE" || !PROMO_TYPES.includes(pa.mediaType) ||
      !media || media.id !== pv.mediaAssetId || media.organisationId !== org || media.status !== "READY" || media.mediaType !== pa.mediaType || !AUDIO_MIMES.includes(media.mimeType)) return false;
    try { return row.publishedConfigurationHash === reviewCampaignHash(row, locations) && campaignDatesOverlap(row, terms, locations) &&
      campaignLinkSnapshotSchema.safeParse(snapshot(row, terms)).success; } catch { return false; }
  }
  function snapshot(row, terms) { const view = publicCampaign(row); return { schemaVersion: 1, campaignName: view.name,
    promoName: view.promoName, publishedAt: view.publishedAt, startsOn: view.startsOn, endsOn: view.endsOn, locationIds: ids(terms.locationIds) }; }
  function inspectSelection(selection, org, offerId) {
    if (selection && (selection.organisationId !== org || selection.offerId !== offerId || !validId(selection.campaignId) ||
      !Number.isInteger(selection.campaignPublicationRevision) || selection.campaignPublicationRevision < 1 ||
      typeof selection.campaignConfigurationHash !== "string" || !/^[a-f0-9]{64}$/.test(selection.campaignConfigurationHash) ||
      !validId(selection.selectedByUserId) || !finite(selection.selectedAt))) abort("UNAVAILABLE");
    return selection;
  }
  async function selection(client, org, offerId) {
    // This query is required even when linking is disabled: a saved choice must
    // never disappear silently from the next publication after a flag rollback.
    return inspectSelection(await client.rewardOfferCampaignDraft.findFirst({ where: { organisationId: org, offerId } }), org, offerId);
  }
  async function selectedCampaignView(client, access, saved) {
    if (!saved) return null;
    const org = access[0].organisationId;
    const row = await client.campaign.findFirst({ where: { id: saved.campaignId, organisationId: org },
      select: { id: true, organisationId: true, name: true, targets: select.targets } });
    // A later coupon edit can move its draft to different shops. Its old saved
    // choice does not grant the new shop manager access to the former campaign.
    if (!row || row.organisationId !== org || row.id !== saved.campaignId || !Array.isArray(row.targets) ||
      row.targets.length < 1 || row.targets.length > 100 || row.targets.some(t => t.campaignId !== row.id || t.targetType !== "LOCATION" ||
        !validId(t.locationId) || [t.brandId, t.locationGroupId, t.zoneId, t.stationId, t.channelId].some(value => value !== null) ||
        access.some(a => !can(a, t.locationId)))) abort("OFFER_UNAVAILABLE");
    const wanted = ids(row.targets.map(t => t.locationId));
    if (wanted.length !== row.targets.length) abort("OFFER_UNAVAILABLE");
    const owned = await client.location.findMany({ where: { organisationId: org, id: { in: wanted } },
      take: 101, select: { id: true, organisationId: true } });
    if (!Array.isArray(owned) || owned.length !== wanted.length || !sameIds(owned.map(l => l.id), wanted) ||
      owned.some(l => l.organisationId !== org)) abort("OFFER_UNAVAILABLE");
    return row;
  }
  async function collect(client, input, primary) {
    const access = await accessFor(client, primary), org = access[0].organisationId;
    const offer = await loadOffer(client, access[0], input.offerId), terms = inspect(offer, access, input.expectedVersion);
    const locations = await shops(client, access, offer, terms);
    const direct = { targetType: "LOCATION", locationId: { in: terms.locationIds }, brandId: null, locationGroupId: null, zoneId: null, stationId: null, channelId: null };
    const rows = await client.campaign.findMany({ where: { organisationId: org, status: "PUBLISHED", mandatory: false, retailMediaOrder: { is: null },
      targets: { some: direct, every: direct }, promoVersion: { status: "APPROVED", promoAsset: { organisationId: org, status: "ACTIVE", mediaType: { in: PROMO_TYPES } },
        mediaAsset: { organisationId: org, status: "READY", mediaType: { in: PROMO_TYPES }, mimeType: { in: AUDIO_MIMES } } } }, select, orderBy: { id: "asc" }, take: 101 });
    if (!Array.isArray(rows) || new Set(rows.map(r => r.id)).size !== rows.length) abort("UNAVAILABLE");
    if (rows.length > 100) abort("REVIEW_TOO_LARGE");
    const saved = await selection(client, org, offer.id);
    const selectedCampaign = await selectedCampaignView(client, access, saved);
    const pin = offer.publishedRevision === null ? null : await client.rewardOfferCampaignRevision.findFirst({ where: {
      organisationId: org, offerId: offer.id, revision: offer.publishedRevision } });
    if (pin && (pin.organisationId !== org || pin.offerId !== offer.id || pin.revision !== offer.publishedRevision || !validId(pin.campaignId) ||
      !Number.isInteger(pin.campaignPublicationRevision) || pin.campaignPublicationRevision < 1 || !campaignLinkSnapshotSchema.safeParse(pin.snapshot).success)) abort("UNAVAILABLE");
    const now = nowAt(), matching = rows.filter(r => eligible(r, terms, locations, org, now)), page = input.page || 1, offset = (page - 1) * 25;
    return { access, expiresAt: terms.endsAt, fingerprint: JSON.stringify({ offer, saved, selectedCampaign, pin, rows, locations }),
      view: { ok: true, offer: { id: offer.id, title: terms.title, version: offer.version, state: offer.state, publishedRevision: offer.publishedRevision },
        selection: saved ? { campaignId: saved.campaignId, name: selectedCampaign.name, publicationRevision: saved.campaignPublicationRevision } : null,
        publishedLink: pin ? { revision: pin.revision, campaignId: pin.campaignId, name: pin.snapshot.campaignName, publicationRevision: pin.campaignPublicationRevision } : null,
        campaigns: matching.slice(offset, offset + 25).map(publicCampaign), page, hasMore: offset + 25 < matching.length } };
  }
  async function lockSources(tx, org, campaignId, shopIds) {
    const campaignRows = await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} AND "organisationId" = ${org} FOR SHARE`;
    if (!Array.isArray(campaignRows) || campaignRows.length !== 1 || campaignRows[0].id !== campaignId) abort("CONFLICT");
    const targets = await tx.$queryRaw`SELECT "id" FROM "CampaignTarget" WHERE "campaignId" = ${campaignId} ORDER BY "id" LIMIT 101 FOR SHARE`;
    const schedules = await tx.$queryRaw`SELECT "id" FROM "CampaignSchedule" WHERE "campaignId" = ${campaignId} ORDER BY "id" LIMIT 201 FOR SHARE`;
    if (targets.length > 100 || schedules.length > 200) abort("REVIEW_TOO_LARGE");
    await tx.$queryRaw`SELECT "id" FROM "CampaignRule" WHERE "campaignId" = ${campaignId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "RetailMediaOrder" WHERE "campaignId" = ${campaignId} FOR SHARE`;
    const assets = await tx.$queryRaw`SELECT pv."id" FROM "Campaign" c JOIN "PromoVersion" pv ON pv."id" = c."promoVersionId"
      JOIN "PromoAsset" pa ON pa."id" = pv."promoAssetId" JOIN "MediaAsset" m ON m."id" = pv."mediaAssetId"
      WHERE c."id" = ${campaignId} AND c."organisationId" = ${org} AND pa."organisationId" = ${org} AND m."organisationId" = ${org}
      FOR SHARE OF pv, pa, m`;
    if (assets.length !== 1) abort("CONFLICT");
    const locations = await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "organisationId" = ${org}
      AND "id" IN (SELECT jsonb_array_elements_text(${JSON.stringify(shopIds)}::jsonb)) FOR SHARE`;
    if (!sameIds(locations.map(l => l.id), shopIds)) abort("LOCATION_UNAVAILABLE");
    const zones = await tx.$queryRaw`SELECT "id" FROM "Zone" WHERE "locationId" IN
      (SELECT jsonb_array_elements_text(${JSON.stringify(shopIds)}::jsonb)) ORDER BY "id" LIMIT 1001 FOR SHARE`;
    if (zones.length > 1000) abort("REVIEW_TOO_LARGE");
  }
  async function validateChoice(tx, access, row, campaignId, expectedRevision, expectedHash) {
    const terms = inspect(row, access, row.version), org = access[0].organisationId;
    await lockSources(tx, org, campaignId, ids(row.locations.map(l => l.locationId)));
    const locations = await shops(tx, access, row, terms), campaign = await tx.campaign.findFirst({ where: { id: campaignId, organisationId: org }, select });
    if (!eligible(campaign, terms, locations, org, nowAt()) || campaign.publicationRevision !== expectedRevision ||
      expectedHash !== undefined && campaign.publishedConfigurationHash !== expectedHash) abort("CONFLICT");
    return { organisationId: org, offerId: row.id, campaignId: campaign.id, campaignPublicationRevision: campaign.publicationRevision,
      campaignConfigurationHash: campaign.publishedConfigurationHash, snapshot: snapshot(campaign, terms) };
  }
  async function save(tx, primary, row, input) {
    const access = await accessFor(tx, primary); inspect(row, access, input.expectedVersion);
    const existing = await selection(tx, primary.organisationId, row.id);
    if (existing) await tx.$queryRaw`SELECT "offerId" FROM "RewardOfferCampaignDraft" WHERE "offerId" = ${row.id} AND "organisationId" = ${primary.organisationId} FOR UPDATE`;
    if (input.campaignId === null) {
      await tx.rewardOfferCampaignDraft.deleteMany({ where: { organisationId: primary.organisationId, offerId: row.id } });
    } else {
      const choice = await validateChoice(tx, access, row, input.campaignId, input.campaignPublicationRevision);
      const { snapshot: _snapshot, ...values } = choice;
      const data = { ...values, selectedByUserId: primary.userId, selectedAt: nowAt() };
      if (existing) {
        const result = await tx.rewardOfferCampaignDraft.updateMany({ where: { organisationId: primary.organisationId, offerId: row.id }, data });
        if (result.count !== 1) abort("CONFLICT");
      } else await tx.rewardOfferCampaignDraft.create({ data });
    }
    inspect(row, await accessFor(tx, primary), input.expectedVersion);
  }
  async function preparePin(tx, primary, row) {
    const saved = await selection(tx, primary.organisationId, row.id);
    if (!saved) return null;
    const access = await accessFor(tx, primary);
    await tx.$queryRaw`SELECT "offerId" FROM "RewardOfferCampaignDraft" WHERE "offerId" = ${row.id} AND "organisationId" = ${primary.organisationId} FOR SHARE`;
    return validateChoice(tx, access, row, saved.campaignId, saved.campaignPublicationRevision, saved.campaignConfigurationHash);
  }
  async function pin(tx, primary, data, revision, row) {
    if (!data) return;
    inspect(row, await accessFor(tx, primary), row.version);
    await tx.rewardOfferCampaignRevision.create({ data: { ...data, revision, actorUserId: primary.userId, pinnedAt: nowAt() } });
  }
  async function assertFinal(tx, primary, rows) {
    const current = await accessFor(tx, primary);
    // Re-check each target using the newly calculated scopes, not the earlier
    // successful scopes. An unrelated residual READ grant is insufficient.
    for (const row of rows) inspect(row, current, row.version);
  }
  return { enabled, nowAt, accessFor, collect, save, preparePin, pin, assertFinal };
}
