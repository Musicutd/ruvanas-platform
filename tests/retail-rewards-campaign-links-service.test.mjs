import test from "node:test";
import assert from "node:assert/strict";
import { reviewCampaignHash } from "../lib/retail-rewards/campaign-review-adapter.mjs";
import { readCampaignLinkPolicy, campaignLinkReviewSchema, campaignLinkSaveSchema } from "../lib/retail-rewards/campaign-link-contracts.mjs";
import { safeCampaignLinkResult } from "../lib/retail-rewards/campaign-link-dtos.mjs";
import { createRewardOfferService } from "../lib/retail-rewards/offer-service.mjs";

const NOW = new Date("2026-11-14T12:00:00Z"), START = new Date("2026-11-01T00:00:00Z"), END = new Date("2027-01-01T00:00:00Z");
const clone = value => structuredClone(value);
function terms(patch = {}) {
  return { schemaVersion: 1, title: "10% after spending EUR 50", description: "A reusable home offer", category: "HOME",
    type: "PERCENT_OFF", percentBps: 1000, amountMinor: null, buyQuantity: null, getQuantity: null,
    currency: "EUR", minimumSpendMinor: 5000, exclusions: "Gift cards", legalTerms: "Present to authorised shop staff.",
    combinable: false, startsAt: "2026-11-14T00:00:00.000Z", endsAt: "2026-12-14T00:00:00.000Z", timezone: "Europe/Malta",
    locationIds: ["shop-one"], usage: "REUSABLE", totalLimit: 100, perShopperLimit: 10,
    perShopperDailyLimit: 1, pausedClaimsPolicy: "HONOUR_ISSUED", ...patch };
}
function fixture({ role = "OWNER", env = { RUVANAS_RETAIL_REWARDS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED: "true", RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED: "true" } } = {}) {
  const subscription = { id: "sub-one", organisationId: "org-one", status: "ACTIVE",
    plan: { code: "RETAIL_START", active: true, retailRadioEnabled: true } };
  const member = { id: "member-one", organisationId: "org-one", userId: "user-one", role };
  const context = { user: { id: "user-one", role },
    session: { id: "session-one", userId: "user-one", activeOrganisationId: "org-one", authMethod: "PASSWORD", expiresAt: END, revokedAt: null },
    membership: { ...member, organisation: { id: "org-one", subscription } }, memberships: [{ ...member }] };
  const data = {
    programs: [{ id: "program-one", organisationId: "org-one", status: "ACTIVE" }],
    grants: [{ id: "grant-one", organisationId: "org-one", subscriptionId: "sub-one", capability: "RETAIL_REWARDS",
      source: "MANUAL_INTERNAL", tier: "REWARDS_STARTER", status: "ACTIVE", startsAt: START, expiresAt: END, revokedAt: null,
      limitsVersion: 1, activeOffers: 2, locations: 2, staffSeats: 3, monthlyRedemptions: 100,
      analyticsRetentionDays: 30, exportEnabled: false, brandingEnabled: false }],
    staff: [{ id: "grant-staff", organisationId: "org-one", organisationMemberId: "member-one", scope: "LOCATIONS", locationId: "shop-one",
      capabilities: ["READ", "MANAGE_OFFERS", "PUBLISH_OFFERS"], startsAt: START, expiresAt: END, revokedAt: null }],
    locations: [{ id: "shop-one", organisationId: "org-one", name: "Main shop", status: "ACTIVE" },
      { id: "shop-two", organisationId: "org-one", name: "Second shop", status: "ACTIVE" },
      { id: "foreign-shop", organisationId: "other-org", name: "Private other shop", status: "ACTIVE" }],
    offers: [], offerLocations: [], revisions: [], audits: [], campaignDrafts: [], campaignPins: [], campaigns: []
  };
  data.locations.forEach(l => { l.timezone = "Europe/Malta"; l.zones = [{ id: `zone-${l.id}`, name: "Main", locationId: l.id }]; });
  const c = campaign(); c.publishedConfigurationHash = reviewCampaignHash(c, [data.locations[0]]); data.campaigns.push(c);
  const calls = [], txOptions = [];
  let clock = NOW, beforeTransaction, onContext, failAudit = false, attempts = 0;
  function matches(row, where = {}, source = data) {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some(condition => matches(row, condition, source));
      if (key === "AND") return value.every(condition => matches(row, condition, source));
      if (key === "locations") {
        const locations = source.offerLocations.filter(location => location.offerId === row.id);
        return (!value.some || locations.some(location => matches(location, value.some, source))) &&
          (!value.every || locations.every(location => matches(location, value.every, source)));
      }
      if (key === "draft") {
        const actual = row.draft[value.path[0]];
        if (value.equals !== undefined) return actual === value.equals;
        return actual.toLowerCase().includes(value.string_contains.toLowerCase());
      }
      if (value instanceof Date) return row[key]?.getTime() === value.getTime();
      if (value !== null && typeof value === "object") {
        if (value.in && !value.in.includes(row[key])) return false;
        if (value.not !== undefined && row[key] === value.not) return false;
        if (value.gt !== undefined && !(row[key] > value.gt)) return false;
        if (value.lte !== undefined && !(row[key] <= value.lte)) return false;
        return true;
      }
      return row[key] === value;
    });
  }
  function project(row, select) {
    return row === undefined ? null : clone(select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : row);
  }
  function client(source, inside = false) {
    function delegate(key) {
      return {
        async findFirst({ where, select } = {}) { calls.push([inside, key, "findFirst", clone(where)]); return project(source[key].find(row => matches(row, where, source)), select); },
        async findMany({ where, select, take, skip = 0, orderBy } = {}) {
          calls.push([inside, key, "findMany", clone(where)]);
          let rows = source[key].filter(row => matches(row, where, source));
          if (orderBy) rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
          return rows.slice(skip, take === undefined ? undefined : skip + take).map(row => project(row, select));
        },
        async count({ where }) { calls.push([inside, key, "count", clone(where)]); return source[key].filter(row => matches(row, where, source)).length; },
        async create({ data: input }) {
          calls.push([inside, key, "create"]);
          if (key === "audits" && failAudit) throw new Error("Sensitive database/credential diagnostic must never escape");
          const row = { id: `generated-${source[key].length}`, publishedRevision: null, publishedStartsAt: null, publishedEndsAt: null,
            createdAt: new Date(clock), updatedAt: new Date(clock), ...clone(input) };
          source[key].push(row); return clone(row);
        },
        async createMany({ data: inputs }) { calls.push([inside, key, "createMany"]); source[key].push(...clone(inputs)); return { count: inputs.length }; },
        async deleteMany({ where }) { calls.push([inside, key, "deleteMany", clone(where)]); const rows = source[key].filter(row => !matches(row, where, source));
          const count = source[key].length - rows.length; source[key] = rows; return { count }; },
        async updateMany({ where, data: changes }) {
          calls.push([inside, key, "updateMany", clone(where)]); let count = 0;
          for (const row of source[key].filter(row => matches(row, where, source))) {
            count += 1;
            for (const [field, value] of Object.entries(changes)) row[field] = value?.increment ? row[field] + value.increment : clone(value);
            row.updatedAt = new Date(clock);
          }
          return { count };
        }
      };
    }
    const offers = delegate("offers");
    function expand(row) {
      if (!row) return row;
      return { ...row, locations: clone(source.offerLocations.filter(location => location.offerId === row.id)),
        revisions: clone(source.revisions.filter(revision => revision.offerId === row.id).sort((a, b) => b.revision - a.revision).slice(0, 1)) };
    }
    return { rewardProgram: delegate("programs"), rewardEntitlementGrant: delegate("grants"), rewardStaffGrant: delegate("staff"),
      location: delegate("locations"), rewardOfferLocation: delegate("offerLocations"), rewardOfferRevision: delegate("revisions"),
      campaign: delegate("campaigns"), rewardOfferCampaignDraft: delegate("campaignDrafts"), rewardOfferCampaignRevision: delegate("campaignPins"), rewardAuditEvent: delegate("audits"), rewardOffer: { ...offers,
        findFirst: async input => expand(await offers.findFirst(input)),
        findMany: async input => (await offers.findMany(input)).map(expand) },
      async $queryRaw(strings, ...values) {
        calls.push([inside, "raw", strings.join("?")]);
        const query = strings.join("");
        if (query.includes('FROM "RewardProgram"')) return source.programs.filter(row => row.organisationId === values[0]).map(({ id }) => ({ id }));
        if (query.includes('FROM "RewardOfferCampaignDraft"')) return source.campaignDrafts.filter(d => d.offerId === values[0] && d.organisationId === values[1]).map(d => ({ offerId:d.offerId }));
        if (query.includes('FROM "CampaignTarget"')) return source.campaigns.find(c => c.id === values[0])?.targets.map((_,i) => ({id: String(i)})) || [];
        if (query.includes('FROM "CampaignSchedule"')) return source.campaigns.find(c => c.id === values[0])?.schedules.map((_,i) => ({id: String(i)})) || [];
        if (query.includes('FROM "CampaignRule"') || query.includes('FROM "RetailMediaOrder"')) return [];
        if (query.includes('FROM "Campaign" c JOIN')) return source.campaigns.filter(c => c.id === values[0] && c.organisationId === values[1]).map(c => ({id:c.promoVersion.id}));
        if (query.includes('FROM "Campaign"')) return source.campaigns.filter(c => c.id === values[0] && c.organisationId === values[1]).map(c => ({id:c.id}));
        if (query.includes('FROM "Zone"')) return source.locations.filter(l => JSON.parse(values[0]).includes(l.id)).flatMap(l => l.zones);
        if (query.includes('FROM "Session"')) return [{ id: context.session.id }];
        if (query.includes('FROM "Location"')) return source.locations.filter(row => row.organisationId === values[0] && JSON.parse(values[1]).includes(row.id)).map(({ id }) => ({ id }));
        if (query.includes('FROM "RewardStaffGrant"')) return source.staff.filter(row => row.organisationId === values[0] && row.organisationMemberId === values[1]).map(({ id }) => ({ id }));
        if (query.includes('FROM "BillingContract"') || query.includes('FROM "EnterpriseSecurityPolicy"')) return [];
        const [organisationId, excluded, now, json] = values;
        const used = source.offers.filter(row => row.organisationId === organisationId && row.id !== excluded &&
          ["PUBLISHED", "PAUSED"].includes(row.state) && row.publishedEndsAt > now).map(row => row.id);
        const locations = source.offerLocations.filter(row => row.organisationId === organisationId && row.scope === "PUBLISHED" && used.includes(row.offerId)).map(row => row.locationId);
        return [{ count: BigInt(new Set([...locations, ...JSON.parse(json)]).size) }];
      }
    };
  }
  const db = { ...client(data), async $transaction(operation, options) {
    attempts += 1; txOptions.push(options); beforeTransaction?.(attempts);
    const snapshot = clone(data), tx = client(snapshot, true);
    const result = await operation(tx);
    for (const key of Object.keys(data)) data[key] = snapshot[key];
    return result;
  } };
  const service = createRewardOfferService({ db, env, clock: () => clock,
    loadContext: async tx => { calls.push(["context", tx !== db]); onContext?.(tx !== db); return context; } });
  return { service, data, context, calls, txOptions, env,
    setClock: value => { clock = value; }, setBeforeTransaction: value => { beforeTransaction = value; },
    setOnContext: value => { onContext = value; }, failAudit: () => { failAudit = true; },
    async create(patch = {}) { const result = await service.create({ terms: terms(patch) }); assert.equal(result.ok, true, JSON.stringify(result)); return result.offer; }
  };
}

function campaign(id = "campaign-one", locationIds = ["shop-one"]) {
  return { id, organisationId: "org-one", name: `Sample ${id}`, status: "PUBLISHED", promoVersionId: "promo-version-one", priority: "NORMAL",
    schedulingMode: "INTERVAL", mandatory: false, respectOpeningHours: true, effectiveFrom: START, effectiveTo: new Date("2026-11-30T00:00:00.000Z"),
    maxPromoMinutesPerHour: 12, minSamePromoGapMinutes: 15, minAnyPromoGapMinutes: 2, publicationRevision: 1,
    publishedAt: START, publishedConfigurationHash: null,
    targets: locationIds.map(locationId => ({ campaignId: id, targetType: "LOCATION", brandId: null, locationGroupId: null, locationId, zoneId: null, stationId: null, channelId: null })),
    schedules: [{ weekday: 1, windowMode: "INTERVAL", startMinute: 540, endMinute: 1020, exactMinute: null, playsPerHour: null, intervalMinutes: 10 }],
    rule: { exactTimeHardStart: false, playsPerHour: null, intervalMinutes: 10 }, retailMediaOrder: null,
    promoVersion: { id: "promo-version-one", status: "APPROVED", promoAssetId: "promo-one", mediaAssetId: "media-one",
      promoAsset: { id: "promo-one", organisationId: "org-one", name: "Shop announcement", status: "ACTIVE", mediaType: "COMMERCIAL" },
      mediaAsset: { id: "media-one", organisationId: "org-one", status: "READY", mediaType: "COMMERCIAL", mimeType: "audio/mpeg" } } };
}
const inputFor = offer => ({ offerId: offer.id, expectedVersion: offer.version });
const choose = (offer, patch = {}) => ({ ...inputFor(offer), campaignId: "campaign-one", campaignPublicationRevision: 1, ...patch });

test("campaign linking flags and strict contracts fail closed before auth or queries", async () => {
  for (const value of [undefined, "false", "TRUE", true, " true"]) {
    const f = fixture(); f.env.RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED = value;
    assert.equal((await f.service.campaignLinks({})).code, "FEATURE_DISABLED");
    assert.equal((await f.service.saveCampaignLink({})).code, "FEATURE_DISABLED"); assert.equal(f.calls.length, 0);
  }
  assert.equal(readCampaignLinkPolicy({RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED:"true"}).enabled,false);
  for (const key of ["organisationId","snapshot","campaignConfigurationHash","actorUserId"]) {
    assert.equal(campaignLinkSaveSchema.safeParse({offerId:"offer-one",expectedVersion:1,campaignId:null,[key]:"injected"}).success,false);
  }
  assert.equal(campaignLinkSaveSchema.safeParse({offerId:"offer-one",expectedVersion:1,campaignId:"campaign-one"}).success,false);
  assert.equal(campaignLinkSaveSchema.safeParse({offerId:"offer-one",expectedVersion:1,campaignId:null,campaignPublicationRevision:1}).success,false);
  assert.equal(campaignLinkReviewSchema.safeParse({offerId:"offer-one",expectedVersion:1,page:0}).success,false);
});

test("review works for an unpublished saved draft, reads twice and exposes only a strict safe view", async () => {
  const f = fixture(), draft = await f.create(), before = clone(f.data);
  const result = await f.service.campaignLinks(inputFor(draft));
  assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(result.campaigns.length,1);
  assert.equal(result.offer.state,"DRAFT"); assert.equal(result.publishedLink,null); assert.equal(result.selection,null);
  assert.equal(safeCampaignLinkResult("review",result)?.ok,true); assert.deepEqual(f.data,before);
  for (const term of ["ConfigurationHash","selectedByUserId","media-one","promo-version-one","storageKey"]) assert.equal(JSON.stringify(result).includes(term),false);
  assert.equal(safeCampaignLinkResult("review",{...result,organisationId:"org-one"}),null);
  assert.equal(f.txOptions.filter(o => o.isolationLevel === "RepeatableRead").length,2);
});

test("save is draft-only; new publication pins the selected campaign outside shopper terms", async () => {
  const f = fixture(), draft = await f.create(), campaignBefore = clone(f.data.campaigns);
  const saved = await f.service.saveCampaignLink(choose(draft)); assert.equal(saved.ok,true,JSON.stringify(saved));
  assert.equal(saved.offer.version,2); assert.equal(safeCampaignLinkResult("save",saved)?.ok,true);
  assert.equal(f.data.campaignDrafts.length,1); assert.equal(f.data.revisions.length,0); assert.equal(f.data.campaignPins.length,0);
  const published = await f.service.transition(draft.id,"PUBLISH",{expectedVersion:2}); assert.equal(published.ok,true,JSON.stringify(published));
  assert.equal(f.data.campaignPins.length,1); const pin = f.data.campaignPins[0];
  assert.equal(pin.revision,1); assert.equal(pin.campaignPublicationRevision,1); assert.deepEqual(pin.snapshot.locationIds,["shop-one"]);
  assert.equal(pin.snapshot.campaignName,"Sample campaign-one");
  assert.equal(JSON.stringify(f.data.revisions[0].terms).includes("campaign"),false); assert.deepEqual(f.data.campaigns,campaignBefore);
  const review = await f.service.campaignLinks(inputFor(published.offer)); assert.equal(review.ok,true,JSON.stringify(review));
  assert.deepEqual(review.publishedLink,{revision:1,campaignId:"campaign-one",name:"Sample campaign-one",publicationRevision:1});
  assert.equal(f.data.audits.at(-2).action,"OFFER_CAMPAIGN_DRAFT_SAVED");
});

test("choosing, removing and republishing cannot change an older coupon revision or pin", async () => {
  const f = fixture(), draft = await f.create();
  const first = await f.service.transition(draft.id,"PUBLISH",{expectedVersion:1}); assert.equal(first.ok,true);
  const oldRevision = clone(f.data.revisions[0]);
  const saved = await f.service.saveCampaignLink(choose(first.offer)); assert.equal(saved.ok,true);
  assert.equal(f.data.campaignPins.length,0); assert.deepEqual(f.data.revisions[0],oldRevision);
  const second = await f.service.transition(draft.id,"PUBLISH",{expectedVersion:saved.offer.version}); assert.equal(second.ok,true);
  const oldPin = clone(f.data.campaignPins[0]); assert.equal(oldPin.revision,2);
  const clear = await f.service.saveCampaignLink({...inputFor(second.offer),campaignId:null}); assert.equal(clear.ok,true);
  assert.deepEqual(f.data.campaignPins,[oldPin]); assert.equal(f.data.campaignDrafts.length,0);
  const third = await f.service.transition(draft.id,"PUBLISH",{expectedVersion:clear.offer.version}); assert.equal(third.ok,true);
  assert.equal(third.offer.publishedRevision,3); assert.deepEqual(f.data.campaignPins,[oldPin]); assert.deepEqual(f.data.revisions[0],oldRevision);
  const review = await f.service.campaignLinks(inputFor(third.offer)); assert.equal(review.publishedLink,null);
});

test("a disabled linking flag blocks publication with a saved choice but ordinary no-link publication still works", async () => {
  const f = fixture(), draft = await f.create(), saved = await f.service.saveCampaignLink(choose(draft)); assert.equal(saved.ok,true);
  const before = clone(f.data); f.env.RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED = "false";
  assert.equal((await f.service.transition(draft.id,"PUBLISH",{expectedVersion:saved.offer.version})).code,"FEATURE_DISABLED"); assert.deepEqual(f.data,before);
  const plain = fixture(), other = await plain.create(); plain.env.RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED = "false";
  assert.equal((await plain.service.transition(other.id,"PUBLISH",{expectedVersion:1})).ok,true);
});

test("stale offer/campaign revisions and stale hashes cannot save or publish", async () => {
  const f = fixture(), draft = await f.create();
  assert.equal((await f.service.saveCampaignLink(choose(draft,{expectedVersion:2}))).code,"CONFLICT");
  assert.equal((await f.service.saveCampaignLink(choose(draft,{campaignPublicationRevision:2}))).code,"CONFLICT");
  const saved = await f.service.saveCampaignLink(choose(draft)); assert.equal(saved.ok,true);
  const before = clone(f.data); f.data.campaigns[0].publicationRevision = 2;
  assert.equal((await f.service.transition(draft.id,"PUBLISH",{expectedVersion:saved.offer.version})).code,"CONFLICT");
  assert.equal(f.data.revisions.length,0); assert.equal(f.data.campaignPins.length,0);
  f.data.campaigns = before.campaigns; f.data.locations[0].zones.push({id:"new-zone",name:"Later",locationId:"shop-one"});
  assert.equal((await f.service.transition(draft.id,"PUBLISH",{expectedVersion:saved.offer.version})).code,"CONFLICT");
});

test("both READ and MANAGE scopes must cover all live and draft shops", async () => {
  const f = fixture({role:"MANAGER"}), draft = await f.create();
  f.data.staff = [{...f.data.staff[0],capabilities:["READ"]},{...f.data.staff[0],id:"staff-two",locationId:"shop-two",capabilities:["MANAGE_OFFERS"]}];
  assert.equal((await f.service.campaignLinks(inputFor(draft))).code,"OFFER_UNAVAILABLE");
  assert.equal((await f.service.saveCampaignLink(choose(draft))).code,"OFFER_UNAVAILABLE");
  const f2 = fixture(), original = await f2.create(), published = await f2.service.transition(original.id,"PUBLISH",{expectedVersion:1});
  const edited = await f2.service.update(original.id,{expectedVersion:published.offer.version,terms:terms({locationIds:["shop-two"]})}); assert.equal(edited.ok,true);
  f2.context.membership.role="MANAGER"; f2.context.memberships[0].role="MANAGER"; f2.data.staff[0].locationId="shop-two";
  assert.equal((await f2.service.campaignLinks(inputFor(edited.offer))).code,"OFFER_UNAVAILABLE");
});

test("foreign campaigns, private media, inactive promos, non-promotional audio and incompatible dates fail closed", async () => {
  const changes = [c=>c.organisationId="foreign",c=>c.promoVersion.mediaAsset.organisationId="foreign",c=>c.status="PAUSED",
    c=>c.promoVersion.status="DRAFT",c=>c.promoVersion.promoAsset.status="ARCHIVED",c=>c.promoVersion.mediaAsset.mimeType="video/mp4",
    c=>c.promoVersion.mediaAsset.mediaType="MUSIC",c=>c.mandatory=true,c=>c.retailMediaOrder={id:"order"},c=>c.effectiveTo=new Date("2026-10-01"),
    c=>c.targets[0].locationId="shop-two"];
  for (const change of changes) {
    const f = fixture(), draft = await f.create(); change(f.data.campaigns[0]);
    const before = clone(f.data); const saved = await f.service.saveCampaignLink(choose(draft));
    assert.equal(saved.ok,false); assert.deepEqual(f.data,before);
  }
});

test("cancelled/expired drafts and missing/foreign offers cannot acquire a selection", async () => {
  const f = fixture(), draft = await f.create();
  assert.equal((await f.service.saveCampaignLink(choose(draft,{offerId:"missing"}))).code,"OFFER_UNAVAILABLE");
  const cancelled = await f.service.transition(draft.id,"CANCEL",{expectedVersion:1}); assert.equal(cancelled.ok,true);
  assert.equal((await f.service.saveCampaignLink(choose(cancelled.offer))).code,"OFFER_UNAVAILABLE");
  const g = fixture(), expired = await g.create({endsAt:"2026-11-14T01:00:00.000Z"});
  assert.equal((await g.service.saveCampaignLink(choose(expired))).code,"OFFER_UNAVAILABLE");
});

test("audit failure rolls back selection, offer version, publication and immutable pin", async () => {
  const f = fixture(), draft = await f.create(), before = clone(f.data); f.failAudit();
  assert.equal((await f.service.saveCampaignLink(choose(draft))).code,"UNAVAILABLE"); assert.deepEqual(f.data,before);
  const g = fixture(), other = await g.create(), saved = await g.service.saveCampaignLink(choose(other)); assert.equal(saved.ok,true);
  const snap = clone(g.data); g.failAudit();
  assert.equal((await g.service.transition(other.id,"PUBLISH",{expectedVersion:saved.offer.version})).code,"UNAVAILABLE"); assert.deepEqual(g.data,snap);
});

test("fresh authority, feature, campaign and candidate-cap checks reject stale review results", async () => {
  const f = fixture(), draft = await f.create(); f.setBeforeTransaction(attempt => {if(attempt===3)f.data.campaigns[0].publicationRevision++;});
  assert.equal((await f.service.campaignLinks(inputFor(draft))).code,"CONFLICT");
  const g = fixture(), other = await g.create(); g.data.campaigns=Array.from({length:101},(_,i)=>campaign(`campaign-${i}`));
  assert.equal((await g.service.campaignLinks(inputFor(other))).code,"REVIEW_TOO_LARGE");
  const h = fixture(), third = await h.create(); h.context.session.revokedAt=NOW;
  assert.equal((await h.service.saveCampaignLink(choose(third))).code,"UNAUTHENTICATED");
});

test("serialization retries reacquire current selection authority and do not append duplicate audit", async () => {
  const f = fixture(), draft = await f.create();
  f.setBeforeTransaction(attempt => { if (attempt === 2) { const error = new Error("synthetic concurrent writer"); error.code = "P2034"; throw error; } });
  const saved = await f.service.saveCampaignLink(choose(draft)); assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.offer.version,2); assert.equal(f.data.campaignDrafts.length,1);
  assert.equal(f.data.audits.filter(a => a.action === "OFFER_CAMPAIGN_DRAFT_SAVED").length,1);
});

test("current link authority is required again at publish and revoked access leaves history unchanged", async () => {
  const f = fixture({role:"MANAGER"}), draft = await f.create(), saved = await f.service.saveCampaignLink(choose(draft)); assert.equal(saved.ok,true);
  f.data.staff[0].capabilities = ["READ", "PUBLISH_OFFERS"]; const before = clone(f.data);
  assert.equal((await f.service.transition(draft.id,"PUBLISH",{expectedVersion:saved.offer.version})).code,"FORBIDDEN"); assert.deepEqual(f.data,before);
  const g = fixture(), other = await g.create(), selected = await g.service.saveCampaignLink(choose(other)); assert.equal(selected.ok,true);
  g.data.campaigns[0].promoVersion.status="DRAFT"; const invalid = clone(g.data);
  assert.equal((await g.service.transition(other.id,"PUBLISH",{expectedVersion:selected.offer.version})).code,"CONFLICT"); assert.deepEqual(g.data,invalid);
});

test("draft edits preserve the original selection but publication rechecks changed shops and dates", async () => {
  const f = fixture(), draft = await f.create(), saved = await f.service.saveCampaignLink(choose(draft)); assert.equal(saved.ok,true);
  const edit = await f.service.update(draft.id,{expectedVersion:saved.offer.version, terms:terms({locationIds:["shop-two"]})}); assert.equal(edit.ok,true);
  assert.equal(f.data.campaignDrafts.length,1); const before = clone(f.data);
  assert.equal((await f.service.transition(draft.id,"PUBLISH",{expectedVersion:edit.offer.version})).code,"CONFLICT"); assert.deepEqual(f.data,before);
  const cleared = await f.service.saveCampaignLink({...inputFor(edit.offer),campaignId:null}); assert.equal(cleared.ok,true);
  assert.equal((await f.service.transition(draft.id,"PUBLISH",{expectedVersion:cleared.offer.version})).ok,true);
});
test("reviewer reproduction: expiring target READ scope cannot save via unrelated residual READ", async () => {
  const f = fixture({role:"MANAGER"}), offer = await f.create();
  const base = f.data.staff[0];
  f.data.staff = [
    {...base,id:"read-one",capabilities:["READ"],expiresAt:new Date(NOW.getTime()+1000)},
    {...base,id:"read-two",locationId:"shop-two",capabilities:["READ"]},
    {...base,id:"manage-one",capabilities:["MANAGE_OFFERS","PUBLISH_OFFERS"]}
  ];
  let insideCalls = 0;
  f.setOnContext(inside => { if(inside && ++insideCalls===5)f.setClock(new Date(NOW.getTime()+2000)); });
  const result = await f.service.saveCampaignLink(choose(offer));
  assert.equal(result.ok,false,"Saving must fail when current READ no longer covers shop-one");
});

test("reviewer reproduction: publication cannot retain expired target READ scope", async () => {
  const f = fixture({role:"MANAGER"}), offer = await f.create();
  const saved = await f.service.saveCampaignLink(choose(offer)); assert.equal(saved.ok,true);
  const base = f.data.staff[0];
  f.data.staff = [
    {...base,id:"read-one",capabilities:["READ"],expiresAt:new Date(NOW.getTime()+1000)},
    {...base,id:"read-two",locationId:"shop-two",capabilities:["READ"]},
    {...base,id:"manage-one",capabilities:["MANAGE_OFFERS","PUBLISH_OFFERS"]}
  ];
  let insideCalls = 0;
  f.setOnContext(inside => { if(inside && ++insideCalls===5)f.setClock(new Date(NOW.getTime()+2000)); });
  const result = await f.service.transition(offer.id,"PUBLISH",{expectedVersion:saved.offer.version});
  assert.equal(result.ok,false,"Publication must fail when current READ no longer covers shop-one");
});

test("reviewer reproduction: saved campaign outside current shop scopes must not expose its name", async () => {
  const f = fixture(), offer = await f.create(), selected = await f.service.saveCampaignLink(choose(offer)); assert.equal(selected.ok,true);
  const edited = await f.service.update(offer.id,{expectedVersion:selected.offer.version,terms:terms({locationIds:["shop-two"]})});assert.equal(edited.ok,true);
  f.context.membership.role="MANAGER"; f.context.memberships[0].role="MANAGER"; f.data.staff[0].locationId="shop-two";
  const result = await f.service.campaignLinks(inputFor(edited.offer));
  assert.equal(JSON.stringify(result).includes("Sample campaign-one"),false,"Former shop-one campaign name must not appear under only shop-two scope");
});


test("compound final authorization catches expiry between final READ and MANAGE checks", async () => {
  for (const operation of ["save", "publish"]) {
    const f = fixture({role:"MANAGER"}), draft = await f.create();
    const current = operation === "publish" ? (await f.service.saveCampaignLink(choose(draft))).offer : draft;
    const base = f.data.staff[0];
    f.data.staff = [
      {...base,id:"read-one",capabilities:["READ"],expiresAt:new Date(NOW.getTime()+1000)},
      {...base,id:"read-two",locationId:"shop-two",capabilities:["READ"]},
      {...base,id:"manage-one",capabilities:["MANAGE_OFFERS","PUBLISH_OFFERS"]}
    ];
    const before = clone(f.data); let insideCalls = 0;
    f.setOnContext(inside => { if(inside && ++insideCalls===9)f.setClock(new Date(NOW.getTime()+2000)); });
    const result = operation === "publish" ? await f.service.transition(current.id,"PUBLISH",{expectedVersion:current.version}) :
      await f.service.saveCampaignLink(choose(current));
    assert.equal(insideCalls,9); assert.equal(result.ok,false,`${operation} must reject expiry during its last compound authorization`);
    assert.deepEqual(f.data,before,`${operation} must roll back all changes, including audit and immutable pin`);
  }
});
